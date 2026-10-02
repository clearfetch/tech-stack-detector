import dns from 'node:dns/promises';
import { Actor, log } from 'apify';
import * as cheerio from 'cheerio';
import { gotScraping } from 'got-scraping';
import { getDomain } from 'tldts';
import { analyze, loadDatabase } from './engine.js';
import { buildPage } from './page.js';

const EVENT = 'website-analyzed';
// Declared above the first top-level await: the helpers below run after it, when a later const would still be in
// its temporal dead zone (see CLAUDE.md).
const MAX_HTML = 1_000_000;
const MAX_LIST_BYTES = 20_000_000;
const HEADER_OPTIONS = { browsers: [{ name: 'chrome', minVersion: 120 }], devices: ['desktop'], operatingSystems: ['windows', 'macos'] };
/**
 * Errors that mean the connection dropped rather than that the site is down; they get one retry. A timeout does
 * not: a host silent for 20 seconds is rarely there 20 seconds later, and on a 10,000-domain list those retries
 * added hours.
 */
const TRANSIENT_CODES = new Set(['ECONNRESET', 'EPIPE', 'EAI_AGAIN', 'ERR_HTTP2_GOAWAY_SESSION', 'ERR_HTTP2_STREAM_ERROR', 'ERR_HTTP2_STREAM_CANCEL']);

await Actor.init();

const input = (await Actor.getInput()) ?? {};
const urls = normalizeUrls(input, await readListFiles(input));
if (!urls.length) {
    await Actor.fail('No usable websites in the input. Pass "urls" (list of domains or URLs), "urlListUrl" (a link to a text or CSV file of domains), or "url" (single string).');
}
const includeDns = input.includeDns !== false;
const includeEvidence = input.includeEvidence !== false;
const minConfidence = clamp(Number(input.minConfidence ?? 0), 0, 100);
// A scan is mostly CPU, and Apify gives a run one core per 4 GB of memory, so the default concurrency follows the
// run's memory: 20 at 2 GB, 40 at 4 GB, 2 at 256 MB.
const memoryMb = Actor.getEnv().memoryMbytes ?? 2048;
const maxConcurrency = clamp(Number(input.maxConcurrency ?? Math.round(memoryMb / 100)), input.maxConcurrency ? 1 : 2, 50);
const timeoutMs = clamp(Number(input.timeoutSecs ?? 20), 5, 60) * 1000;
const proxyConfiguration = await Actor.createProxyConfiguration(input.proxyConfiguration);
// New websites stop being taken while the slowest one in flight could still finish (a timeout, one retry, DNS), so
// a list too long for the run ends as a success with the rest saved, not as a timed-out run.
const timeoutAt = Actor.getEnv().timeoutAt;
const stopAt = timeoutAt ? timeoutAt.getTime() - 2 * timeoutMs - 30_000 : Infinity;

const db = loadDatabase();
log.info(`Loaded ${db.techs.length} technology fingerprints in ${Object.keys(db.categories).length} categories`);
log.info(`Analyzing ${urls.length} website(s), concurrency ${maxConcurrency}, DNS ${includeDns ? 'on' : 'off'}`);

let done = 0;
let charged = 0;
let failed = 0;
let stop = null;
let finishing = false;
let watchdog = null;
const completed = new Set();

await runPool(urls, maxConcurrency, async (url) => {
    if (stop) return;
    if (Date.now() > stopAt) {
        stop = "the run's time limit is near";
        // Websites in flight get until 15 seconds before the limit; one that is still not done then is left for the
        // UNPROCESSED list rather than letting the platform kill the run (seen in a 2,210-website load test).
        watchdog ??= setTimeout(finish, Math.max(0, timeoutAt.getTime() - Date.now() - 15_000));
        return;
    }
    const item = await scan(url);
    // Past the cost limit nothing more can be charged or written; websites in flight at the time limit still are.
    if (finishing) return;
    done += 1;
    if (item.ok) {
        const result = await Actor.pushData(item, EVENT);
        charged += 1;
        completed.add(url);
        if (result?.eventChargeLimitReached) {
            stop = 'the maximum cost set for this run was reached';
            // Immediately: the platform aborts a run that keeps working past its cost limit.
            await finish();
        }
    } else {
        failed += 1;
        completed.add(url);
        await Actor.pushData(item);
    }
    if (done % 10 === 0 || done === urls.length) {
        await Actor.setStatusMessage(`${done}/${urls.length} scanned, ${charged} analyzed, ${failed} failed`);
    }
});
await finish();

/**
 * Ends the run. Websites not scanned are saved as the UNPROCESSED record, a list ready to pass as "urls" in the next
 * run, so stopping early at the time or cost limit loses nothing but time.
 */
async function finish() {
    if (finishing) return;
    finishing = true;
    const left = urls.filter((u) => !completed.has(u));
    if (left.length) {
        await Actor.setValue('UNPROCESSED', left);
        log.warning(`Stopped early because ${stop}: ${left.length} website(s) were not scanned and are in the key-value store record UNPROCESSED, ready to pass as "urls" in the next run.`);
    }
    log.info(`Finished: ${charged} websites analyzed, ${failed} failed, ${left.length} not scanned`);
    await Actor.exit(left.length ? `${charged} analyzed, ${failed} failed, ${left.length} not scanned because ${stop} (see the UNPROCESSED record)` : undefined);
}

async function scan(url) {
    const started = Date.now();
    try {
        const res = await fetchSite(url);
        const html = res.body;
        const finalUrl = res.url || url;
        const $ = cheerio.load(html);
        const page = buildPage($, html, finalUrl, res.headers);
        if (includeDns) page.dns = await lookupDns(new URL(finalUrl).hostname);
        const detected = analyze(db, page).filter((t) => t.confidence >= minConfidence);
        // Technologies seen only through DNS records (mail providers, domain-verification tokens, DNS hosts)
        // are reported separately so the main list describes the website itself.
        const isDnsOnly = (t) => t.evidence.length > 0 && t.evidence.every((e) => e.type === 'dns' || (e.type === 'implied' && dnsOnlyNames.has(e.key)));
        const dnsOnlyNames = new Set();
        for (const t of detected) if (t.evidence.every((e) => e.type === 'dns')) dnsOnlyNames.add(t.name);
        const technologies = detected.filter((t) => !isDnsOnly(t));
        const dnsTechnologies = detected.filter((t) => isDnsOnly(t));
        if (!includeEvidence) for (const t of detected) delete t.evidence;
        const pageAnalyzed = res.statusCode < 400 && html.length > 0;
        if (!pageAnalyzed && technologies.length === 0 && dnsTechnologies.length === 0) {
            const err = new Error(`HTTP ${res.statusCode} and nothing detected`);
            err.statusCode = res.statusCode;
            throw err;
        }
        const categorized = {};
        for (const t of technologies) {
            for (const c of t.categories) (categorized[c.name] ??= []).push(t.name);
        }
        return {
            url,
            finalUrl,
            ok: true,
            pageAnalyzed,
            statusCode: res.statusCode,
            title: $('title').first().text().trim() || null,
            technologies,
            techNames: technologies.map((t) => t.name),
            count: technologies.length,
            categorized,
            dnsTechnologies: includeDns ? dnsTechnologies.map((t) => ({ name: t.name, slug: t.slug, confidence: t.confidence, categories: t.categories, evidence: t.evidence })) : undefined,
            dnsTechNames: includeDns ? dnsTechnologies.map((t) => t.name) : undefined,
            server: {
                server: firstHeader(res.headers, 'server'),
                poweredBy: firstHeader(res.headers, 'x-powered-by'),
                generator: page.meta.generator?.[0] ?? null,
            },
            dns: includeDns ? page.dns : undefined,
            scanTimeMs: Date.now() - started,
            scannedAt: new Date().toISOString(),
        };
    } catch (err) {
        // The whole-fetch deadline ends in a DOMException whose code is a number (23), which the dataset schema
        // would reject on the platform; it is reported as the timeout it is.
        const aborted = err.name === 'AbortError' || err.name === 'TimeoutError';
        const message = aborted ? `no complete answer within ${Math.round(timeoutMs / 1000) + 5} seconds, redirects included` : err.message;
        log.warning(`Failed ${url}: ${message}`);
        return {
            url,
            ok: false,
            statusCode: err.statusCode ?? err.response?.statusCode ?? null,
            error: message,
            errorCode: aborted ? 'ETIMEDOUT' : err.code == null ? null : String(err.code),
            scanTimeMs: Date.now() - started,
            scannedAt: new Date().toISOString(),
        };
    }
}

/** A website's page, following redirects, with one retry for a dropped connection. */
async function fetchSite(url) {
    for (let attempt = 0; ; attempt += 1) {
        try {
            const proxyUrl = proxyConfiguration ? await proxyConfiguration.newUrl() : undefined;
            // got restarts its request timeout on every redirect, so a chain of slow hops ran past a minute; the
            // signal is one deadline for the whole fetch.
            return await readBody({ url, proxyUrl, timeout: { request: timeoutMs }, signal: AbortSignal.timeout(timeoutMs + 5_000), followRedirect: true, maxRedirects: 10, throwHttpErrors: false, headerGeneratorOptions: HEADER_OPTIONS }, MAX_HTML, true);
        } catch (err) {
            if (attempt > 0 || !TRANSIENT_CODES.has(err.code)) throw err;
        }
    }
}

/**
 * Reads a response as a stream and keeps at most `maxBytes` of it. Only the first megabyte of a page is ever
 * analyzed, and a domain in a long list can serve a download or an endless page; buffering those whole cost memory
 * and time for nothing. With `textOnly`, a body that is not text is not read at all and only the headers count.
 */
function readBody(options, maxBytes, textOnly) {
    return new Promise((resolve, reject) => {
        const stream = gotScraping.stream(options);
        const chunks = [];
        let size = 0;
        let settled = false;
        let response = null;
        function done() {
            if (settled) return;
            settled = true;
            stream.destroy();
            if (!response) return reject(new Error('no response'));
            resolve({ statusCode: response.statusCode, headers: response.headers, url: response.url, body: Buffer.concat(chunks).toString('utf8') });
        }
        stream.on('response', (res) => {
            response = res;
            const type = String(res.headers['content-type'] ?? '').split(';')[0].trim();
            if (textOnly && type && !/html|xml|text\//i.test(type)) done();
        });
        stream.on('data', (chunk) => {
            if (settled) return;
            chunks.push(chunk);
            size += chunk.length;
            if (size >= maxBytes) done();
        });
        stream.on('end', done);
        // Stays attached after settling: a late error from a destroyed stream must not go unhandled.
        stream.on('error', (err) => {
            if (settled) return;
            settled = true;
            stream.destroy();
            reject(err);
        });
    });
}

/**
 * Domains from linked files: "urlListUrl", and Apify's { requestsFromUrl } entries in "startUrls" or "urls". A list
 * of tens of thousands of domains is easier to keep in a sheet than to paste.
 */
async function readListFiles(inp) {
    const links = [];
    if (typeof inp.urlListUrl === 'string' && inp.urlListUrl.trim()) links.push(inp.urlListUrl.trim());
    for (const key of ['startUrls', 'urls']) {
        for (const v of Array.isArray(inp[key]) ? inp[key] : []) if (v && typeof v === 'object' && v.requestsFromUrl) links.push(String(v.requestsFromUrl));
    }
    const out = [];
    for (const link of links) {
        let res;
        try {
            res = await readBody({ url: link, timeout: { request: 60_000 }, followRedirect: true, throwHttpErrors: false, headerGeneratorOptions: HEADER_OPTIONS }, MAX_LIST_BYTES, false);
        } catch (err) {
            await Actor.fail(`Could not read the list of websites at ${link}: ${err.message}`);
        }
        if (res.statusCode >= 400) await Actor.fail(`Could not read the list of websites at ${link}: HTTP ${res.statusCode}`);
        const found = domainsFromList(res.body);
        log.info(`${link}: ${found.length} website(s) in the list`);
        out.push(...found);
    }
    return out;
}

/** The first cell on each line that looks like a domain or a URL; header rows and other columns are left out. */
function domainsFromList(text) {
    const out = [];
    for (const line of String(text).split(/\r?\n/)) {
        const cells = line.split(/[,;\t]/).map((c) => c.trim().replace(/^["']+|["']+$/g, ''));
        const cell = cells.find((c) => /^(https?:\/\/)?[^\s/@,;"']+\.[a-z][a-z0-9-]+(:\d+)?(\/\S*)?$/i.test(c));
        if (cell) out.push(cell);
    }
    return out;
}

async function lookupDns(hostname) {
    const apex = getDomain(hostname) || hostname;
    const hosts = [...new Set([hostname, apex])];
    const withTimeout = (p) => Promise.race([p, new Promise((resolve) => setTimeout(() => resolve([]), 4000))]).catch(() => []);
    const [txt, mx, ns, cname] = await Promise.all([
        Promise.all(hosts.map((h) => withTimeout(dns.resolveTxt(h)))).then((r) => r.flat().map((rec) => rec.join(''))),
        withTimeout(dns.resolveMx(apex)).then((r) => r.map((m) => m.exchange)),
        withTimeout(dns.resolveNs(apex)),
        withTimeout(dns.resolveCname(hostname)),
    ]);
    return { TXT: txt, MX: mx, NS: ns, CNAME: cname };
}

function normalizeUrls(inp, listed = []) {
    const raw = [];
    const push = (v) => {
        if (!v) return;
        if (Array.isArray(v)) return v.forEach(push);
        if (typeof v === 'object') return push(v.url ?? v.domain ?? v.website);
        // Split on newlines and commas only. Splitting on spaces would turn one typo into several bogus hosts.
        String(v)
            .split(/[\n\r,;]+/)
            .map((s) => s.trim())
            .filter(Boolean)
            .forEach((s) => raw.push(s));
    };
    for (const key of ['urls', 'url', 'startUrls', 'domains', 'websites', 'targetUrls']) push(inp[key]);
    push(listed);
    const seen = new Set();
    const out = [];
    for (const entry of raw) {
        const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(entry);
        if (scheme && !/^https?$/i.test(scheme[1])) {
            // Without this, "mailto:a@b.com" would parse as host b.com with credentials, and "ftp://x" as host "ftp".
            log.warning(`Skipping unsupported scheme "${scheme[1]}:": ${entry}`);
            continue;
        }
        const candidate = scheme ? entry : `https://${entry}`;
        let parsed;
        try {
            parsed = new URL(candidate);
        } catch {
            log.warning(`Skipping invalid URL: ${entry}`);
            continue;
        }
        if (!parsed.hostname || !parsed.hostname.includes('.')) {
            log.warning(`Skipping URL without a valid hostname: ${entry}`);
            continue;
        }
        if (!seen.has(parsed.href)) {
            seen.add(parsed.href);
            out.push(parsed.href);
        }
    }
    return out;
}

async function runPool(items, size, worker) {
    let i = 0;
    const next = async () => {
        while (i < items.length) {
            const item = items[i++];
            await worker(item);
        }
    };
    await Promise.all(Array.from({ length: Math.min(size, items.length) }, next));
}

function firstHeader(headers, name) {
    const v = headers?.[name];
    return v === undefined ? null : Array.isArray(v) ? v[0] : String(v);
}
function clamp(n, lo, hi) {
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
}

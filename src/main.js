import dns from 'node:dns/promises';
import { Actor, log } from 'apify';
import * as cheerio from 'cheerio';
import { gotScraping } from 'got-scraping';
import { getDomain } from 'tldts';
import { analyze, loadDatabase } from './engine.js';

const EVENT = 'website-analyzed';
const MAX_HTML = 1_000_000;
const MAX_INLINE_SCRIPT = 200_000;
const MAX_TEXT = 100_000;
const MAX_RESOURCE_URLS = 400;

await Actor.init();

const input = (await Actor.getInput()) ?? {};
const urls = normalizeUrls(input);
if (!urls.length) {
    await Actor.fail('No websites provided. Pass "urls" (list of domains or URLs), or "url" (single string), or "startUrls".');
}
const includeDns = input.includeDns !== false;
const includeEvidence = input.includeEvidence !== false;
const minConfidence = clamp(Number(input.minConfidence ?? 0), 0, 100);
const maxConcurrency = clamp(Number(input.maxConcurrency ?? 10), 1, 50);
const timeoutMs = clamp(Number(input.timeoutSecs ?? 20), 5, 60) * 1000;
const proxyConfiguration = await Actor.createProxyConfiguration(input.proxyConfiguration);

const db = loadDatabase();
log.info(`Loaded ${db.techs.length} technology fingerprints in ${Object.keys(db.categories).length} categories`);
log.info(`Analyzing ${urls.length} website(s), concurrency ${maxConcurrency}, DNS ${includeDns ? 'on' : 'off'}`);

let done = 0;
let charged = 0;
let failed = 0;
let stop = false;

await runPool(urls, maxConcurrency, async (url) => {
    if (stop) return;
    const item = await scan(url);
    done += 1;
    if (item.ok) {
        const result = await Actor.pushData(item, EVENT);
        charged += 1;
        if (result?.eventChargeLimitReached) {
            log.warning('Maximum charge for this run reached, stopping.');
            stop = true;
        }
    } else {
        failed += 1;
        await Actor.pushData(item);
    }
    if (done % 10 === 0 || done === urls.length) {
        await Actor.setStatusMessage(`${done}/${urls.length} scanned, ${charged} analyzed, ${failed} failed`);
    }
});

log.info(`Finished: ${charged} websites analyzed, ${failed} failed, ${urls.length - done} skipped`);
await Actor.exit();

async function scan(url) {
    const started = Date.now();
    try {
        const proxyUrl = proxyConfiguration ? await proxyConfiguration.newUrl() : undefined;
        const res = await gotScraping({
            url,
            proxyUrl,
            timeout: { request: timeoutMs },
            followRedirect: true,
            maxRedirects: 10,
            throwHttpErrors: false,
            responseType: 'text',
            retry: { limit: 1 },
            headerGeneratorOptions: {
                browsers: [{ name: 'chrome', minVersion: 120 }],
                devices: ['desktop'],
                operatingSystems: ['windows', 'macos'],
            },
        });
        const html = String(res.body ?? '').slice(0, MAX_HTML);
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
        log.warning(`Failed ${url}: ${err.message}`);
        return {
            url,
            ok: false,
            statusCode: err.statusCode ?? err.response?.statusCode ?? null,
            error: err.message,
            errorCode: err.code ?? null,
            scanTimeMs: Date.now() - started,
            scannedAt: new Date().toISOString(),
        };
    }
}

function buildPage($, html, finalUrl, headers) {
    const scriptSrc = [];
    $('script[src]').each((_, el) => {
        const src = $(el).attr('src');
        if (!src) return;
        try {
            scriptSrc.push(new URL(src, finalUrl).href);
        } catch {
            scriptSrc.push(src);
        }
    });
    const scripts = [];
    $('script:not([src])').each((_, el) => {
        const text = $(el).text();
        if (text) scripts.push(text.slice(0, MAX_INLINE_SCRIPT));
    });
    const css = [];
    $('style').each((_, el) => css.push($(el).text().slice(0, MAX_INLINE_SCRIPT)));
    const meta = {};
    $('meta').each((_, el) => {
        const key = ($(el).attr('name') || $(el).attr('property') || '').toLowerCase();
        const content = $(el).attr('content');
        if (key && content !== undefined) (meta[key] ??= []).push(content);
    });
    const hdrs = {};
    for (const [k, v] of Object.entries(headers || {})) {
        hdrs[k.toLowerCase()] = Array.isArray(v) ? v.map(String) : [String(v)];
    }
    const cookies = {};
    for (const c of hdrs['set-cookie'] || []) {
        const [pair] = c.split(';');
        const eq = pair.indexOf('=');
        const name = (eq === -1 ? pair : pair.slice(0, eq)).trim().toLowerCase();
        const value = eq === -1 ? '' : pair.slice(eq + 1).trim();
        if (name) (cookies[name] ??= []).push(value);
    }
    const text = $('body').text().replace(/\s+/g, ' ').slice(0, MAX_TEXT);
    const resourceUrls = collectResourceUrls($, scripts, finalUrl);
    return { $, html, url: finalUrl, scriptSrc, scripts, css, meta, headers: hdrs, cookies, text, resourceUrls, dns: {} };
}

/**
 * Every absolute URL the document points at: resource hints, images, iframes, meta content and URLs written
 * inside inline scripts. Tag managers and headless storefronts only reveal themselves here. Third-party URLs
 * come first and the list is capped, because a big product page can reference thousands of CDN images.
 */
function collectResourceUrls($, scripts, finalUrl) {
    const found = new Set();
    const add = (value) => {
        if (!value) return;
        for (const raw of String(value).split(/[\s,]+/)) {
            if (!/^https?:\/\//i.test(raw)) continue;
            try {
                const u = new URL(raw);
                found.add(`${u.origin}${u.pathname}`);
            } catch {
                /* ignore unparseable */
            }
        }
    };
    $('link[href], link[imagesrcset], img[src], img[srcset], source[src], source[srcset], iframe[src], embed[src], video[src], audio[src], use[href]').each((_, el) => {
        const a = el.attribs ?? {};
        add(a.href);
        add(a.src);
        add(a.srcset);
        add(a.imagesrcset);
    });
    $('meta[content]').each((_, el) => add(el.attribs?.content));
    for (const script of scripts) {
        const matches = script.match(/https?:\/\/[^\s"'`)<>\\]{6,300}/gi);
        if (matches) for (const m of matches) add(m);
    }
    let host = '';
    try {
        host = getDomain(new URL(finalUrl).hostname) ?? '';
    } catch {
        /* ignore */
    }
    const isThirdParty = (u) => {
        try {
            return getDomain(new URL(u).hostname) !== host;
        } catch {
            return true;
        }
    };
    const list = [...found];
    const third = list.filter(isThirdParty);
    const own = list.filter((u) => !isThirdParty(u));
    return [...third, ...own].slice(0, MAX_RESOURCE_URLS);
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

function normalizeUrls(inp) {
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

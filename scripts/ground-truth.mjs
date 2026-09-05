/**
 * A3 false-negative check. Fetches each URL from the last run's dataset, greps the raw response for the
 * canonical signature of the five most common technologies, and compares with what the Actor reported.
 * A MISS means the signature is in the response but the Actor did not report the technology.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { gotScraping } from 'got-scraping';

const SIGNATURES = {
    WordPress: { html: [/wp-content\//i, /wp-includes\//i, /content=["']WordPress/i], header: [] },
    Shopify: { html: [/cdn\.shopify\.com/i, /Shopify\.theme/i, /shopifycdn\.com/i], header: [/^x-shopid$/i, /^x-shopify/i] },
    'Google Analytics': { html: [/googletagmanager\.com\/gtag\/js/i, /gtag\(['"]config['"]/i, /google-analytics\.com\/(analytics|collect)/i, /\bG-[A-Z0-9]{8,}\b/], header: [] },
    'Google Tag Manager': { html: [/googletagmanager\.com\/gtm\.js/i, /\bGTM-[A-Z0-9]{4,}\b/, /googletagmanager\.com\/ns\.html/i], header: [] },
    Cloudflare: { html: [/\/cdn-cgi\//i], header: [/^cf-ray$/i, /^cf-cache-status$/i] },
};

const dir = 'storage/datasets/default';
const items = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(`${dir}/${f}`)))
    .filter((d) => d.ok);

const rows = [];
for (const item of items) {
    let res;
    try {
        res = await gotScraping({ url: item.finalUrl ?? item.url, timeout: { request: 25000 }, throwHttpErrors: false, responseType: 'text', headerGeneratorOptions: { browsers: [{ name: 'chrome', minVersion: 120 }], devices: ['desktop'] } });
    } catch (err) {
        console.log(`SKIP ${item.url}: ${err.message}`);
        continue;
    }
    const html = String(res.body ?? '');
    const headerNames = Object.keys(res.headers ?? {});
    const reported = new Set([...(item.techNames ?? []), ...(item.dnsTechNames ?? [])]);
    for (const [tech, sig] of Object.entries(SIGNATURES)) {
        const hitHtml = sig.html.find((re) => re.test(html));
        const hitHeader = sig.header.find((re) => headerNames.some((h) => re.test(h)));
        const present = Boolean(hitHtml || hitHeader);
        if (!present) continue;
        // Count a family match: "Google Analytics" may be reported as "Google Analytics 4" etc.
        const found = [...reported].some((r) => r.toLowerCase().includes(tech.toLowerCase()) || tech.toLowerCase().includes(r.toLowerCase()));
        rows.push({ url: item.url, tech, verdict: found ? 'HIT ' : 'MISS', evidence: String(hitHtml ?? hitHeader).slice(0, 40) });
    }
}
rows.sort((a, b) => a.verdict.localeCompare(b.verdict) || a.tech.localeCompare(b.tech));
console.log('\nverdict | technology            | website                        | signature found in response');
for (const r of rows) console.log(`${r.verdict}    | ${r.tech.padEnd(21)} | ${r.url.padEnd(30)} | ${r.evidence}`);
const misses = rows.filter((r) => r.verdict === 'MISS');
console.log(`\n${rows.length} signature(s) present, ${misses.length} missed by the Actor.`);

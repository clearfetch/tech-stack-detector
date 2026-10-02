/**
 * Turns a fetched page into what the fingerprint engine reads: script sources, inline scripts and styles, meta tags,
 * headers, cookies, visible text and every URL the document points at. Kept apart from main.js so tests can build
 * pages from saved HTML exactly as a run does.
 */
import { getDomain } from 'tldts';

const MAX_INLINE_SCRIPT = 200_000;
const MAX_TEXT = 100_000;
const MAX_RESOURCE_URLS = 400;

export function buildPage($, html, finalUrl, headers) {
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

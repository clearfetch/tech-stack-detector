import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(HERE, '..', 'data');

const toArray = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

/**
 * Parses "regex\;confidence:50\;version:\1" into a compiled pattern.
 * The separator is the two characters backslash and semicolon. It must be written as String.raw or '\\;':
 * a plain '\;' collapses to ';' in JavaScript source, which leaves a trailing backslash on the regex and
 * silently drops every tagged pattern in the database.
 */
const TAG_SEPARATOR = String.raw`\;`;

function parsePattern(pattern) {
    const [regex, ...tags] = String(pattern).split(TAG_SEPARATOR);
    const attrs = { confidence: 100, version: '' };
    for (const tag of tags) {
        const i = tag.indexOf(':');
        const key = i === -1 ? tag : tag.slice(0, i);
        const value = i === -1 ? '' : tag.slice(i + 1);
        if (key === 'confidence') attrs.confidence = parseInt(value, 10) || 0;
        else if (key === 'version') attrs.version = value;
    }
    let re = null;
    try {
        re = new RegExp(regex.replace(/\//g, '\\/'), 'i');
    } catch {
        re = null;
    }
    return { regex: re, confidence: attrs.confidence, version: attrs.version, source: regex };
}
const parsePatterns = (v) => toArray(v).map(parsePattern).filter((p) => p.regex);
const parsePatternMap = (obj) => {
    const out = {};
    for (const [k, v] of Object.entries(obj || {})) out[k.toLowerCase()] = parsePatterns(v);
    return out;
};

function compileDom(dom) {
    // string | string[] | { selector: { exists, text, attributes, properties } }
    if (!dom) return [];
    if (typeof dom === 'string' || Array.isArray(dom)) {
        return toArray(dom).map((selector) => ({ selector, exists: [parsePattern('')], text: [], attributes: {} }));
    }
    return Object.entries(dom).map(([selector, spec]) => ({
        selector,
        exists: spec.exists !== undefined ? parsePatterns(spec.exists === '' ? '' : spec.exists) : [],
        text: parsePatterns(spec.text),
        attributes: parsePatternMap(spec.attributes),
    }));
}

function compileTech(name, t) {
    return {
        name,
        cats: t.cats || [],
        website: t.website,
        description: t.description,
        icon: t.icon,
        saas: t.saas,
        oss: t.oss,
        pricing: t.pricing,
        implies: toArray(t.implies).map(parseImply),
        excludes: toArray(t.excludes),
        requires: toArray(t.requires),
        requiresCategory: toArray(t.requiresCategory),
        url: parsePatterns(t.url),
        html: parsePatterns(t.html),
        text: parsePatterns(t.text),
        css: parsePatterns(t.css),
        scriptSrc: parsePatterns(t.scriptSrc),
        scripts: parsePatterns(t.scripts),
        meta: parsePatternMap(t.meta),
        headers: parsePatternMap(t.headers),
        cookies: parsePatternMap(t.cookies),
        dns: parsePatternMap(t.dns),
        dom: compileDom(t.dom),
    };
}
function parseImply(v) {
    const [name, ...tags] = String(v).split(TAG_SEPARATOR);
    let confidence = 100;
    for (const tag of tags) if (tag.startsWith('confidence:')) confidence = parseInt(tag.slice(11), 10) || 0;
    return { name, confidence };
}

export function loadDatabase() {
    const categories = JSON.parse(readFileSync(path.join(DATA_DIR, 'categories.json'), 'utf8'));
    const raw = {};
    for (const f of readdirSync(path.join(DATA_DIR, 'technologies'))) {
        if (f.endsWith('.json')) Object.assign(raw, JSON.parse(readFileSync(path.join(DATA_DIR, 'technologies', f), 'utf8')));
    }
    mergeOverlay(raw, path.join(DATA_DIR, 'extra-technologies.json'));
    const techs = Object.entries(raw).map(([name, t]) => compileTech(name, t));
    const byName = new Map(techs.map((t) => [t.name, t]));
    return { categories, techs, byName };
}

/**
 * Merges our own fingerprint additions on top of the upstream database. Pattern arrays are concatenated and
 * pattern maps merged per key, so an entry adds detections without replacing upstream ones. The overlay lives
 * outside data/technologies/ so scripts/update-db.sh cannot overwrite it.
 */
function mergeOverlay(raw, file) {
    let text;
    try {
        text = readFileSync(file, 'utf8');
    } catch {
        return; // No overlay file is a valid setup.
    }
    let overlay;
    try {
        overlay = JSON.parse(text);
    } catch (err) {
        // Never fail open: a typo here would silently disable our own fingerprints.
        throw new Error(`${file} is not valid JSON (${err.message}). Note that a pattern's confidence separator must be written as "\\;" inside JSON.`);
    }
    const LIST_FIELDS = ['scriptSrc', 'scripts', 'html', 'text', 'css', 'url', 'xhr', 'implies', 'excludes', 'requires', 'requiresCategory'];
    const MAP_FIELDS = ['meta', 'headers', 'cookies', 'dns', 'js'];
    for (const [name, add] of Object.entries(overlay)) {
        const base = raw[name];
        if (!base) {
            raw[name] = add;
            continue;
        }
        for (const field of LIST_FIELDS) {
            if (add[field] === undefined) continue;
            const toArray = (v) => (Array.isArray(v) ? v : [v]);
            base[field] = [...toArray(base[field] ?? []), ...toArray(add[field])];
        }
        for (const field of MAP_FIELDS) {
            if (add[field] === undefined) continue;
            base[field] = { ...(base[field] ?? {}), ...add[field] };
        }
        if (add.dom !== undefined) {
            const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
            base.dom = isObj(base.dom) && isObj(add.dom) ? { ...base.dom, ...add.dom } : add.dom;
        }
        for (const field of ['cats', 'website', 'description', 'icon', 'saas', 'oss', 'pricing']) {
            if (base[field] === undefined && add[field] !== undefined) base[field] = add[field];
        }
    }
}

function resolveVersion({ version, regex }, value) {
    if (!version) return '';
    let resolved = version;
    const m = regex.exec(value);
    if (!m) return '';
    m.forEach((group, i) => {
        const ternary = new RegExp(`\\\\${i}\\?([^:]+)?:(.*)$`).exec(resolved);
        if (ternary && ternary.length === 3) {
            resolved = resolved.replace(ternary[0], group ? ternary[1] || '' : ternary[2] || '');
        }
        resolved = resolved.trim().replace(new RegExp(`\\\\${i}`, 'g'), group || '');
    });
    return resolved.trim();
}

function testPatterns(patterns, value, type, out, tech, keyName, maxConfidence = 100) {
    if (!value) return;
    for (const p of patterns) {
        if (p.regex.test(value)) {
            out.push({
                tech,
                type,
                key: keyName,
                confidence: Math.min(p.confidence, maxConfidence),
                version: resolveVersion(p, value),
                pattern: p.source,
                match: String(value).slice(0, 160),
            });
        }
    }
}

/**
 * @param {object} db loaded database
 * @param {object} page { url, html, text, scriptSrc: string[], scripts: string[], css: string[], meta: {name:[values]},
 *                        headers: {name:[values]}, cookies: {name:[values]}, dns: {TXT:[...], MX:[...]}, $: cheerio }
 */
export const RESOURCE_URL_MAX_CONFIDENCE = 50;

export function analyze(db, page) {
    const detections = [];
    const scriptSrc = page.scriptSrc || [];
    const scripts = page.scripts || [];
    const css = page.css || [];
    const resourceUrls = page.resourceUrls || [];
    for (const tech of db.techs) {
        testPatterns(tech.url, page.url, 'url', detections, tech);
        testPatterns(tech.html, page.html, 'html', detections, tech);
        testPatterns(tech.text, page.text, 'text', detections, tech);
        for (const s of scriptSrc) testPatterns(tech.scriptSrc, s, 'scriptSrc', detections, tech);
        // A vendor URL that appears in inline JavaScript, a preload hint or an image reference is good evidence
        // that the technology is in use even though no <script src> names it: modern tag managers and headless
        // storefronts inject their scripts at runtime. Capped confidence keeps it weaker than a real script tag.
        if (tech.scriptSrc.length) {
            for (const s of resourceUrls) testPatterns(tech.scriptSrc, s, 'resourceUrl', detections, tech, undefined, RESOURCE_URL_MAX_CONFIDENCE);
        }
        if (tech.scripts.length) for (const s of scripts) testPatterns(tech.scripts, s, 'scripts', detections, tech);
        if (tech.css.length) for (const s of css) testPatterns(tech.css, s, 'css', detections, tech);
        for (const [k, pats] of Object.entries(tech.meta)) for (const v of page.meta?.[k] || []) testPatterns(pats, v, 'meta', detections, tech, k);
        for (const [k, pats] of Object.entries(tech.headers)) for (const v of page.headers?.[k] || []) testPatterns(pats, v, 'headers', detections, tech, k);
        for (const [k, pats] of Object.entries(tech.cookies)) {
            const vals = page.cookies?.[k];
            if (vals === undefined) continue;
            for (const v of vals.length ? vals : ['']) {
                for (const p of pats) {
                    if (p.source === '' || p.regex.test(v)) {
                        detections.push({ tech, type: 'cookies', key: k, confidence: p.confidence, version: resolveVersion(p, v), pattern: p.source, match: k });
                    }
                }
            }
        }
        for (const [k, pats] of Object.entries(tech.dns)) for (const v of page.dns?.[k.toUpperCase()] || []) testPatterns(pats, v, 'dns', detections, tech, k);
        if (tech.dom.length && page.$) analyzeDom(tech, page.$, detections);
    }
    return resolve(db, detections);
}

function analyzeDom(tech, $, detections) {
    for (const d of tech.dom) {
        let nodes;
        try {
            nodes = $(d.selector);
        } catch {
            continue;
        }
        if (!nodes || !nodes.length) continue;
        for (const p of d.exists) {
            detections.push({ tech, type: 'dom', key: d.selector, confidence: p.confidence, version: '', pattern: p.source, match: d.selector });
        }
        if (d.text.length) {
            const text = nodes.first().text();
            testPatterns(d.text, text, 'dom', detections, tech, d.selector);
        }
        for (const [attr, pats] of Object.entries(d.attributes)) {
            nodes.slice(0, 50).each((_, el) => {
                const v = $(el).attr(attr);
                if (v !== undefined) {
                    for (const p of pats) {
                        if (p.source === '' || p.regex.test(v)) {
                            detections.push({ tech, type: 'dom', key: `${d.selector}[${attr}]`, confidence: p.confidence, version: resolveVersion(p, v), pattern: p.source, match: String(v).slice(0, 160) });
                        }
                    }
                }
            });
        }
    }
}

function pickVersion(versions) {
    const vs = [...new Set(versions.filter(Boolean))];
    if (!vs.length) return '';
    // prefer the most specific (most dot-separated segments), then the highest
    vs.sort((a, b) => {
        const sa = a.split('.').length, sb = b.split('.').length;
        if (sa !== sb) return sb - sa;
        return b.localeCompare(a, undefined, { numeric: true });
    });
    return vs[0];
}

function resolve(db, detections) {
    /** @type {Map<string, {tech, confidence, versions: string[], evidence: object[]}>} */
    const found = new Map();
    for (const d of detections) {
        let f = found.get(d.tech.name);
        if (!f) {
            f = { tech: d.tech, confidence: 0, versions: [], evidence: [], seen: new Set() };
            found.set(d.tech.name, f);
        }
        const sig = `${d.type}|${d.key || ''}|${d.pattern}`;
        if (!f.seen.has(sig)) {
            f.seen.add(sig);
            f.confidence = Math.min(100, f.confidence + d.confidence);
            f.evidence.push({ type: d.type, key: d.key, pattern: d.pattern, match: d.match });
        }
        if (d.version) f.versions.push(d.version);
    }
    // implies (recursive)
    let changed = true;
    while (changed) {
        changed = false;
        for (const f of [...found.values()]) {
            for (const imp of f.tech.implies) {
                const t = db.byName.get(imp.name);
                if (!t) continue;
                const conf = Math.min(f.confidence, imp.confidence);
                const existing = found.get(t.name);
                if (!existing) {
                    found.set(t.name, { tech: t, confidence: conf, versions: [], evidence: [{ type: 'implied', key: f.tech.name, pattern: '', match: '' }], seen: new Set(), implied: true });
                    changed = true;
                } else if (existing.implied && existing.confidence < conf) {
                    existing.confidence = conf;
                }
            }
        }
    }
    // excludes
    for (const f of [...found.values()]) for (const ex of f.tech.excludes) if (found.has(ex) && found.get(ex).confidence <= f.confidence) found.delete(ex);
    // requires / requiresCategory (iterate to a fixed point)
    changed = true;
    while (changed) {
        changed = false;
        const cats = new Set([...found.values()].flatMap((f) => f.tech.cats));
        for (const [name, f] of [...found.entries()]) {
            const okReq = f.tech.requires.every((r) => found.has(r));
            const okCat = f.tech.requiresCategory.every((c) => cats.has(c));
            if (!okReq || !okCat) {
                found.delete(name);
                changed = true;
            }
        }
    }
    return [...found.values()]
        .map((f) => ({
            name: f.tech.name,
            slug: slugify(f.tech.name),
            confidence: f.confidence,
            version: pickVersion(f.versions) || null,
            categories: f.tech.cats.map((id) => ({ id, name: db.categories[id]?.name || String(id) })),
            website: f.tech.website || null,
            description: f.tech.description || null,
            icon: f.tech.icon ? `https://www.wappalyzer.com/images/icons/${encodeURIComponent(f.tech.icon)}` : null,
            saas: f.tech.saas ?? null,
            oss: f.tech.oss ?? null,
            pricing: f.tech.pricing || [],
            evidence: f.evidence.slice(0, 8),
        }))
        .sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name));
}

export const slugify = (s) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

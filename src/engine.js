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

/**
 * Literal text a regex cannot match without, lowercased: one string per top-level alternative, or null when an
 * alternative has none of at least three characters. Patterns run against a whole page (html, inline scripts) are
 * skipped when none of their strings occurs in it: those regexes were three quarters of a scan's CPU, and most
 * cannot match a given page. Only text outside every group counts, and a character a quantifier makes optional
 * ends a run, so a string reported here is in every match.
 */
export function requiredLiterals(source) {
    const alternatives = [];
    let depth = 0;
    let inClass = false;
    let start = 0;
    for (let i = 0; i < source.length; i += 1) {
        const c = source[i];
        if (c === '\\') {
            i += 1;
        } else if (inClass) {
            if (c === ']') inClass = false;
        } else if (c === '[') {
            inClass = true;
        } else if (c === '(') {
            depth += 1;
        } else if (c === ')') {
            depth -= 1;
        } else if (c === '|' && depth === 0) {
            alternatives.push(source.slice(start, i));
            start = i + 1;
        }
    }
    alternatives.push(source.slice(start));
    const out = [];
    for (const alternative of alternatives) {
        const literal = longestLiteral(alternative);
        if (literal === null || literal.length < 3) return null;
        out.push(literal.toLowerCase());
    }
    return out;
}

function longestLiteral(source) {
    let best = '';
    let run = '';
    const endRun = () => {
        if (run.length > best.length) best = run;
        run = '';
    };
    let i = 0;
    while (i < source.length) {
        const c = source[i];
        let literal = null;
        let next = i + 1;
        if (c === '\\') {
            const e = source[i + 1];
            if (e === undefined) return null;
            if (/[^A-Za-z0-9]/.test(e)) literal = e;
            else if (e === 'x') next = i + 4;
            else if (e === 'u') next = source[i + 2] === '{' ? source.indexOf('}', i) + 1 : i + 6;
            else if (e === 'c') next = i + 3;
            else if (e === 'k') next = source.indexOf('>', i) + 1;
            else if (/[0-9]/.test(e)) for (next = i + 1; /[0-9]/.test(source[next] ?? ''); next += 1);
            if (next <= i) return null;
            if (literal !== null || !/[xuck0-9]/.test(e)) next = Math.max(next, i + 2);
        } else if (c === '[') {
            let j = i + 1;
            for (; j < source.length && source[j] !== ']'; j += 1) if (source[j] === '\\') j += 1;
            if (j >= source.length) return null;
            next = j + 1;
        } else if (c === '(') {
            let depth = 0;
            let j = i;
            for (; j < source.length; j += 1) {
                const x = source[j];
                if (x === '\\') {
                    j += 1;
                } else if (x === '[') {
                    for (j += 1; j < source.length && source[j] !== ']'; j += 1) if (source[j] === '\\') j += 1;
                } else if (x === '(') {
                    depth += 1;
                } else if (x === ')' && (depth -= 1) === 0) {
                    break;
                }
            }
            if (j >= source.length) return null;
            next = j + 1;
        } else if ('*+?{}'.includes(c)) {
            return null;
        } else if (!'.^$|)'.includes(c)) {
            literal = c;
        }
        let optional = false;
        let repeated = false;
        const q = source[next];
        if (q === '*' || q === '?') {
            optional = true;
            next += 1;
        } else if (q === '+') {
            repeated = true;
            next += 1;
        } else if (q === '{') {
            const m = /^\{(\d*)(,?)(\d*)\}/.exec(source.slice(next));
            if (m) {
                const min = Number(m[1] || 0);
                optional = min === 0;
                repeated = !optional && !(m[2] === '' && min === 1);
                next += m[0].length;
            }
        }
        if (source[next] === '?' && (optional || repeated || q === '{')) next += 1;
        if (literal === null || optional) {
            endRun();
        } else {
            run += literal;
            if (repeated) endRun();
        }
        i = next;
    }
    endRun();
    return best;
}
const parsePatternMap = (obj) => {
    const out = {};
    for (const [k, v] of Object.entries(obj || {})) out[k.toLowerCase()] = parsePatterns(v);
    return out;
};

function compileDom(dom) {
    // string | string[] | { selector: { exists, text, attributes, properties } }
    if (!dom) return [];
    if (typeof dom === 'string' || Array.isArray(dom)) {
        return toArray(dom).map((selector) => ({ selector, tokens: selectorTokens(selector), exists: [parsePattern('')], text: [], attributes: {} }));
    }
    return Object.entries(dom).map(([selector, spec]) => ({
        selector,
        tokens: selectorTokens(selector),
        exists: spec.exists !== undefined ? parsePatterns(spec.exists === '' ? '' : spec.exists) : [],
        text: parsePatterns(spec.text),
        attributes: parsePatternMap(spec.attributes),
    }));
}

/**
 * Text a selector cannot match without: the ids, classes, attribute names and attribute values it names, one list
 * per comma-separated alternative, lowercased. Running every fingerprint's selectors over every page was most of a
 * scan's CPU on Apify's half-core runs, and on a given page almost none of them can match. Anything this cannot
 * read safely returns null and is always evaluated: escapes, functional pseudo-classes other than :not (whose
 * contents name things that must be absent, so they add no requirement), and values HTML may write as entities.
 */
export function selectorTokens(selector) {
    const source = String(selector ?? '');
    if (source.includes('\\')) return null;
    const alternatives = splitTopLevel(source);
    if (!alternatives) return null;
    const out = [];
    for (const alternative of alternatives) {
        let rest = removeNegations(alternative);
        if (rest === null || /:[a-z-]+\(/i.test(rest)) return null;
        const tokens = [];
        rest = rest.replace(/\[\s*([^\s~|^$*=\]]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]*)))?\s*(?:[iIsS]\s*)?\]/g, (_, name, op, dq, sq, bare) => {
            tokens.push(name);
            const value = dq ?? sq ?? bare;
            if (op && value && !/[&<>"']/.test(value)) tokens.push(value);
            return ' ';
        });
        if (/[[\]"']/.test(rest)) return null;
        for (const m of rest.matchAll(/[#.]([A-Za-z_-][A-Za-z0-9_-]*)/g)) tokens.push(m[1]);
        out.push(tokens.map((t) => t.toLowerCase()));
    }
    return out;
}

/** Splits a selector list on its top-level commas; null when quotes or brackets do not balance. */
function splitTopLevel(source) {
    const parts = [];
    let depth = 0;
    let quote = null;
    let start = 0;
    for (let i = 0; i < source.length; i += 1) {
        const c = source[i];
        if (quote) {
            if (c === quote) quote = null;
        } else if (c === '"' || c === "'") quote = c;
        else if (c === '(' || c === '[') depth += 1;
        else if (c === ')' || c === ']') depth -= 1;
        else if (c === ',' && depth === 0) {
            parts.push(source.slice(start, i));
            start = i + 1;
        }
        if (depth < 0) return null;
    }
    if (quote || depth !== 0) return null;
    parts.push(source.slice(start));
    return parts.map((p) => p.trim()).filter(Boolean);
}

/** The selector without its :not(...) groups; null when a group never closes. */
function removeNegations(source) {
    let out = '';
    let i = 0;
    while (i < source.length) {
        if (source.slice(i, i + 5).toLowerCase() !== ':not(') {
            out += source[i];
            i += 1;
            continue;
        }
        let depth = 0;
        let quote = null;
        let j = i + 4;
        for (; j < source.length; j += 1) {
            const c = source[j];
            if (quote) {
                if (c === quote) quote = null;
            } else if (c === '"' || c === "'") quote = c;
            else if (c === '(') depth += 1;
            else if (c === ')' && --depth === 0) break;
        }
        if (j >= source.length) return null;
        out += ' ';
        i = j + 1;
    }
    return out;
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
        html: withLiterals(parsePatterns(t.html)),
        text: parsePatterns(t.text),
        css: parsePatterns(t.css),
        scriptSrc: parsePatterns(t.scriptSrc),
        scripts: withLiterals(parsePatterns(t.scripts)),
        meta: parsePatternMap(t.meta),
        headers: parsePatternMap(t.headers),
        cookies: parsePatternMap(t.cookies),
        dns: parsePatternMap(t.dns),
        dom: compileDom(t.dom),
    };
}
/** Inline scripts are part of the raw HTML, so a literal missing from the page is missing from every script too. */
function withLiterals(patterns) {
    return patterns.map((p) => ({ ...p, literals: requiredLiterals(p.regex.source) }));
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
    // Every selector token gets an id, and one pass over a page finds them all; one includes() per token rescanned
    // the whole page each time and cost more than the selectors it skipped.
    const tokenIds = new Map();
    const idOf = (token) => {
        if (!tokenIds.has(token)) tokenIds.set(token, tokenIds.size);
        return tokenIds.get(token);
    };
    for (const t of techs) {
        for (const d of t.dom) if (d.tokens) d.tokenIds = d.tokens.map((alternative) => alternative.map(idOf));
        for (const p of [...t.html, ...t.scripts]) p.literalIds = p.literals ? p.literals.map(idOf) : null;
    }
    return { categories, techs, byName, findTokens: buildMatcher([...tokenIds.keys()]) };
}

/**
 * Aho-Corasick over a fixed list of strings: one pass over a text reports which of them occur in it, whatever
 * their number. Returns a function from text to a Uint8Array marking each string found, by index.
 */
export function buildMatcher(words) {
    const next = [new Map()];
    const fail = [0];
    const hits = [[]];
    words.forEach((word, id) => {
        let state = 0;
        for (const ch of word) {
            let to = next[state].get(ch);
            if (to === undefined) {
                to = next.length;
                next.push(new Map());
                fail.push(0);
                hits.push([]);
                next[state].set(ch, to);
            }
            state = to;
        }
        hits[state].push(id);
    });
    const queue = [...next[0].values()];
    for (let head = 0; head < queue.length; head += 1) {
        const from = queue[head];
        for (const [ch, to] of next[from]) {
            queue.push(to);
            let f = fail[from];
            while (f && !next[f].has(ch)) f = fail[f];
            const target = from === 0 ? 0 : (next[f].get(ch) ?? 0);
            fail[to] = target === to ? 0 : target;
            if (hits[fail[to]].length) hits[to] = hits[to].concat(hits[fail[to]]);
        }
    }
    return (text) => {
        const found = new Uint8Array(words.length);
        let state = 0;
        for (const ch of text) {
            while (state && !next[state].has(ch)) state = fail[state];
            state = next[state].get(ch) ?? 0;
            const h = hits[state];
            for (let i = 0; i < h.length; i += 1) found[h[i]] = 1;
        }
        return found;
    };
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

function testPatterns(patterns, value, type, out, tech, keyName, maxConfidence = 100, present = null) {
    if (!value) return;
    for (const p of patterns) {
        if (present && p.literalIds && !p.literalIds.some((id) => present[id])) continue;
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
    const present = db.findTokens(String(page.html ?? '').toLowerCase());
    for (const tech of db.techs) {
        testPatterns(tech.url, page.url, 'url', detections, tech);
        testPatterns(tech.html, page.html, 'html', detections, tech, undefined, 100, present);
        testPatterns(tech.text, page.text, 'text', detections, tech);
        for (const s of scriptSrc) testPatterns(tech.scriptSrc, s, 'scriptSrc', detections, tech);
        // A vendor URL that appears in inline JavaScript, a preload hint or an image reference is good evidence
        // that the technology is in use even though no <script src> names it: modern tag managers and headless
        // storefronts inject their scripts at runtime. Capped confidence keeps it weaker than a real script tag.
        if (tech.scriptSrc.length) {
            for (const s of resourceUrls) testPatterns(tech.scriptSrc, s, 'resourceUrl', detections, tech, undefined, RESOURCE_URL_MAX_CONFIDENCE);
        }
        if (tech.scripts.length) for (const s of scripts) testPatterns(tech.scripts, s, 'scripts', detections, tech, undefined, 100, present);
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
        if (tech.dom.length && page.$) analyzeDom(tech, page.$, detections, present);
    }
    return resolve(db, detections);
}

function analyzeDom(tech, $, detections, present) {
    for (const d of tech.dom) {
        if (d.tokenIds && !d.tokenIds.some((alternative) => alternative.every((id) => present[id]))) continue;
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

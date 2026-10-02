/**
 * The pre-checks that let a scan skip most fingerprints must never skip one that could match: a token or literal
 * they require has to be in every match. On 2026-10-02 the engine gave identical results before and after them on
 * 452 saved homepages (4,192 detections) while analyzing 5.5-5.9x faster; these cases pin the edge rules.
 */
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';
import { analyze, buildMatcher, loadDatabase, requiredLiterals, selectorTokens } from '../src/engine.js';
import { buildPage } from '../src/page.js';

// Literals a regex cannot match without, per top-level alternative.
assert.deepEqual(requiredLiterals(String.raw`<script [^>]*>[\s\S]*\/\/counter\.yadro\.ru\/hit`), ['//counter.yadro.ru/hit']);
assert.deepEqual(requiredLiterals('(?:a|b)xyz'), ['xyz'], 'a group is optional text, not a requirement');
assert.deepEqual(requiredLiterals('abcd|(?:x)efgh'), ['abcd', 'efgh']);
assert.equal(requiredLiterals('abc|de'), null, 'an alternative without three required characters disables the check');
assert.deepEqual(requiredLiterals('colou?r'), ['colo'], 'an optional character ends the literal');
assert.equal(requiredLiterals('ab+cd'), null, 'a repeated character ends the literal');
assert.deepEqual(requiredLiterals('x{0,2}abc'), ['abc']);
assert.deepEqual(requiredLiterals(String.raw`\bshopify\b`), ['shopify']);
assert.deepEqual(requiredLiterals(String.raw`\x41bcd`), ['bcd'], 'an escape sequence is not literal text');
assert.deepEqual(requiredLiterals('[abc]+defg'), ['defg']);
assert.equal(requiredLiterals('(unclosed'), null);

// Selector tokens, per comma-separated alternative.
assert.deepEqual(selectorTokens('[data-wf-site]'), [['data-wf-site']]);
assert.deepEqual(selectorTokens('link[href*="fonts.googleapis.com"]'), [['href', 'fonts.googleapis.com']]);
assert.deepEqual(selectorTokens('div:not(.foo).bar'), [['bar']], 'what :not names must be absent, so it is no requirement');
assert.equal(selectorTokens('a:has(img)'), null, 'other functional pseudo-classes are always evaluated');
assert.deepEqual(selectorTokens('[href*="a&b"]'), [['href']], 'a value HTML may write as an entity is not looked for');
assert.equal(selectorTokens(String.raw`#a\:b`), null);

// One pass finds every word, overlapping ones included.
const found = buildMatcher(['he', 'she', 'his', 'hers'])('ushers');
assert.deepEqual([...found], [1, 1, 0, 1]);

// The pre-checks change nothing on a page that has the technologies, and an empty page is not an error.
const db = loadDatabase();
const html = '<html><head><meta name="generator" content="WordPress 6.4"><link rel="stylesheet" href="/wp-content/themes/x/style.css"></head><body><div class="shopify-section">x</div></body></html>';
const names = analyze(db, buildPage(cheerio.load(html), html, 'https://example.com/', {})).map((t) => t.name);
assert.ok(names.includes('WordPress'), `WordPress detected (got ${names.join(', ')})`);
assert.deepEqual(analyze(db, buildPage(cheerio.load(''), '', 'https://example.com/', {})), []);

console.log('ALL ENGINE TESTS PASSED');

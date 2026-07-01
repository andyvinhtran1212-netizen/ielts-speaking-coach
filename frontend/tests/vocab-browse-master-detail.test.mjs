/**
 * vocab-browse-master-detail.test.mjs — Slice-1 (browse rework + render-fix).
 *
 * Tests the REAL pure functions (stressParts, articleBodyHTML) by extracting them
 * from js/vocabulary.js source (the file is a window/document IIFE, not importable),
 * plus static sentinels for the master-detail wiring. Zero-dep node:test.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const front = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const JS = front('js', 'vocabulary.js');
const LANDING = front('vocabulary.html');

// Extract a top-level `function NAME(args){…}` (2-space-indented close) and eval it.
function extractFn(src, name) {
  const re = new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}');
  const m = src.match(re);
  assert.ok(m, `could not extract ${name} from source`);
  return eval('(' + m[0] + ')');   // pure fns only (String/RegExp/Array)
}

const stressParts = extractFn(JS, 'stressParts');
const articleBodyHTML = extractFn(JS, 'articleBodyHTML');
const orthographicParts = extractFn(JS, 'orthographicParts');


// ── Slice-2: orthographic specimen (priority a) ─────────────────────────

describe('orthographicParts (R5a)', () => {
  test('me-TROP-o-lis → 4 syllables, primary #2', () => {
    const r = orthographicParts('me-TROP-o-lis');
    assert.deepEqual(r.parts, ['me', 'TROP', 'o', 'lis']);
    assert.equal(r.primary, 1);            // → "trọng âm 2"
  });
  test('in-fra-STRUC-ture → primary #3', () => {
    assert.equal(orthographicParts('in-fra-STRUC-ture').primary, 2);
  });
  test('lone token, no uppercase → it is the stress', () => {
    assert.deepEqual(orthographicParts('slum'), { parts: ['slum'], primary: 0 });
  });
  test('empty / multi-token-no-uppercase → null (fall back to IPA)', () => {
    assert.equal(orthographicParts(''), null);
    assert.equal(orthographicParts(null), null);
    assert.equal(orthographicParts('a-b-c'), null);
  });
});

describe('specimen priority (a → b → c)', () => {
  test('cardHTML uses specimenParts (orthographic first, then IPA)', () => {
    assert.match(JS, /function specimenParts\(/);
    assert.match(JS, /orthographicParts\(a\.syllables\)\s*\|\|\s*stressParts\(a\.pronunciation\)/);
  });
});


// ── mig112 field-reconcile: definition_vi + word_family + relabel ───────

describe('cardHTML field reconcile (mig112)', () => {
  test('VN line prefers curated definition_vi, falls back to gloss_vi', () => {
    assert.match(JS, /const defVi = \(a\.definition_vi && a\.definition_vi\.trim\(\)\) \? a\.definition_vi : a\.gloss_vi/);
    assert.match(JS, /va-def-vi">\$\{esc\(defVi\)\}/);
  });
  test('net rows: related_words → "Từ liên quan"; word_family → "Họ từ" (LECH fixed)', () => {
    assert.match(JS, /netRow\('Từ liên quan', a\.related_words\)/);
    assert.match(JS, /netRow\('Họ từ', a\.word_family\)/);
    assert.doesNotMatch(JS, /netRow\('Họ từ', a\.related_words\)/);   // old mislabel gone
  });
});


// ── R1/R2: stress parser ───────────────────────────────────────────────

describe('stressParts (R1/R2 fix)', () => {
  test('metropolis → stressed syllable is #2 (not #1)', () => {
    const r = stressParts('/məˈtrɒp.əl.ɪs/');
    assert.deepEqual(r.parts, ['mə', 'trɒp', 'əl', 'ɪs']);
    assert.equal(r.primary, 1);            // 0-based → "trọng âm 2"
  });
  test('cosmopolitan → stressed #3', () => {
    const r = stressParts('/ˌkɒz.məˈpɒl.ɪ.tən/');
    assert.equal(r.primary, 2);            // → "trọng âm 3"
    assert.equal(r.parts.length, 5);
  });
  test('single-syllable /slʌm/ → primary 0 (it IS the stress)', () => {
    assert.deepEqual(stressParts('/slʌm/'), { parts: ['slʌm'], primary: 0 });
  });
  test('multi-word idiom (has a space) → null (no specimen)', () => {
    assert.equal(stressParts('/ˈhʌs.əl ənd ˈbʌs.əl/'), null);
    assert.equal(stressParts('/ˌhɪt ðə ˈtaʊn/'), null);
  });
  test('empty / missing → null', () => {
    assert.equal(stressParts(''), null);
    assert.equal(stressParts(null), null);
  });
});


// ── R4: body de-dup ─────────────────────────────────────────────────────

describe('articleBodyHTML (R4 de-dup)', () => {
  test('seed word (no structured example) → strips leading <p>, keeps the rest', () => {
    const out = articleBodyHTML({ html: '<p>Đô thị lớn…</p>\n<h2>Ví dụ</h2>\n<p>example</p>' });
    assert.match(out, /Ví dụ/);
    assert.match(out, /id="article-body"/);
    assert.doesNotMatch(out, /Đô thị lớn/);     // leading gloss paragraph removed
  });
  test('word WITH structured example → body skipped entirely (no ## Ví dụ dup)', () => {
    assert.equal(articleBodyHTML({ html: '<p>g</p><h2>Ví dụ</h2><p>x</p>', example: 'a holistic approach' }), '');
  });
  test('word WITH structured memory_hook → body skipped', () => {
    assert.equal(articleBodyHTML({ html: '<p>g</p><h2>Ghi nhớ</h2><p>x</p>', memory_hook: 'mnemonic' }), '');
  });
  test('body that is ONLY the gloss → empty (no section)', () => {
    assert.equal(articleBodyHTML({ html: '<p>chỉ có gloss</p>' }), '');
  });
  test('no html → empty', () => {
    assert.equal(articleBodyHTML({ html: '' }), '');
    assert.equal(articleBodyHTML({}), '');
  });
});


// ── master-detail wiring (sentinels) ────────────────────────────────────

describe('vocabulary.js — master-detail wiring', () => {
  test('all data via window.api — NO raw fetch (grep-gate)', () => {
    assert.match(JS, /window\.api\.get\(/);
    assert.match(JS, /window\.api\.post\(/);     // analytics
    assert.doesNotMatch(JS, /\bfetch\s*\(/);     // converted off raw fetch
  });
  test('detects #vmd-shell → initBrowse; shared cardHTML for both surfaces', () => {
    assert.match(JS, /getElementById\('vmd-shell'\)/);
    assert.match(JS, /function initBrowse\(/);
    assert.match(JS, /cardHTML\(a\)\s*\+\s*articleBodyHTML\(a\)/);   // both panes reuse it
  });
  test('per-word fetch on select with a stale-guard + deep-link sync', () => {
    assert.match(JS, /\/api\/vocabulary\/articles\//);
    assert.match(JS, /\+\+state\.seq/);          // ignore stale responses on fast switching
    assert.match(JS, /history\.replaceState/);   // URL reflects the open word
  });
  // mig 122 — a slug can now live in several categories, so selection + deeplink
  // MUST key on (category, slug), else duplicate-slug rows highlight together and
  // a slug-only deeplink can open the wrong category's card.
  test('selection keys on (category, slug), not slug alone', () => {
    assert.match(JS, /const selKey = \(c, s\) =>/);            // composite key helper
    assert.match(JS, /state\.selected = selKey\(cat, slug\)/); // selectWord stores the pair
    // both the row template and markActive compare against selKey(...)
    assert.match(JS, /state\.selected === selKey\(w\.category, w\.slug\)/);
    assert.match(JS, /selKey\(r\.getAttribute\('data-cat'\), r\.getAttribute\('data-slug'\)\) === state\.selected/);
    assert.doesNotMatch(JS, /state\.selected === w\.slug\b/);  // old slug-only compare gone
  });
  test('deeplink resolves by (cat, slug) before falling back to slug-only', () => {
    assert.match(JS, /w\.slug === wantSlug && \(!wantCat \|\| w\.category === wantCat\)/);
  });
});

describe('vocabulary.html — master-detail shell', () => {
  test('aver-chrome + av-page + the vmd-* shell', () => {
    assert.match(LANDING, /<aver-chrome\s+active="vocabulary"\s*>/);
    assert.match(LANDING, /<body[^>]*class="[^"]*\bav-page\b/);
    for (const id of ['vmd-shell', 'vmd-rows', 'vmd-card', 'vmd-chips', 'vmd-q', 'vmd-back']) {
      assert.match(LANDING, new RegExp(`id="${id}"`));
    }
  });
  test('legacy category-grid markup gone', () => {
    assert.doesNotMatch(LANDING, /id="category-grid"/);
  });
  test('from=word-library back link → hub #word-library', () => {
    assert.match(LANDING, /id="vmd-hub-back"[^>]*href="\/pages\/vocabulary\.html#word-library"/);
    assert.match(JS, /params\.get\('from'\) === 'word-library'/);   // reveal logic
    assert.match(JS, /getElementById\('vmd-hub-back'\)/);
  });
});

/**
 * vocab-article-reskin.test.mjs — V-article slice.
 *
 * Pins the Vocabulary Wiki re-skin: both wiki surfaces (root vocabulary.html
 * landing + pages/vocab-article.html per-word) under <aver-chrome>, theme-aware
 * (--av-* tokens, no dark-hardcode), with the word-card design v2 markup
 * (stress specimen / collocation chips / callouts) emitted by vocabulary.js.
 * Zero-dep node:test (static sentinels).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const front = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');

const LANDING = front('vocabulary.html');
const ARTICLE = front('pages', 'vocab-article.html');
const CSS = front('css', 'vocab-wiki.css');
const JS = front('js', 'vocabulary.js');


// ── AG1: both wiki surfaces under the canonical chrome ─────────────────

describe('AG1 — aver-chrome on both wiki surfaces', () => {
  for (const [name, html] of [['landing', LANDING], ['article', ARTICLE]]) {
    test(`${name}: <aver-chrome active="vocabulary"> + component script + av-page body`, () => {
      assert.match(html, /<aver-chrome\s+active="vocabulary"\s*>/);
      assert.match(html, /src="\/js\/components\/aver-chrome\.js"/);
      assert.match(html, /<body[^>]*class="[^"]*\bav-page\b/);
    });
    test(`${name}: legacy custom dark <nav> removed`, () => {
      assert.doesNotMatch(html, /class="border-b border-white\/5 bg-black\/20/);
    });
  }
});


// ── AG2: theme-aware — no dark-hardcode left ───────────────────────────

describe('AG2 — de-darked (no hardcoded dark colours)', () => {
  for (const [name, html] of [['landing', LANDING], ['article', ARTICLE]]) {
    test(`${name}: no #07111f / text-white body / rgba(255,255,255 / teal rgba(20,184,166`, () => {
      assert.doesNotMatch(html, /#07111f/i);
      assert.doesNotMatch(html, /<body[^>]*\btext-white\b/);
      assert.doesNotMatch(html, /rgba\(\s*255\s*,\s*255\s*,\s*255/);
      assert.doesNotMatch(html, /rgba\(\s*20\s*,\s*184\s*,\s*166/);
    });
    test(`${name}: anti-flash theme bootstrap present`, () => {
      assert.match(html, /localStorage\.getItem\(\s*['"]av-theme['"]\s*\)/);
      assert.match(html, /prefers-color-scheme:\s*dark/);
    });
    // DEBT-2026-07-24-J step (c), decision 2026-07-25 — inverted. The v2 card
    // shipped its own 3-font stack (Fraunces + Hanken Grotesk + DM Mono), a
    // third parallel type system. The system now allows ONE controlled serif
    // (Lora) reserved for long-form reading; a word card is not long-form, so
    // vocab comes back to the canonical sans.
    test(`${name}: loads the canonical stack, none of the retired v2 fonts`, () => {
      for (const gone of [/family=Fraunces/, /DM\+Mono/, /Hanken\+Grotesk/]) {
        assert.doesNotMatch(html, gone, `${name}: retired v2 font still downloaded`);
      }
      assert.match(html, /family=Plus\+Jakarta\+Sans/);
      assert.match(html, /family=JetBrains\+Mono/);
      assert.match(html, /css\/vocab-wiki\.css/);
    });
  }
});


// ── token discipline in the shared re-skin CSS ─────────────────────────

describe('vocab-wiki.css — token discipline (theme-aware, no raw hex)', () => {
  test('many --av-* references', () => {
    const refs = (CSS.match(/var\(--av-/g) || []).length;
    assert.ok(refs > 40, `expected >40 --av-* refs, got ${refs}`);
  });
  test('no hardcoded hex/white/black colour declarations', () => {
    const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    const bad = stripped.match(/(?:color|background|border-color)\s*:\s*(#[0-9a-fA-F]{3,6}|white|black)\b/g) || [];
    assert.deepEqual(bad, [], `hardcoded colours: ${bad.join(', ')}`);
  });
  test('no force-dark rgba(255,255,255) / hardcoded teal rgba(20,184,166)', () => {
    const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.deepEqual(stripped.match(/rgba\(\s*255\s*,\s*255\s*,\s*255/g) || [], []);
    assert.deepEqual(stripped.match(/rgba\(\s*20\s*,\s*184\s*,\s*166/g) || [], []);
  });
  test('jade accent uses the new --av-vocab-* tokens', () => {
    assert.match(CSS, /var\(--av-vocab-jade\)/);
    assert.match(CSS, /var\(--av-vocab-jade-tint\)/);
  });
});


// ── AG3: word-card design v2 components rendered by vocabulary.js ───────

describe('AG3 — v2 card components', () => {
  test('CSS defines the signature stress specimen + chips + callouts + mini', () => {
    assert.match(CSS, /\.va-stress\b/);
    assert.match(CSS, /\.va-syl\.on\b/);          // stressed syllable enlarged
    assert.match(CSS, /\.va-chip\b/);             // collocation chip
    assert.match(CSS, /\.va-callout\.va-warn\b/); // "hay nhầm" amber
    assert.match(CSS, /\.va-callout\.va-hook\b/); // "mẹo nhớ" jade
    assert.match(CSS, /\.va-headword\b/);
    assert.match(CSS, /\.va-mini\b/);
  });
  test('headword + IPA reach type through tokens, not literal families', () => {
    // The card keeps its size/weight hierarchy — only the family changes.
    assert.match(CSS, /\.va-headword\s*\{[^}]*var\(--av-font-display\)/);
    assert.match(CSS, /\.va-ipa\s*\{[^}]*var\(--av-font-mono\)/);
    const live = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const gone of ['Fraunces', 'DM Mono', 'Hanken Grotesk']) {
      assert.ok(!live.includes(gone), `${gone} must be out of vocab-wiki.css`);
    }
  });
  test('vocabulary.js emits specimen + chips + callouts via the shared card builder', () => {
    // Slice-1 master-detail: stressSpecimen→stressParts/specimenHTML; the card is
    // built by cardHTML (shared by article page + detail pane); miniCard retired.
    assert.match(JS, /function stressParts\(/);
    assert.match(JS, /function specimenHTML\(/);
    assert.match(JS, /function cardHTML\(/);
    assert.match(JS, /class="va-chip"/);
    assert.match(JS, /va-callout va-warn/);
    assert.match(JS, /va-callout va-hook/);
    assert.match(JS, /class="va-headword"/);
  });
  test('detail card keeps the markdown body, de-duped (strip leading <p>)', () => {
    assert.match(JS, /function articleBodyHTML\(/);
    assert.match(JS, /id="article-body"/);
  });
});

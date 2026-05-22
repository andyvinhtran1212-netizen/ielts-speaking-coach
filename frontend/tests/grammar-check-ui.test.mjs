/**
 * frontend/tests/grammar-check-ui.test.mjs — Sprint 14.8
 *
 * Source-regex sentinels for the grammar-check UI surfaces:
 *
 *   1. `_grammarCheckBlock(grammar_check)` — grouped category list
 *      under the per-criterion feedback (D2a).
 *   2. `_renderTranscriptWithHighlights(transcript, gc)` — wavy
 *      underline + tooltip on the transcript surface (D2b).
 *   3. Bidirectional click handler (Pattern #32) — highlight ↔ list
 *      entry scroll.
 *
 * Pattern #26 (Sprint 14.6.1 lesson, re-applied as L14): the grammar
 * helpers must NOT bake inline color/background literals. The
 * visuals come from ds.css's --ds-grammar-* tokens that flip per
 * theme. These sentinels pin that contract source-side so no
 * headless browser is required in CI.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
function readFront(...parts) {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

const PRACTICE_JS = readFront('js', 'practice.js');
const DS_CSS      = readFront('css', 'ds.css');


// ── Helper: extract a JS function body by name from practice.js ────────────


function _extractFn(name) {
  const startRe = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{');
  const m = PRACTICE_JS.match(startRe);
  if (!m) throw new Error(`function ${name} not found in practice.js`);
  const startIdx = m.index + m[0].length;
  // Top-level (2-space-indented) `function` declarations are the
  // natural boundary inside the IIFE.
  const tail = PRACTICE_JS.slice(startIdx);
  const endMatch = tail.match(/\n  function\s+\w+/);
  return endMatch ? tail.slice(0, endMatch.index) : tail;
}


// ── 1) Helpers exist + are exposed ────────────────────────────────────────


describe('Sprint 14.8 — grammar-check JS helpers exist on the API surface', () => {

  test('practice.js defines _grammarCheckBlock', () => {
    assert.match(PRACTICE_JS, /function\s+_grammarCheckBlock\s*\(/);
  });

  test('practice.js defines _renderTranscriptWithHighlights', () => {
    assert.match(PRACTICE_JS, /function\s+_renderTranscriptWithHighlights\s*\(/);
  });

  test('helpers are exposed on window.IELTSPractice for test reuse', () => {
    // Pin the exported names so the cluster 14.x sentinels (and any
    // future debug snippets in the console) can reach them without
    // re-extracting the IIFE.
    assert.match(PRACTICE_JS, /_grammarCheckBlock:\s*_grammarCheckBlock/);
    assert.match(PRACTICE_JS, /_renderTranscriptWithHighlights:\s*_renderTranscriptWithHighlights/);
  });

});


// ── 2) Guard clauses for empty / legacy payloads (L16) ─────────────────────


describe('Sprint 14.8 — grammar-check helpers guard against legacy/empty payloads', () => {

  test('_grammarCheckBlock returns "" when grammar_check is null/undefined', () => {
    const body = _extractFn('_grammarCheckBlock');
    // First guard: !gc || !Array.isArray(gc.errors) || gc.errors.length === 0
    assert.match(body, /!\s*gc\s*\|\|\s*!Array\.isArray\(\s*gc\.errors\s*\)\s*\|\|\s*gc\.errors\.length\s*===\s*0/);
  });

  test('_renderTranscriptWithHighlights returns escaped raw text when no errors', () => {
    const body = _extractFn('_renderTranscriptWithHighlights');
    // The early-return path must call _esc to keep the unhighlighted
    // transcript safe from XSS.
    assert.match(body, /return\s+_esc\(raw\)/);
  });

  test('legacy data with grammar_issues but no grammar_check renders OK (L16)', () => {
    // The practice branch must call both _grammarIssuesBlock (Sprint
    // 14.5 textual list) AND _grammarCheckBlock (Sprint 14.8). When
    // grammar_check is absent the latter returns ''; the older
    // results render identically to pre-14.8.
    assert.match(
      PRACTICE_JS,
      /_grammarIssuesBlock\([\s\S]{0,200}_grammarCheckBlock\(\s*data\.grammar_check\s*\)/,
    );
  });

});


// ── 3) Pattern #26 — no inline color/background literals in helpers ─────


describe('Sprint 14.8 — grammar helpers carry NO inline color/bg literals (L14, Pattern #26)', () => {

  test('_grammarCheckBlock body has no inline color: style', () => {
    const body = _extractFn('_grammarCheckBlock');
    assert.doesNotMatch(body, /style\s*=\s*["'][^"']*color\s*:/,
      'Sprint 14.8 grammar list must reach colour through CSS classes ' +
      '(.ds-grammar-* in ds.css), not inline styles. Pattern #26 lesson.');
  });

  test('_grammarCheckBlock body has no inline background style', () => {
    const body = _extractFn('_grammarCheckBlock');
    assert.doesNotMatch(body, /style\s*=\s*["'][^"']*background/);
  });

  test('_renderTranscriptWithHighlights body has no inline color style', () => {
    const body = _extractFn('_renderTranscriptWithHighlights');
    assert.doesNotMatch(body, /style\s*=\s*["'][^"']*color\s*:/);
  });

  test('_renderTranscriptWithHighlights body has no inline background style', () => {
    const body = _extractFn('_renderTranscriptWithHighlights');
    assert.doesNotMatch(body, /style\s*=\s*["'][^"']*background/);
  });

  test('grammar helpers have no rgba/hex color literals', () => {
    const a = _extractFn('_grammarCheckBlock');
    const b = _extractFn('_renderTranscriptWithHighlights');
    assert.doesNotMatch(a, /rgba\(\s*\d+\s*,/);
    assert.doesNotMatch(b, /rgba\(\s*\d+\s*,/);
    // The error_id template uses offsets like "12-16" — make sure
    // the hex check doesn't false-match those by scoping to hash-style.
    assert.doesNotMatch(a, /#[0-9a-fA-F]{3,6}\b/);
    assert.doesNotMatch(b, /#[0-9a-fA-F]{3,6}\b/);
  });

  test('grammar helpers use the canonical .ds-grammar-* class names', () => {
    const a = _extractFn('_grammarCheckBlock');
    const b = _extractFn('_renderTranscriptWithHighlights');
    assert.match(a, /class="ds-grammar-section"/);
    assert.match(a, /class="ds-grammar-error-item"/);
    assert.match(b, /class="ds-grammar-highlight"/);
  });

});


// ── 4) Transcript highlight contract ──────────────────────────────────────


describe('Sprint 14.8 — transcript highlight contract', () => {

  test('highlight span carries data-error-id matching the list entry', () => {
    // Pattern #32 — bidirectional linking. The `id` is the
    // "<offset_start>-<offset_end>" string built in both helpers.
    const block = _extractFn('_grammarCheckBlock');
    const tran  = _extractFn('_renderTranscriptWithHighlights');
    assert.match(block, /data-error-id="/);
    assert.match(tran,  /data-error-id="/);
    // Both must compute the id the same way.
    assert.match(block, /e\.transcript_offset_start\s*\+\s*'-'\s*\+\s*e\.transcript_offset_end/);
    assert.match(tran,  /e\.transcript_offset_start\s*\+\s*'-'\s*\+\s*e\.transcript_offset_end/);
  });

  test('highlight is keyboard accessible (tabindex + role + aria-label)', () => {
    const body = _extractFn('_renderTranscriptWithHighlights');
    assert.match(body, /tabindex="0"/);
    assert.match(body, /role="button"/);
    assert.match(body, /aria-label=/);
  });

  test('highlight tooltip composes suggestion + VN explanation', () => {
    const body = _extractFn('_renderTranscriptWithHighlights');
    // The tooltip text builds "<suggestion> • <explanation_vn>" so
    // hovering surfaces both pieces without a second click.
    assert.match(body, /e\.suggestion[\s\S]{0,80}e\.explanation_vn/);
  });

  test('highlight skips overlapping spans defensively', () => {
    // The renderer must guard against backend bugs where two errors
    // overlap (e.g. two rules flag the same word). Without this,
    // innerHTML produces broken mark tags.
    const body = _extractFn('_renderTranscriptWithHighlights');
    assert.match(body, /e\.transcript_offset_start\s*<\s*cursor/);
  });

});


// ── 5) Bidirectional click handler ────────────────────────────────────────


describe('Sprint 14.8 — bidirectional click linking (Pattern #32)', () => {

  test('document click listener scrolls to .ds-grammar-error-item on highlight click', () => {
    assert.match(
      PRACTICE_JS,
      /closest\(['"]\.ds-grammar-highlight['"]\)[\s\S]{0,300}_scrollToGrammarEntry/,
    );
  });

  test('document click listener also handles reverse (list → highlight)', () => {
    assert.match(
      PRACTICE_JS,
      /closest\(['"]\.ds-grammar-error-item['"]\)[\s\S]{0,300}\.ds-grammar-highlight\[data-error-id=/,
    );
  });

  test('Enter / Space on focused highlight triggers scroll (keyboard a11y)', () => {
    // The listener pattern: keydown → key check (Enter or Space) →
    // closest('.ds-grammar-highlight') → _scrollToGrammarEntry. Match
    // tolerantly because the key-check can be either `===` (allowlist)
    // or `!==` (early-return guard).
    assert.match(
      PRACTICE_JS,
      /addEventListener\(['"]keydown['"][\s\S]{0,600}e\.key[\s\S]{0,80}['"]Enter['"][\s\S]{0,400}_scrollToGrammarEntry/,
    );
  });

  test('flash animation adds + removes is-flash class with a timeout', () => {
    assert.match(
      PRACTICE_JS,
      /classList\.add\(['"]is-flash['"]\)[\s\S]{0,200}setTimeout[\s\S]{0,80}classList\.remove\(['"]is-flash['"]\)/,
    );
  });

});


// ── 6) ds.css — grammar tokens defined for BOTH themes ───────────────────


describe('Sprint 14.8 — ds.css grammar tokens + rules cover both themes', () => {

  test('--ds-grammar-underline + tooltip tokens defined in dark-theme :root', () => {
    assert.match(DS_CSS, /:root\s*\{[\s\S]*?--ds-grammar-underline\s*:/);
    assert.match(DS_CSS, /:root\s*\{[\s\S]*?--ds-grammar-tooltip-bg\s*:/);
    assert.match(DS_CSS, /:root\s*\{[\s\S]*?--ds-grammar-tooltip-text\s*:/);
    assert.match(DS_CSS, /:root\s*\{[\s\S]*?--ds-grammar-flash-bg\s*:/);
  });

  test('light-theme overrides grammar tokens for WCAG AA contrast', () => {
    // Sprint 14.1 amber lesson re-applied: red-500 (#ef4444) on white
    // is 3.8:1 — below AA. Light theme must darken to red-700
    // (#b91c1c, 7.0:1) to clear AA.
    assert.match(
      DS_CSS,
      /:root\[data-theme="light"\]\s*\{[\s\S]*?--ds-grammar-underline\s*:\s*#b91c1c/,
    );
  });

  test('.ds-grammar-highlight rule binds to --ds-grammar-underline', () => {
    assert.match(
      DS_CSS,
      /\.ds-grammar-highlight\s*\{[\s\S]*?var\(--ds-grammar-underline\)/,
    );
  });

  test('.ds-grammar-highlight tooltip uses --ds-grammar-tooltip-* tokens', () => {
    assert.match(
      DS_CSS,
      /\.ds-grammar-highlight:hover::after[\s\S]{0,300}var\(--ds-grammar-tooltip-bg\)/,
    );
    assert.match(
      DS_CSS,
      /\.ds-grammar-highlight:hover::after[\s\S]{0,300}var\(--ds-grammar-tooltip-text\)/,
    );
  });

  test('.ds-grammar-error-item.is-flash binds to --ds-grammar-flash-bg', () => {
    assert.match(
      DS_CSS,
      /\.ds-grammar-error-item\.is-flash\s*\{[\s\S]*?var\(--ds-grammar-flash-bg\)/,
    );
  });

});


// ── 7) Transcript surface — uses highlight when grammar_check present ────


describe('Sprint 14.8 — _showFeedback wires highlight only when errors present', () => {

  test('transcript path uses innerHTML when grammar_check.errors > 0', () => {
    // The condition guard: hasGrammarErrors → innerHTML; else
    // textContent (safer for arbitrary text).
    assert.match(
      PRACTICE_JS,
      /hasGrammarErrors[\s\S]{0,300}transcriptText\.innerHTML\s*=\s*_renderTranscriptWithHighlights/,
    );
    assert.match(
      PRACTICE_JS,
      /transcriptText\.textContent\s*=\s*data\.transcript/,
    );
  });

});

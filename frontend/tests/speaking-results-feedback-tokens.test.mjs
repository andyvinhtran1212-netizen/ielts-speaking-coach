/**
 * frontend/tests/speaking-results-feedback-tokens.test.mjs — Sprint 14.6.1.
 *
 * Sprint 14.1 (PR #260) fixed `ds.css` legacy bridge + 12 hardcoded
 * white-literal CSS rules so the result page would read on light
 * theme. Andy's 2026-05-22 17:02 production screenshot showed bullets
 * in STRENGTHS / GRAMMAR ISSUES / VOCABULARY ISSUES still invisible —
 * because the bullets are NOT rendered from CSS rules. They're
 * string-concatenated HTML inside `frontend/js/practice.js` helper
 * functions (`_listBlock`, `_grammarIssuesBlock`, `_criterionBlock`,
 * etc.), and each helper hardcoded `style="color:rgba(255,255,255,X)"`
 * inline → white text on the light-theme `--av-surface-page` (#FAFAF9)
 * background → invisible. Sprint 14.1's source-scan sentinels only
 * audited `ds.css`; this JS surface was outside their scope.
 *
 * These sentinels close the gap. They scan the feedback-render helper
 * function bodies for `rgba(255,255,255,*)` text-color literals, and
 * pin that every body-text inline style uses the Sprint 14.1 `--ds-*`
 * token family so future cleanups can't silently regress.
 *
 * Source-level (no headless browser in CI); same approach as the
 * Sprint 14.1 sentinels.
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
const SPIKE_MD    = readFileSync(
  join(__dirname, '..', '..', 'commission',
       'sprint_14_6_1_spike', 'findings.md'),
  'utf8',
);


// ── Helper: extract a function body by name ─────────────────────────────


function _extractFunctionBody(name) {
  // Locate `function <name>(...)` and capture chars until the next
  // top-level `function` declaration in the file. Good enough for
  // these single-purpose helpers — they don't nest function decls.
  const startRe = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{');
  const startMatch = PRACTICE_JS.match(startRe);
  if (!startMatch) {
    throw new Error(`function ${name} not found in practice.js`);
  }
  const startIdx = startMatch.index + startMatch[0].length;
  // Find the next `\n  function` (peer declaration at the IIFE's
  // indentation level) — that's the natural boundary.
  const tail = PRACTICE_JS.slice(startIdx);
  const endRe = /\n  function\s+\w+/;
  const endMatch = tail.match(endRe);
  return endMatch ? tail.slice(0, endMatch.index) : tail;
}


// ── 1) Feedback-render helpers must not carry white-text inline styles ──


const FEEDBACK_RENDER_FUNCTIONS = [
  '_listBlock',
  '_grammarIssuesBlock',
  '_correctionsBlock',
  '_improvedBlock',
  '_sampleAnswerBlock',
  '_criterionBlock',
  '_reliabilityNote',
];

describe('Sprint 14.6.1 — feedback-render helpers use --ds-* tokens, not white literals', () => {

  for (const fn of FEEDBACK_RENDER_FUNCTIONS) {
    test(`${fn}() body contains no color:rgba(255,255,255,*) literal`, () => {
      const body = _extractFunctionBody(fn);
      // The literal pattern that broke Andy's screenshot. Match
      // tolerantly across whitespace + decimals.
      const re = /color\s*:\s*rgba\(\s*255\s*,\s*255\s*,\s*255\s*,/i;
      assert.doesNotMatch(
        body, re,
        `Sprint 14.6.1: ${fn} body still emits a white-text inline ` +
        `style; the bullet/text will be invisible on light theme. ` +
        `Replace with var(--ds-text), var(--ds-muted), or var(--ds-faint).`,
      );
    });

    test(`${fn}() references at least one --ds-* token`, () => {
      // Defensive — confirm the migration replaced the literal with
      // a token, not just deleted it.
      const body = _extractFunctionBody(fn);
      assert.match(
        body,
        /var\(--ds-(text|muted|faint|surface|border)\)/,
        `${fn} body must reference at least one --ds-* token`,
      );
    });
  }

});


// ── 2) Specific token migrations are byte-accurate ──────────────────────


describe('Sprint 14.6.1 — token migrations match Sprint 14.1 wiring', () => {

  test('_listBlock <li> uses var(--ds-text) for bullet body text', () => {
    const body = _extractFunctionBody('_listBlock');
    assert.match(
      body,
      /<li style="font-size:13px;color:var\(--ds-text\);/,
      '_listBlock <li> body text must use --ds-text so it flips per theme',
    );
  });

  test('_grammarIssuesBlock <li> uses var(--ds-text) for issue text', () => {
    const body = _extractFunctionBody('_grammarIssuesBlock');
    assert.match(
      body,
      /<li style="font-size:13px;color:var\(--ds-text\);/,
    );
  });

  test('_criterionBlock body paragraph uses var(--ds-text)', () => {
    const body = _extractFunctionBody('_criterionBlock');
    assert.match(
      body,
      /color:var\(--ds-text\)/,
    );
  });

  test('_correctionsBlock row background uses var(--ds-surface)', () => {
    // The corrections-row background was a hardcoded rgba(255,255,255,0.04);
    // on light theme that's an invisible-by-design overlay. Migrate to
    // --ds-surface which is var(--av-surface-sunken) under light theme.
    const body = _extractFunctionBody('_correctionsBlock');
    assert.match(body, /background:var\(--ds-surface\)/);
  });

  test('_correctionsBlock explanation line uses var(--ds-muted)', () => {
    const body = _extractFunctionBody('_correctionsBlock');
    assert.match(body, /color:var\(--ds-muted\);font-style:italic/);
  });

  test('_improvedBlock + _sampleAnswerBlock body text use var(--ds-text)', () => {
    const improved = _extractFunctionBody('_improvedBlock');
    const sample   = _extractFunctionBody('_sampleAnswerBlock');
    assert.match(improved, /color:var\(--ds-text\)/);
    assert.match(sample,   /color:var\(--ds-text\)/);
  });

  test('_reliabilityNote body text uses var(--ds-muted) (not white literal)', () => {
    const body = _extractFunctionBody('_reliabilityNote');
    assert.match(body, /color:var\(--ds-muted\)/);
  });

});


// ── 3) Stub-fallback (AI-unavailable) branch tokenised too ──────────────


describe('Sprint 14.6.1 — _showFeedback stub branches use --ds-* tokens', () => {

  test('stub-banner body copy uses var(--ds-muted) for AI-unavailable message', () => {
    // The Sprint 14.3 sentinel pinned this branch as part of the L8
    // all-providers-fail contract. Sprint 14.6.1 keeps that contract
    // intact but theme-fixes the body-copy colour. Use a window match
    // ([\s\S]{0,400}) to absorb the string-concat layout.
    assert.match(
      PRACTICE_JS,
      /Bản ghi âm và văn bản của bạn đã được lưu thành công/,
    );
    assert.match(
      PRACTICE_JS,
      /color:var\(--ds-muted\)[\s\S]{0,400}Bản ghi âm và văn bản của bạn đã được lưu thành công/,
      'AI-unavailable body copy must immediately follow the --ds-muted ' +
      'inline style — otherwise the migration only theme-fixed one of ' +
      'the two stub branches',
    );
  });

  test('"Không có nhận xét." empty case uses var(--ds-faint)', () => {
    assert.match(
      PRACTICE_JS,
      /color:var\(--ds-faint\);">Không có nhận xét\./,
    );
  });

});


// ── 4) Spike doc was produced + matches the actual fix ─────────────────


describe('Sprint 14.6.1 — spike provenance', () => {

  test('spike findings doc exists at the committed path', () => {
    assert.ok(SPIKE_MD.length > 0, 'spike findings file empty or missing');
  });

  test('spike doc names the root cause as inline JS white literals', () => {
    assert.match(SPIKE_MD, /rgba\(255,255,255/);
    assert.match(SPIKE_MD, /practice\.js/);
    assert.match(SPIKE_MD, /Sprint 14\.1/);
    // The "why Sprint 14.1 didn't catch this" section is the lesson
    // that motivates Pattern #26 below.
    assert.match(SPIKE_MD, /JavaScript|JS-side|inline styles/);
  });

  test('spike doc lists the inventory of 7 functions touched', () => {
    // Anchor the list — a future cleanup that drops functions from
    // the migration without updating the spike doc must fail this.
    for (const fn of FEEDBACK_RENDER_FUNCTIONS) {
      assert.ok(SPIKE_MD.includes(fn),
        `spike doc must mention ${fn} in the inventory`);
    }
  });

});

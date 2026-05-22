/**
 * frontend/tests/warning-banner-tokens.test.mjs — Sprint 14.7
 *
 * Sentinels for the off-topic + short-length warning banners.
 *
 * The banners are the user-facing surface for Sprint 14.7's two new
 * signals. Pattern #26 (Sprint 14.6.1 lesson): JS render helpers MUST
 * NOT bake inline color/background literals, otherwise the light-theme
 * flip silently breaks. These tests pin the contract source-side so
 * no headless browser is required in CI.
 *
 * Source-level only:
 *   - practice.js          → _warningBannerBlock helper
 *   - ds.css               → .ds-warning-banner rules + tokens
 *   - aver-design tokens.css already wired by Sprint 14.1
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


// ── Helper: extract _warningBannerBlock body ───────────────────────────────


function _extractBannerHelper() {
  const startRe = /function\s+_warningBannerBlock\s*\([^)]*\)\s*\{/;
  const m = PRACTICE_JS.match(startRe);
  if (!m) throw new Error('_warningBannerBlock not found in practice.js');
  const startIdx = m.index + m[0].length;
  // The next top-level `function` declaration (2-space indent inside
  // the IIFE) is the boundary.
  const tail = PRACTICE_JS.slice(startIdx);
  const endMatch = tail.match(/\n  function\s+\w+/);
  return endMatch ? tail.slice(0, endMatch.index) : tail;
}


// ── 1) Helper renders nothing when no warnings fire ────────────────────────


describe('Sprint 14.7 — _warningBannerBlock guard clauses', () => {

  test('helper exists and is exposed inside the practice.js IIFE', () => {
    assert.match(PRACTICE_JS, /function\s+_warningBannerBlock\s*\(/);
  });

  test('helper returns empty string when input is null/undefined', () => {
    const body = _extractBannerHelper();
    // The first guard must short-circuit on falsy input so the
    // .innerHTML concat path doesn't insert "undefined" text.
    assert.match(body, /if\s*\(\s*!\s*data\s*\)\s*return\s*['"]['"]\s*;/);
  });

  test('helper returns empty string when no warnings array entries', () => {
    const body = _extractBannerHelper();
    // The final guard must short-circuit the `warnings.length === 0`
    // case so we don't emit a `<div class="ds-result-warnings">` with
    // no children (would create stray top-padding above the feedback).
    assert.match(body, /warnings\.length\s*===\s*0/);
  });

});


// ── 2) Off-topic + length signals each gated correctly ─────────────────────


describe('Sprint 14.7 — warning-banner signal gating', () => {

  test('off-topic banner only renders when verdict.is_on_topic === false', () => {
    const body = _extractBannerHelper();
    // The condition must check both the presence of the verdict object
    // AND its boolean === false (so judge-not-run / null doesn't
    // false-positive into a banner).
    assert.match(
      body,
      /data\.off_topic_verdict[\s\S]{0,200}is_on_topic\s*===\s*false/,
    );
  });

  test('length banner only renders when length_warning === true', () => {
    const body = _extractBannerHelper();
    assert.match(body, /data\.length_warning\s*===\s*true/);
  });

  test('off-topic banner includes Vietnamese reasoning copy', () => {
    const body = _extractBannerHelper();
    assert.match(body, /Cảnh báo:.*chưa bám sát đề/);
    assert.match(body, /Lý do:/);
  });

  test('length banner includes Vietnamese threshold copy', () => {
    const body = _extractBannerHelper();
    assert.match(body, /ngắn hơn ngưỡng/);
    assert.match(body, /giới hạn band tối đa/);
  });

});


// ── 3) Pattern #26 (Sprint 14.6.1) — NO inline color/background literals ───


describe('Sprint 14.7 — banner JS helper carries NO inline color/bg literals (Pattern #26)', () => {

  test('_warningBannerBlock body contains no `color:` style literal', () => {
    // Pattern #26 lesson: Sprint 14.6.1 caught hardcoded
    // rgba(255,255,255,X) text colors that broke the light-theme
    // flip. The banner must reach colour through CSS classes
    // (.ds-warning-message → var(--ds-warning-text)) only.
    const body = _extractBannerHelper();
    assert.doesNotMatch(body, /style\s*=\s*["'][^"']*color\s*:/,
      'Sprint 14.7 banner must NOT bake inline color styles (Pattern #26). ' +
      'Use the .ds-warning-* CSS classes from ds.css instead.');
  });

  test('_warningBannerBlock body contains no `background` style literal', () => {
    const body = _extractBannerHelper();
    assert.doesNotMatch(body, /style\s*=\s*["'][^"']*background/,
      'Banner background must come from --ds-warning-bg (ds.css), ' +
      'not an inline style.');
  });

  test('_warningBannerBlock body contains no rgba/hex color literal', () => {
    const body = _extractBannerHelper();
    assert.doesNotMatch(body, /rgba\(\s*\d+\s*,/,
      'Banner helper must not emit rgba() literals — those bypass ' +
      'the --ds-warning-* tokens and break theme flip.');
    assert.doesNotMatch(body, /#[0-9a-fA-F]{3,6}\b/,
      'Banner helper must not emit hex color literals.');
  });

  test('_warningBannerBlock uses the canonical .ds-warning-banner class', () => {
    const body = _extractBannerHelper();
    assert.match(body, /class="ds-warning-banner"/);
    assert.match(body, /class="ds-warning-icon"/);
    assert.match(body, /class="ds-warning-message"/);
    assert.match(body, /class="ds-result-warnings"/);
  });

  test('banner carries role="alert" + aria-label for accessibility', () => {
    const body = _extractBannerHelper();
    assert.match(body, /role="alert"/);
    assert.match(body, /aria-label="Cảnh báo kết quả"/);
  });

});


// ── 4) ds.css — banner CSS rules + tokens defined for BOTH themes ─────────


describe('Sprint 14.7 — ds.css carries warning tokens + banner rules for both themes', () => {

  test('--ds-warning-bg / --ds-warning-border / --ds-warning-text defined in :root', () => {
    // The dark-theme defaults live under the bare :root block.
    assert.match(DS_CSS, /:root\s*\{[\s\S]*?--ds-warning-bg\s*:/);
    assert.match(DS_CSS, /:root\s*\{[\s\S]*?--ds-warning-border\s*:/);
    assert.match(DS_CSS, /:root\s*\{[\s\S]*?--ds-warning-text\s*:/);
  });

  test('light-theme overrides the warning tokens for WCAG AA contrast (L15)', () => {
    // Sprint 14.1 lesson: amber #fbbf24 on light bg fails 1.7:1. The
    // light-theme override MUST darken the text token so the banner
    // reaches ≥4.5:1 contrast.
    assert.match(
      DS_CSS,
      /:root\[data-theme="light"\]\s*\{[\s\S]*?--ds-warning-bg\s*:/,
    );
    assert.match(
      DS_CSS,
      /:root\[data-theme="light"\]\s*\{[\s\S]*?--ds-warning-text\s*:\s*#92400e/,
      'Sprint 14.1 L15 — light-theme warning text must be #92400e ' +
      '(amber-800) to clear WCAG AA on amber-100 background. ' +
      'Sprint 14.1 noted #fbbf24 → 1.7:1 fail.',
    );
  });

  test('.ds-warning-banner rule binds to the --ds-warning-* tokens', () => {
    // The banner's colour MUST come from the tokens (not literal),
    // otherwise the light-theme override is bypassed.
    assert.match(DS_CSS, /\.ds-warning-banner\s*\{[\s\S]*?var\(--ds-warning-bg\)/);
    assert.match(DS_CSS, /\.ds-warning-banner\s*\{[\s\S]*?var\(--ds-warning-border\)/);
    assert.match(DS_CSS, /\.ds-warning-message\s*\{[\s\S]*?var\(--ds-warning-text\)/);
  });

  test('.ds-result-warnings wrapper stacks banners with margin-bottom', () => {
    // L9 — multiple warnings stack cleanly above per-criterion
    // feedback. Without the wrapper's margin-bottom the first
    // criterion would visually merge with the last banner.
    assert.match(DS_CSS, /\.ds-result-warnings\s*\{[\s\S]*?margin-bottom\s*:/);
  });

});


// ── 5) _showFeedback wiring — banner prefixes ALL three branches ──────────


describe('Sprint 14.7 — _showFeedback prepends banner above every render branch', () => {

  test('_showFeedback assigns warningsHtml before any of the three branches', () => {
    // The banner must surface in stub, practice, and test mode — all
    // three branches consume `warningsHtml`. Pin the assignment so
    // a future refactor can't drop it from one branch.
    assert.match(
      PRACTICE_JS,
      /var\s+warningsHtml\s*=\s*_warningBannerBlock\(\s*data\s*\)/,
    );
  });

  test('practice-mode branch concatenates warningsHtml first', () => {
    // The practice branch (data.grammar_issues) must start with the
    // warningsHtml so the banner stacks above strengths/grammar/etc.
    assert.match(
      PRACTICE_JS,
      /grammar_issues[\s\S]{0,600}commentsEl\.innerHTML\s*=\s*warningsHtml\s*\+/,
    );
  });

  test('test-mode branch concatenates warningsHtml first', () => {
    assert.match(
      PRACTICE_JS,
      /fc_feedback[\s\S]{0,600}commentsEl\.innerHTML\s*=\s*warningsHtml\s*\+/,
    );
  });

});


// ── 6) Backward compat — legacy v1 results render without crashing ────────


describe('Sprint 14.7 — pre-14.7 results without new signal fields render OK', () => {

  test('helper short-circuits when data.off_topic_verdict is absent (undefined)', () => {
    // Sprint 14.4 + earlier saved feedback to localStorage with no
    // off_topic_verdict / length_warning fields. Re-rendering those
    // must not show stale or undefined banners. The is_on_topic ===
    // false strict-equality guard handles this (undefined !== false).
    const body = _extractBannerHelper();
    assert.match(body, /is_on_topic\s*===\s*false/);
    // Same for length_warning — the === true guard rejects undefined.
    assert.match(body, /length_warning\s*===\s*true/);
  });

});

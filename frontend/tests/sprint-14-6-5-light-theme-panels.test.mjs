/**
 * frontend/tests/sprint-14-6-5-light-theme-panels.test.mjs — Sprint 14.6.5
 *
 * Phase B light-theme follow-up. Sprint 14.6.1 PR #265 flagged three panels
 * that still baked inline white text and so vanished on the light theme:
 * the Pronunciation deep-analysis panel, the single-response pronunciation
 * block, and the Grammar Resources recommendation cards. Andy hit the
 * pronunciation panel on production session aacf39f6 (text invisible, only
 * the saturated-green score numbers survived).
 *
 * Pattern #26 (Sprint 14.6.1 lesson): JS render helpers must reach TEXT colour
 * through the theme-aware --ds-* tokens, never inline rgba(255,255,255,X) /
 * near-white hex — those don't flip on the light theme. Surface background /
 * border whites and saturated accent colours stay literal (they read on both
 * themes), so the scan is scoped to `color:` only (falsification #7).
 *
 * Also pins Bug 2: the per-question result card must read the pronunciation-
 * adjusted band so it agrees with the session overall.
 *
 * Source-level only — no headless browser needed in CI.
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
const RESULT_HTML = readFront('pages', 'result.html');


// Extract a top-level (2-space-indent) function body from the practice.js IIFE,
// bounded by the next `\n  function` declaration.
function extractFn(name) {
  const startRe = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{');
  const m = PRACTICE_JS.match(startRe);
  if (!m) throw new Error(name + ' not found in practice.js');
  const startIdx = m.index + m[0].length;
  const tail = PRACTICE_JS.slice(startIdx);
  const endMatch = tail.match(/\n  function\s+\w+/);
  return endMatch ? tail.slice(0, endMatch.index) : tail;
}

// Inline white TEXT colour: `color:` immediately followed by white rgba or a
// near-white hex. Does NOT match `background:`/`border:` rgba(255,255,255,…).
const WHITE_TEXT_RE = /color:\s*(?:rgba\(\s*255\s*,\s*255\s*,\s*255|#(?:fff(?:fff)?|e2e8f0|f1f5f9|f8fafc)\b)/i;

const MIGRATED_FNS = [
  '_pronChip',
  '_renderPronBlock',
  '_renderFullPronBlock',
  '_grammarCardHtml',
  '_fetchAndRenderFullPron',  // spinner + error states render into the pron block
];


// ── 1) Pattern #26 — NO inline white text colour in the migrated helpers ──────

describe('Sprint 14.6.5 — pronunciation + grammar-resources helpers carry no inline white text (Pattern #26)', () => {

  for (const fn of MIGRATED_FNS) {
    test(`${fn} body has no inline color:rgba(255,255,255,X) / near-white hex`, () => {
      const body = extractFn(fn);
      assert.doesNotMatch(body, WHITE_TEXT_RE,
        `${fn} must reach text colour via --ds-* tokens (Pattern #26), not an ` +
        `inline white literal — those break the light-theme flip.`);
    });

    test(`${fn} body reaches text colour through a --ds-* token`, () => {
      const body = extractFn(fn);
      assert.match(body, /color:\s*var\(--ds-(text|muted|faint)\)/,
        `${fn} should use var(--ds-text|muted|faint) for at least one text colour.`);
    });
  }

});


// ── 2) ds.css — the --ds-* text tokens flip for the light theme (regression) ──

describe('Sprint 14.6.5 — ds.css text tokens are theme-aware', () => {

  test('--ds-text / --ds-muted / --ds-faint defined in :root (dark default)', () => {
    assert.match(DS_CSS, /:root\s*\{[\s\S]*?--ds-text\s*:/);
    assert.match(DS_CSS, /:root\s*\{[\s\S]*?--ds-muted\s*:/);
    assert.match(DS_CSS, /:root\s*\{[\s\S]*?--ds-faint\s*:/);
  });

  test('light theme remaps the text tokens so migrated panels read on light bg', () => {
    assert.match(DS_CSS, /:root\[data-theme="light"\]\s*\{[\s\S]*?--ds-text\s*:/);
    assert.match(DS_CSS, /:root\[data-theme="light"\]\s*\{[\s\S]*?--ds-muted\s*:/);
    assert.match(DS_CSS, /:root\[data-theme="light"\]\s*\{[\s\S]*?--ds-faint\s*:/);
  });

});


// ── 3) Q-mode toggle — Phase B item closed by no-op (it is permanently hidden) ─

describe('Sprint 14.6.5 — Q-mode toggle needs no migration (always hidden)', () => {

  test('prep-mode-toggle is force-hidden, so its colours never render on any theme', () => {
    // Pattern #37: a deferred Phase B item that turned out to be dead code.
    // The toggle wrapper is set display:none unconditionally, so the inline
    // rgba on its buttons is unreachable — nothing to migrate.
    assert.match(
      PRACTICE_JS,
      /prep-mode-toggle'\)[\s\S]{0,160}toggleWrap\.style\.display\s*=\s*'none'/,
    );
  });

});


// ── 4) Bug 2 — per-question card uses the pronunciation-adjusted band ─────────

describe('Sprint 14.6.5 — result card band agrees with the session overall', () => {

  test('practice-mode card prefers r.final_overall_band over raw fb.overall_band', () => {
    // The session overall (session.overall_band) is pronunciation-adjusted.
    // The per-question card must read the same adjusted value so 5.5 (raw)
    // no longer contradicts 6.0 (adjusted) on the same session.
    assert.match(
      RESULT_HTML,
      /var\s+cardBand\s*=\s*\(\s*r\s*&&\s*r\.final_overall_band\s*!=\s*null\s*\)/,
    );
  });

  test('card still falls back to the raw holistic band for no-pronunciation sessions', () => {
    assert.match(RESULT_HTML, /r\.final_overall_band\s*!=\s*null\s*\)?[\s\S]{0,80}parseFloat\(fb\.overall_band\)/);
  });

});

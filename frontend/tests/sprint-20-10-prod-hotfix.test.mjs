/**
 * frontend/tests/sprint-20-10-prod-hotfix.test.mjs
 *
 * Sprint 20.10 — production hotfix sentinel (cluster 20.x post-close).
 *
 * Static-analysis pins on the 4 production-dogfood bugs Andy surfaced:
 *
 *   D2 — `[hidden]` actually hides state shells + timer wrap + palette.
 *        Before 20.10 the `display: flex|grid` rules silently overrode
 *        the user-agent `[hidden] { display: none }` default, so every
 *        state panel was visible at once.
 *
 *   D2 — JS state machine stops the timer interval when leaving
 *        in_progress, and startTimer is a no-op when the in_progress
 *        shell is hidden.
 *
 *   D3 — Palette renders grouped by passage_order ("Part 1 / Part 2 /
 *        Part 3"), not as a flat 1–N grid.
 *
 *   D4 — Results panel is hidden by default in the HTML (the CSS fix
 *        above is what makes that effective).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');


// ── D2/D4 — CSS [hidden] override (the root-cause fix) ────────────────


describe('Sprint 20.10 D2/D4 — CSS [hidden] honours the HTML attribute', () => {
  const css = read('frontend/css/reading-exam.css');

  test('all four state-bearing classes get an explicit [hidden] → display:none', () => {
    // The single most important regression guard for the cluster's
    // production-visibility bugs. Each of these classes had a base rule
    // that overrode `[hidden]`; the 20.10 fix restores user-agent default.
    for (const cls of ['exam-state-shell', 'exam-timer-wrap',
                       'exam-palette', 'exam-split']) {
      assert.match(
        css,
        new RegExp(`\\.${cls}\\[hidden\\]`),
        `missing explicit [hidden] override for .${cls}`,
      );
    }
    // …and the override uses `display: none !important` (not just a
    // milder rule that other future styles could re-override).
    assert.match(css, /display:\s*none\s*!important/);
  });

  test('exam-results state-shell is hidden by default in the HTML (D4)', () => {
    const html = read('frontend/pages/reading-exam.html');
    // Match `id="state-results"` AND `hidden` on the same tag.
    assert.match(html, /<main[^>]*id="state-results"[^>]*hidden[^>]*>/);
  });
});


// ── D2 — JS timer interval lifecycle is tied to the in_progress state ─


describe('Sprint 20.10 D2 — timer interval is bound to in_progress', () => {
  const js = read('frontend/js/reading-exam.js');

  test('stopTimer helper exists and clears SESSION.timer_interval', () => {
    assert.match(js, /function\s+stopTimer\s*\(/);
    // The body must clear the interval (otherwise it keeps ticking after
    // a transition away from in_progress — the dogfood symptom).
    assert.match(
      js,
      /function\s+stopTimer\s*\(\s*\)\s*\{[\s\S]{0,400}clearInterval\s*\(\s*SESSION\.timer_interval\s*\)/,
    );
  });

  test('showState calls stopTimer when leaving the in_progress state', () => {
    // Without this the interval keeps running after a state transition
    // — the "58:58 on the loading screen" symptom Andy hit in prod.
    assert.match(
      js,
      /name\s*!==?\s*'inprogress'\)\s*stopTimer\s*\(\s*\)/,
    );
  });

  test('startTimer short-circuits when the in_progress shell is hidden', () => {
    assert.match(
      js,
      /function\s+startTimer\s*\([\s\S]{0,400}state-inprogress[\s\S]{0,200}\.hidden\)\s*return/,
    );
  });
});


// ── D3 — Palette groups questions by passage_order ────────────────────


describe('Sprint 20.10 D3 — palette grouped by Part 1 / Part 2 / Part 3', () => {
  const js = read('frontend/js/reading-exam.js');
  const css = read('frontend/css/reading-exam.css');

  test('renderPalette accepts questions and groups by passage_order', () => {
    // The pre-20.10 signature was `renderPalette(totalQs)`; the new one
    // also takes the questions list to extract passage_order grouping.
    assert.match(js, /function\s+renderPalette\s*\(\s*totalQs\s*,\s*questions\s*\)/);
  });

  test("group labels follow the 'Part N' convention", () => {
    // The Cambridge / BC / IDP exam UX labels each cluster "Part 1/2/3".
    assert.match(js, /'Part '\s*\+\s*order/);
  });

  test("group containers carry the .exam-palette__group class", () => {
    assert.match(js, /class\s*=\s*['"]exam-palette__group['"]|className\s*=\s*['"]exam-palette__group['"]/);
  });

  test('CSS ships group-container + label styles', () => {
    assert.match(css, /\.exam-palette__group\s*\{/);
    assert.match(css, /\.exam-palette__group-label\s*\{/);
    // The 20.4c flat `grid-auto-flow: column; grid-auto-columns: 36px`
    // was on `.exam-palette__grid` itself; D3 swaps the grid to a flex
    // row of group containers, so the override must be explicit.
    assert.match(css, /\.exam-palette__grid\s*\{[\s\S]{0,200}display:\s*flex\s*!important/);
  });

  test('enterInProgress passes questions to renderPalette', () => {
    // Without this the renderPalette call falls back to the flat layout.
    // The first arg may be the literal `…total_questions…` access (the
    // 20.10 D3 pattern) OR the Sprint 20.13c `_totalQuestions()` helper
    // that wraps the same derivation — both satisfy the D3 intent (total
    // derives from data; questions list is the second arg for grouping).
    assert.match(
      js,
      /renderPalette\(\s*[\s\S]{0,200}(?:total_questions|_totalQuestions\(\))[\s\S]{0,100},\s*[\s\S]{0,200}questions[\s\S]{0,200}\)/,
    );
  });
});


// ── D1 reference — CORS allow_origin_regex shipped ────────────────────


describe('Sprint 20.10 D1 — backend CORS regex safety net (reference)', () => {
  // The test that actually exercises the live CORS middleware lives in
  // backend/tests/test_cors_averlearning.py. This sentinel just pins the
  // regex source string so a future refactor doesn't accidentally remove
  // the safety net without anyone noticing.
  test('main.py declares the averlearning regex on CORSMiddleware', () => {
    const py = read('backend/main.py');
    assert.match(py, /allow_origin_regex\s*=\s*_AVERLEARNING_ORIGIN_REGEX/);
    assert.match(py, /\^https:\/\/\(\?:\[a-z0-9-\]\+\\\.\)\?averlearning\\\.com\$/);
  });
});

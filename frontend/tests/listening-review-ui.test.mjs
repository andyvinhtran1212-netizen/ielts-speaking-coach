/**
 * frontend/tests/listening-review-ui.test.mjs
 *
 * listening-review-ui (Phase B) — full-screen listening chữa-bài reusing the
 * exam chrome + a sticky <audio-player> that replays each question's audio
 * window. Static-analysis sentinels pin the wiring + the contracts:
 *   • Lesson 16: the 🔊 replay drives the player with the REAL window seek
 *     values (segment-start = audio_window.start, segment-end = .end) — not a
 *     placeholder/0 — and EVERY question carrying a window renders a control;
 *   • XSS-safe solution rendering; token-clean CSS; CTA wired to the attempt.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

const html = read('frontend/pages/listening-review.html');
const js = read('frontend/js/listening-review.js');
const css = read('frontend/css/listening-review.css');
const playerHtml = read('frontend/pages/listening-test.html');
const playerJs = read('frontend/js/listening-test-player.js');
const router = read('backend/routers/listening.py');


describe('Phase B — review page (listening-review.html) reuses the exam chrome', () => {
  test('uses .exam-chrome + .exam-split shared shell', () => {
    assert.match(html, /<body class="exam-chrome"/);
    assert.match(html, /class="exam-split"/);
    assert.match(html, /href="\/css\/reading-exam-mockup\.css"/);   // chrome reuse
    assert.match(html, /href="\/css\/listening-review\.css"/);
  });
  test('mounts the shared <audio-player> in the bottom chrome + loads the page JS', () => {
    assert.match(html, /<script type="module" src="\/js\/components\/audio-player\.js">/);
    assert.match(html, /<audio-player id="lr-player">/);
    assert.match(html, /id="lr-bottombar"/);                 // item 1 — one bottom chrome
    assert.match(html, /class="lr-palette-strip" id="lr-nav-grid"/);
    assert.match(html, /src="\/js\/listening-review\.js"/);
  });
  test('ships transcript pane + section tabs + per-question review + palette', () => {
    for (const id of ['lr-transcript-body', 'lr-section-tabs', 'lr-review', 'lr-nav-grid']) {
      assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
    }
  });
});


describe('Phase B — data wiring', () => {
  test('fetches the submitted-only review endpoint', () => {
    assert.match(js, /\/api\/listening\/tests\/attempts\/'\s*\+\s*encodeURIComponent\(attemptId\)\s*\+\s*'\/review'/);
  });
  test('409 (not submitted) surfaces a friendly message, not a raw error', () => {
    assert.match(js, /status === 409[\s\S]{0,80}chưa nộp/);
  });
});


describe('Phase B — Lesson 16 (item 4): 🔊 = full-track seek to the REAL window start, no auto-stop', () => {
  test('locate() drops the segment window + seeks the player to win.start (real seconds)', () => {
    const fn = js.slice(js.indexOf('function locate'), js.indexOf('function highlightTranscriptLine'));
    assert.match(fn, /removeAttribute\('segment-start'\)/);   // full track, not a cut segment
    assert.match(fn, /removeAttribute\('segment-end'\)/);
    assert.match(fn, /\.seekTo\(win\.start\)/);               // real second seek (not placeholder/0)
    assert.ok(!/seekTo\(\s*0\s*\)/.test(fn), 'seek must come from the window, not 0');
    assert.ok(!/segment-start',\s*String\(win\.start\)/.test(fn), 'no longer constrains to a segment window');
  });
  test('the shared <audio-player> exposes seekTo() for full-track locate', () => {
    const apjs = read('frontend/js/components/audio-player.js');
    assert.match(apjs, /seekTo\(sec\)/);
    assert.match(apjs, /currentTime = t/);
  });
  test('every question with a window renders a 🔊 control wired to locate(q, win)', () => {
    assert.match(js, /var win = item\.audio_window/);
    assert.match(js, /clock\(win\.start\)\s*\+\s*'–'\s*\+\s*clock\(win\.end\)/);   // real label
    assert.match(js, /var tsBtn = win\s*\?[\s\S]{0,120}data-action="play"/);       // only when a window exists
    assert.match(js, /data-action="play"\][\s\S]{0,180}locate\(item\.q_num, win\)/); // click → locate
  });
});


describe('Phase B — item 7: 🔊 syncs the transcript (section switch + highlight)', () => {
  test('locate switches section + highlights the script line for that question', () => {
    assert.match(js, /selectSection\(sec\)/);
    assert.match(js, /highlightTranscriptLine\(qNum\)/);
    const hl = js.slice(js.indexOf('function highlightTranscriptLine'));
    assert.match(hl, /\.lr-tx-line\[data-qs~="' \+ qNum \+ '"\]/);   // anchor by q_num
    assert.match(hl, /classList\.add\('lr-src-hl'\)/);
    assert.match(hl, /scrollIntoView/);
  });
});


describe('Phase B — item 3: TTS markup transformed at render (kept in data)', () => {
  test('renderScript: speaker label, [stress]→emphasis, (Qn) kept, directives + fences hidden', () => {
    const fn = js.slice(js.indexOf('function renderScript'), js.indexOf('function formatWhyCorrect'));
    assert.ok(fn.includes('```'), 'strips ``` fences');               // never show fences
    assert.match(fn, /_speakerLabel/);                                 // [CODE] → readable label
    assert.match(fn, /lr-stress/);                                     // [stress:x] → emphasis
    assert.match(fn, /lr-qmark/);                                      // (Qn) marker kept (subtle)
    assert.ok(/\[\^\\\]\]/.test(fn), 'strips remaining [..] directives');  // [^\]] in the strip regex
  });
  test('renderScript used in BOTH the transcript pane and the card SCRIPT block', () => {
    assert.match(js, /html = renderScript\(script\)/);    // transcript model (per-Q)
    assert.match(js, /renderScript\(sol\.script\)/);      // card script block
  });
  test('escape-then-format throughout (XSS-safe)', () => {
    const fn = js.slice(js.indexOf('function renderScript'), js.indexOf('function formatWhyCorrect'));
    assert.match(fn, /escapeHtml\(line\)/);     // escape BEFORE layering stress/markup
    assert.match(js, /function escapeHtml/);
  });
});


describe('Phase B — item 5: no skill chips on per-question cards', () => {
  test('the Kĩ năng (K-code) chip is removed from review cards', () => {
    // it lived in the solution accordion; the comment marks the deliberate removal
    assert.match(js, /skill chips \(K1, K2…\) removed/);
    assert.ok(!/_solSection\('Kĩ năng'/.test(js), 'no skill section in the card');
  });
});


describe('Phase B — item 6: "Vì sao đúng" de-walled (EN/VN blocks, artifact stripped)', () => {
  test('formatWhyCorrect strips the raw _(From answer key notes):_ + splits EN/VN', () => {
    const fn = js.slice(js.indexOf('function formatWhyCorrect'), js.indexOf('function showState'));
    assert.match(fn, /From answer key notes/);            // strips the artifact
    assert.match(fn, /hasVietnamese\(p\)/);               // EN vs VN classification
    assert.match(fn, /lr-why--/);                         // block per language
    assert.match(js, /formatWhyCorrect\(sol\.why_correct\)/);  // used by the card
  });
});


describe('Phase B — item 8: dedup shared-window scripts + band floor', () => {
  test('buildTranscriptModel dedups shared-window questions into one line (Q7/Q8)', () => {
    const fn = js.slice(js.indexOf('function buildTranscriptModel'), js.indexOf('function selectSection'));
    assert.match(fn, /existing\.qs\.push/);              // merge duplicates by identical script
    assert.match(js, /setAttribute\('data-qs', ln\.qs\.join/);   // line tagged with all its q_nums
  });
  test('band below the conversion floor shows "Dưới band X", not "—"', () => {
    const fn = js.slice(js.indexOf('function renderSummary'));
    assert.match(fn, /Dưới band '/);
    assert.match(fn, /band_conversion/);                 // floor derived from the table
    assert.ok(!/\?\s*Number\(d\.band_estimate\)\.toFixed\(1\)\s*:\s*'—'/.test(fn), 'no bare — fallback');
  });
});


describe('Phase B — CTA from the test result → this attempt review', () => {
  test('results screen has a chữa-bài CTA the player points at the attempt', () => {
    assert.match(playerHtml, /id="res-chuabai"/);
    assert.match(playerJs, /res-chuabai[\s\S]{0,160}listening-review\.html\?attempt_id='\s*\+\s*encodeURIComponent\(STATE\.attemptId\)/);
  });
});


describe('Phase B — CSS token-clean (no hardcoded hex)', () => {
  test('listening-review.css uses only --av-*/--exam-* tokens, no hex', () => {
    assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(css), 'listening-review.css must use tokens, not hex');
  });
});


describe('Phase B — backend review endpoint cross-ref', () => {
  test('review endpoint is submitted-gated + joins audio_window + solution per q', () => {
    assert.match(router, /@user_router\.get\("\/tests\/attempts\/\{attempt_id\}\/review"\)/);
    assert.match(router, /Chưa có chữa bài — attempt chưa submit/);   // 409 gate
    assert.match(router, /"audio_window":\s*win/);
    assert.match(router, /"solution":\s*solutions_by_q\.get\(q\)/);
  });
});

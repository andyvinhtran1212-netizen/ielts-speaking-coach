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
  test('uses .exam-chrome + .exam-split + .exam-palette (shared shell)', () => {
    assert.match(html, /<body class="exam-chrome"/);
    assert.match(html, /class="exam-split"/);
    assert.match(html, /class="exam-palette"/);
    assert.match(html, /href="\/css\/reading-exam-mockup\.css"/);   // chrome reuse
    assert.match(html, /href="\/css\/listening-review\.css"/);
  });
  test('mounts the shared <audio-player> in a sticky bar + loads the page JS', () => {
    assert.match(html, /<script type="module" src="\/js\/components\/audio-player\.js">/);
    assert.match(html, /<audio-player id="lr-player">/);
    assert.match(html, /id="lr-player-bar"/);
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


describe('Phase B — Lesson 16: 🔊 drives the player with REAL window seek values', () => {
  test('playWindow sets segment-start/-end from the window start/end (not a placeholder)', () => {
    const fn = js.slice(js.indexOf('function playWindow'));
    assert.match(fn, /setAttribute\('segment-start', String\(win\.start\)\)/);
    assert.match(fn, /setAttribute\('segment-end', String\(win\.end\)\)/);
    assert.match(fn, /\.reset\(\)/);   // seek to start
    assert.match(fn, /\.play\(\)/);    // play → auto-pause at end
    // must NOT hardcode a 0/constant seek
    assert.ok(!/segment-start',\s*'0'/.test(fn), 'segment seek must come from the window, not 0');
  });
  test('every question with an audio_window renders a 🔊 timestamp control (coverage)', () => {
    // renderCard builds the control ONLY from `win`, labels it with the real
    // clock(start)–clock(end), and the click replays that window.
    assert.match(js, /var win = item\.audio_window/);
    assert.match(js, /clock\(win\.start\)\s*\+\s*'–'\s*\+\s*clock\(win\.end\)/);   // real seek values in the label
    assert.match(js, /var tsBtn = win\s*\?[\s\S]{0,120}data-action="play"/);       // control only when a window exists
    assert.match(js, /data-action="play"\][\s\S]{0,160}playWindow\(win\)/);        // click → replay that window
  });
});


describe('Phase B — XSS-safe solution rendering', () => {
  test('escape-then-format (#381): formatProse escapes before adding strong/code', () => {
    const fn = js.slice(js.indexOf('function formatProse'));
    assert.match(fn, /escapeHtml\(s\)/);
    assert.match(js, /function escapeHtml/);
  });
  test('transcript prose uses textContent (never innerHTML for raw text)', () => {
    assert.match(js, /p\.textContent = t/);
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

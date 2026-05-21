/**
 * frontend/tests/listening-test-player.test.mjs
 *
 * Sprint 13.5 — pin the student full-test player page + JS contract.
 *
 * The player is the largest surface of Sprint 13.5 (pre-start screen,
 * custom audio controls with NO seek, 4-section question paper,
 * debounced auto-save, submit + result panel with band + traps + per-Q).
 *
 * These sentinels catch:
 *   - the chrome integration regressing
 *   - the canonical endpoint paths (load / start / patch / submit)
 *     being silently changed
 *   - the "no seek" Cambridge constraint being lifted (no <input type="range">
 *     wired to audio.currentTime)
 *   - debounce-2s auto-save being dropped
 *   - the result-panel result-shape contract drifting from the backend
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = join(__dirname, '..', 'pages', 'listening-test.html');
const JS_PATH   = join(__dirname, '..', 'js', 'listening-test-player.js');
const HTML = readFileSync(HTML_PATH, 'utf8');
const JS   = readFileSync(JS_PATH, 'utf8');


describe('Sprint 13.5 — player page shell', () => {

  it('mounts <aver-chrome active="listening">', () => {
    assert.match(
      HTML,
      /<aver-chrome\s+active=["']listening["']\s*>\s*<\/aver-chrome>/,
    );
  });

  it('declares the three primary view sections (prestart / player / result)', () => {
    assert.match(HTML, /id="ft-prestart"/);
    assert.match(HTML, /id="ft-player"/);
    assert.match(HTML, /id="ft-result"/);
  });

  it('renders pre-start rules including the no-seek rule', () => {
    assert.match(HTML, /không tua lại/i);
    assert.match(HTML, /id="btn-start"/);
  });

  it('exposes audio controls but NO seek input (Cambridge constraint)', () => {
    assert.match(HTML, /id="btn-playpause"/);
    assert.match(HTML, /id="ft-volume"/);
    assert.match(HTML, /class="ft-speed-btn[^"]*"\s+data-speed="0\.75"/);
    assert.match(HTML, /class="ft-speed-btn[^"]*"\s+data-speed="1"/);
    assert.match(HTML, /class="ft-speed-btn[^"]*"\s+data-speed="1\.25"/);
    // The progress bar must NOT be wired as a seekable <input type="range">.
    const seekRange = /<input[^>]*type=["']range["'][^>]*(?:seek|currentTime|progress)/i;
    assert.ok(!seekRange.test(HTML), 'audio seek input must not be present');
  });

  it('renders progress text ("Đã trả lời X / 40") + the submit button', () => {
    assert.match(HTML, /Đã trả lời/);
    assert.match(HTML, /id="ft-answered"/);
    assert.match(HTML, /id="btn-submit"/);
  });

  it('declares all result-panel slots (score / band / pct / sections / traps / per-q)', () => {
    assert.match(HTML, /id="res-score"/);
    assert.match(HTML, /id="res-band"/);
    assert.match(HTML, /id="res-pct"/);
    assert.match(HTML, /id="res-sections"/);
    assert.match(HTML, /id="res-trap"/);
    assert.match(HTML, /id="res-per-q"/);
  });

  it('uses canonical tokens — no unexpected hex literals', () => {
    assert.match(HTML, /var\(--av-brand-teal-700\)/);
    const hex = HTML.match(/#[0-9a-fA-F]{3,6}/g) || [];
    const allowed = new Set(['#FEF2F2', '#991B1B', '#FECACA', '#DC2626']);
    for (const h of hex) {
      assert.ok(allowed.has(h),
        `unexpected hex literal ${h} in listening-test.html`);
    }
  });

  it('loads the player controller module', () => {
    assert.match(HTML, /\/js\/listening-test-player\.js/);
  });
});


describe('Sprint 13.5 — player JS contract', () => {

  it('boots Supabase via window.initSupabase (canonical ref)', () => {
    assert.match(JS, /nqhrtqspznepmveyurzm\.supabase\.co/);
    assert.match(JS, /window\.initSupabase\(/);
  });

  it('reads ?id=<uuid> from the URL', () => {
    assert.match(JS, /URLSearchParams\(window\.location\.search\)/);
    assert.match(JS, /sp\.get\(['"]id['"]\)/);
  });

  it('loads the test via GET /api/listening/tests/{id}', () => {
    assert.match(
      JS,
      /window\.api\.get\(`\/api\/listening\/tests\/\$\{encodeURIComponent\(testId\)\}`/,
    );
  });

  it('creates an attempt via POST /api/listening/tests/{id}/attempts', () => {
    assert.match(
      JS,
      /window\.api\.post\(\s*`\/api\/listening\/tests\/\$\{encodeURIComponent\(STATE\.testId\)\}\/attempts`/,
    );
  });

  it('confirms with the user before consuming an attempt slot', () => {
    assert.match(JS, /window\.confirm\(/);
    assert.match(JS, /Bắt đầu test\?/);
  });

  it('PATCHes answers via /api/listening/tests/attempts/{id}/answers', () => {
    assert.match(
      JS,
      /window\.api\.patch\(\s*`\/api\/listening\/tests\/attempts\/\$\{encodeURIComponent\(STATE\.attemptId\)\}\/answers`/,
    );
  });

  it('sends q_num + user_answer in the PATCH body', () => {
    assert.match(JS, /q_num:\s*qNum/);
    assert.match(JS, /user_answer:/);
  });

  it('debounces auto-save by 2000ms per gap (last-write-wins)', () => {
    assert.match(JS, /setTimeout\([\s\S]+?,\s*2000\s*\)/);
    assert.match(JS, /clearTimeout\(STATE\.saveTimers\.get\(qNum\)\)/);
  });

  it('rejects q_num outside 1..40 client-side as well', () => {
    assert.match(JS, /qNum\s*<\s*1\s*\|\|\s*qNum\s*>\s*40/);
  });

  it('NEVER seeks the audio (no audio.currentTime = ...)', () => {
    const seekAssign = /audio[^=]*\.currentTime\s*=\s*[^=]/;
    assert.ok(!seekAssign.test(JS),
      'player must never assign audio.currentTime (no-seek rule)');
  });

  it('flips Play/Pause label + cycles playbackRate via speed buttons', () => {
    assert.match(JS, /\.playbackRate\s*=\s*rate/);
    assert.match(JS, /'⏸ Pause'|"⏸ Pause"/);
    assert.match(JS, /'▶ Play'|"▶ Play"/);
  });

  it('submits via POST /api/listening/tests/attempts/{id}/submit', () => {
    assert.match(
      JS,
      /window\.api\.post\(\s*`\/api\/listening\/tests\/attempts\/\$\{encodeURIComponent\(STATE\.attemptId\)\}\/submit`/,
    );
  });

  it('confirms before submit + shows answered count in the dialog', () => {
    assert.match(JS, /Nộp bài bây giờ\?/);
    assert.match(JS, /\$\{answered\}\/40/);
  });

  it('flushes pending debounced saves before submitting', () => {
    assert.match(JS, /STATE\.saveTimers\.keys\(\)/);
    assert.match(JS, /clearTimeout\(STATE\.saveTimers\.get\(q\)\)/);
  });

  it('renders the result panel from the canonical shape', () => {
    assert.match(JS, /result\.score/);
    assert.match(JS, /result\.max_score/);
    assert.match(JS, /result\.band_estimate/);
    assert.match(JS, /result\.section_breakdown/);
    assert.match(JS, /result\.trap_analytics/);
    assert.match(JS, /result\.per_question/);
  });

  it('renders all four section cells (s1..s4)', () => {
    assert.match(JS, /\['s1','s2','s3','s4'\]/);
  });

  it('shows "Dưới band 4" when band_estimate is null', () => {
    assert.match(JS, /Dưới band 4/);
  });

  it('renders trap rollup as caught vs missed', () => {
    assert.match(JS, /Bắt được/);
    assert.match(JS, /Mắc bẫy/);
  });

  it('escapes user/test text via an esc() helper', () => {
    assert.match(JS, /function esc\(/);
    assert.match(JS, /esc\(item\.prompt/);
  });

  it('declares the MISSING / ERROR fallback states', () => {
    assert.match(JS, /showState\(['"]missing['"]\)/);
    assert.match(JS, /showState\(['"]error['"]\)/);
  });

  it('surfaces 404 + 422 from the load endpoint with VN copy', () => {
    assert.match(JS, /msg\.includes\(['"]404['"]\)/);
    assert.match(JS, /msg\.includes\(['"]422['"]\)/);
    assert.match(JS, /chưa có audio sẵn sàng/);
  });
});

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


describe('Item 9 — "Kĩ năng cần luyện" panel (skills to practise)', () => {
  test('aggregates K-codes from WRONG questions only, sorted by count', () => {
    const fn = js.slice(js.indexOf('function skillsToPractise'), js.indexOf('function renderSkillsPanel'));
    assert.match(fn, /if \(it\.correct\) return/);            // wrong-only
    assert.match(fn, /match\(\/K\[1-8\]\/g\)/);               // parse K-codes from free-text skills
    assert.match(fn, /b\.count - a\.count/);                  // sorted by count
  });
  test('uses the K1–K8 legend labels (not raw codes)', () => {
    assert.match(js, /K1: 'Nghe số/);
    assert.match(js, /K8: 'Map/);
  });
  test('renders the panel above the cards with a single generic practice CTA (option i)', () => {
    assert.match(js, /renderSkillsPanel\(items\)/);
    assert.match(js, /host\.appendChild\(panel\)[\s\S]{0,80}renderCard/);   // panel before cards
    assert.match(js, /lr-skills-panel__cta" href="\/pages\/listening\.html"/);  // generic CTA, no per-skill recommender
  });
  test('panel CSS is token-clean (no hex)', () => {
    const block = css.slice(css.indexOf('.lr-skills-panel'), css.indexOf('/* solution accordion */'));
    assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(block), 'skills panel CSS must use tokens');
  });
});


describe('r2 item 1 — tab gap root cause: pane padding-top zeroed so sticky bar is the top edge', () => {
  test('the transcript pane drops its padding-top (sticky top:0 then sits flush)', () => {
    assert.match(css, /#lr-transcript-pane\s*\{[^}]*padding-top:\s*0/);
  });
  test('section tabs no longer use the r1 negative top margin (the partial fix)', () => {
    const fn = css.slice(css.indexOf('.lr-section-tabs'));
    assert.match(fn, /position:\s*sticky;\s*top:\s*0/);
    assert.match(fn, /margin:\s*0 -28px/);                 // bleed sides only, no -20px top pull
    assert.ok(!/margin:\s*-20px -28px/.test(fn), 'the r1 negative top margin is gone');
  });
});


describe('r2 item 2 — player fills its row; hint is a thin caption line, not a flex sibling', () => {
  test('the hint span is OUTSIDE .lr-bottombar__player (so the player owns the width)', () => {
    const start = html.indexOf('lr-bottombar__player');
    const block = html.slice(start, html.indexOf('</div>', start));   // just the player div
    assert.ok(!/lr-player-label/.test(block), 'hint must not sit inside the player flex row');
    assert.match(html, /<\/div>\s*<span class="lr-player-label"/);   // sibling caption below player
  });
  test('the player audio-player flex-grows to full width', () => {
    assert.match(css, /\.lr-bottombar__player audio-player\s*\{[^}]*flex:\s*1 1 auto/);
    assert.match(css, /\.lr-bottombar__player audio-player\s*\{[^}]*width:\s*100%/);
  });
});


describe('r2 item 3 — palette strip spreads to fill the screen width', () => {
  test('q-buttons flex-grow equally (1 1 auto) instead of clustering left (0 0 auto)', () => {
    const fn = css.slice(css.indexOf('.lr-nav-q {'));
    assert.match(fn, /flex:\s*1 1 auto/);
    assert.ok(!/\.lr-nav-q \{[^}]*flex:\s*0 0 auto/.test(css), 'no longer fixed-size/left-clustered');
  });
});


describe('r2 item 5 — speaker labels = "Man:"/"Woman:" (no nationality), per-block disambiguation', () => {
  test('_speakerLabel returns Man/Woman by gender, drops accent', () => {
    const fn = js.slice(js.indexOf('function _speakerLabel'), js.indexOf('function _speakerMap'));
    assert.match(fn, /'Woman'\s*:\s*'Man'/);              // F → Woman, else Man
    assert.ok(!/Nam|Nữ|_ACCENT_VI/.test(fn), 'no Vietnamese gender / accent map');
  });
  test('_speakerMap numbers ≥2 same-gender speakers (Man 1 / Man 2) within one block', () => {
    const fn = js.slice(js.indexOf('function _speakerMap'), js.indexOf('function renderScript'));
    assert.match(fn, /byGender/);
    assert.match(fn, /codes\.length > 1 \? g \+ ' ' \+ \(i \+ 1\)/);   // index only when >1 same gender
  });
  test('renderScript renders the label with a colon (Man: / Woman:) using the block map', () => {
    const fn = js.slice(js.indexOf('function renderScript'), js.indexOf('function formatWhyCorrect'));
    assert.match(fn, /var smap = _speakerMap\(text\)/);
    assert.match(fn, /smap\[code\] \|\| _speakerLabel\(code\)/);
    assert.match(fn, /escapeHtml\(lbl\) \+ ':<\/span>'/);
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

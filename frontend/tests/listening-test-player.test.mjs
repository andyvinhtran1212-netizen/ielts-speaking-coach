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
    // Sprint 13.5.7 — Cambridge audio authenticity strict: only Play
    // button + volume slider. No seek, no speed control, no pause.
    assert.match(HTML, /id="btn-playpause"/);
    assert.match(HTML, /id="ft-volume"/);
    // The progress bar must NOT be wired as a seekable <input type="range">.
    const seekRange = /<input[^>]*type=["']range["'][^>]*(?:seek|currentTime|progress)/i;
    assert.ok(!seekRange.test(HTML), 'audio seek input must not be present');
    // Speed-control buttons removed in Sprint 13.5.7.
    assert.ok(!/data-speed="0\.75"/.test(HTML),
      'speed buttons must not render — Cambridge audio plays at 1.0× only');
    assert.ok(!/data-speed="1\.25"/.test(HTML),
      'speed buttons must not render — Cambridge audio plays at 1.0× only');
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

  it('rejects q_num outside 1..total client-side as well', () => {
    // #454 param-ized the upper bound from a literal 40 to the real total.
    assert.match(JS, /qNum\s*<\s*1\s*\|\|\s*qNum\s*>\s*\(STATE\.totalQuestions\s*\|\|\s*40\)/);
  });

  it('NEVER seeks the audio (no audio.currentTime = ...)', () => {
    const seekAssign = /audio[^=]*\.currentTime\s*=\s*[^=]/;
    assert.ok(!seekAssign.test(JS),
      'player must never assign audio.currentTime (no-seek rule)');
  });

  it('starts playback exactly once and locks the button (Cambridge single-shot)', () => {
    // Sprint 13.5.7 — togglePlay (Sprint 13.5) replaced with
    // startPlayback() that locks STATE.playbackStarted on first click.
    // playbackRate is pinned to 1.0; no pause path; no speed cycling.
    assert.match(JS, /function startPlayback\(/);
    assert.match(JS, /STATE\.playbackStarted/);
    assert.match(JS, /playbackRate\s*=\s*1\.0/);
    assert.match(JS, /'▶ Play'|"▶ Play"/);
    // Pause-side of the old toggle is gone.
    assert.ok(!/'⏸ Pause'|"⏸ Pause"/.test(JS),
      'pause label removed — Cambridge audio plays through');
    // The setSpeed handler is also gone.
    assert.ok(!/function setSpeed\b/.test(JS),
      'setSpeed handler removed in Sprint 13.5.7');
  });

  it('submits via POST /api/listening/tests/attempts/{id}/submit', () => {
    assert.match(
      JS,
      /window\.api\.post\(\s*`\/api\/listening\/tests\/attempts\/\$\{encodeURIComponent\(STATE\.attemptId\)\}\/submit`/,
    );
  });

  it('confirms before submit + shows answered count in the dialog', () => {
    assert.match(JS, /Nộp bài bây giờ\?/);
    // #454 param-ized the denominator from a literal 40 to the real total.
    assert.match(JS, /\$\{answered\}\/\$\{STATE\.totalQuestions\s*\|\|\s*40\}/);
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

  it('renders one result cell per ACTUAL section (not a fixed s1..s4)', () => {
    // #454 param-ized the breakdown off the grader keys / real section count;
    // a mini renders just s1, a full test s1..s4.
    assert.match(JS, /result\.section_breakdown/);
    assert.match(JS, /Array\.from\(\{\s*length:\s*STATE\.sectionCount\s*\|\|\s*4\s*\}[\s\S]*?`s\$\{i \+ 1\}`/);
    assert.doesNotMatch(JS, /\['s1','s2','s3','s4'\]/);
  });

  it('shows "Dưới band 4" when band_estimate is null', () => {
    assert.match(JS, /Dưới band 4/);
  });

  it('renders trap rollup as caught vs missed', () => {
    assert.match(JS, /Bắt được/);
    assert.match(JS, /Mắc bẫy/);
  });

  it('escapes user/test text via esc()/mdInline (escape-first)', () => {
    assert.match(JS, /function esc\(/);
    // PR #455 polish — prompts render through mdInline (escape THEN emphasis),
    // not bare esc; mdInline calls esc() first so user text is still escaped.
    assert.match(JS, /function mdInline\(raw\)/);
    assert.match(JS, /mdInline\(q\.prompt/);
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


describe('Sprint 13.5.1 — schema-match + URL regression guards', () => {

  // The renderer must read the parser's canonical shape, set by
  // services/listening_convert.py build_exercises():
  //   payload.instruction (singular) + payload.questions[] +
  //   payload.variant (e.g. "mcq_3option") + option.letter

  it('reads payload.questions[] (not items[])', () => {
    assert.match(JS, /payload\.questions/);
  });

  it('reads payload.instruction (singular) — tolerates legacy .instructions', () => {
    assert.match(JS, /payload\.instruction\b/);
  });

  it('branches on payload.variant / template_kind for mcq vs dictation', () => {
    assert.match(JS, /payload\.variant/);
    // Sprint 13.5.2: switch on template_kind. Two variants must each
    // resolve to a dedicated case in the switch.
    assert.match(JS, /case\s*['"]mcq_3option['"]\s*:/);
    assert.match(JS, /case\s*['"]plan_label['"]\s*:|case\s*['"]mcq_letter_label['"]\s*:/);
  });

  it('reads option.letter (parser canonical) — tolerates legacy .label', () => {
    assert.match(JS, /o\.letter/);
  });

  it('does not gate the renderer on coarse exercise_type === "mcq_3option"', () => {
    // ex.exercise_type is "dictation" / "mcq" (the family). The precise
    // q_type lives on `payload.variant`. Regression guard.
    assert.ok(
      !/exercise_type\s*===\s*['"]mcq_3option['"]/.test(JS),
      'renderer must branch on variant, not exercise_type',
    );
  });

  it('tolerates legacy rows where payload.items is the only items key', () => {
    assert.match(JS, /payload\.items/);
  });

  // Andy's dogfood 2026-05-21 showed `%3Ctest_uuid%3E` in DevTools.
  // No literal `<…>` placeholder may appear inside any /api/ URL string.

  it('no /api/ URL string contains a literal "<" or encoded "%3C" placeholder', () => {
    const apiUrlRe = /['"`]\/api\/[^'"`]+['"`]/g;
    const matches = JS.match(apiUrlRe) || [];
    assert.ok(matches.length > 0, 'expected at least one /api/ URL literal');
    for (const m of matches) {
      assert.ok(!m.includes('<'),
        `URL string contains literal placeholder: ${m}`);
      assert.ok(!m.includes('%3C'),
        `URL string contains URL-encoded placeholder: ${m}`);
    }
  });

  it('every dynamic /api/ URL uses backtick interpolation (not + concat)', () => {
    // Catches a future regression where someone writes
    //   `/api/listening/tests/' + testId
    // which would also work but bypasses the backtick discipline.
    const concat = /['"]\/api\/listening\/tests\/['"][\s\S]{0,40}\+/;
    assert.ok(!concat.test(JS),
      'use backtick template literal for /api/ URLs, not string concat');
  });
});


// ── Sprint 13.5.2 — Cambridge IELTS-authentic visual + variant routing ──

describe('Sprint 13.5.2 — IELTS-authentic page CSS hookup', () => {

  it('loads /css/ielts-test-paper.css', () => {
    assert.match(HTML, /\/css\/ielts-test-paper\.css/);
  });

  it('CSS sheet declares the Cambridge accent + serif tokens', () => {
    const CSS_PATH = join(__dirname, '..', 'css', 'ielts-test-paper.css');
    const CSS = readFileSync(CSS_PATH, 'utf8');
    assert.match(CSS, /--ielts-paper-accent:\s*#1e3a5f/);
    assert.match(CSS, /--ielts-paper-serif:\s*Georgia/);
  });

  it('CSS sheet defines circled question number + dotted gap input', () => {
    const CSS_PATH = join(__dirname, '..', 'css', 'ielts-test-paper.css');
    const CSS = readFileSync(CSS_PATH, 'utf8');
    assert.match(CSS, /\.ielts-question-num[\s\S]+?border-radius:\s*50%/);
    assert.match(CSS, /\.ielts-gap-input[\s\S]+?border-bottom:\s*1\.5px\s+dotted/);
  });

  it('CSS sheet overrides the IELTS palette under [data-theme="dark"]', () => {
    const CSS_PATH = join(__dirname, '..', 'css', 'ielts-test-paper.css');
    const CSS = readFileSync(CSS_PATH, 'utf8');
    assert.match(CSS, /\[data-theme="dark"\][\s\S]+?--ielts-paper-bg:\s*#1a1a1a/);
  });

  it('CSS sheet has a mobile media query at 768px', () => {
    const CSS_PATH = join(__dirname, '..', 'css', 'ielts-test-paper.css');
    const CSS = readFileSync(CSS_PATH, 'utf8');
    assert.match(CSS, /@media\s*\(max-width:\s*768px\)/);
  });
});


describe('Sprint 13.5.2 — variant routing in the JS controller', () => {

  it('renderExercise switches on payload.template_kind', () => {
    assert.match(JS, /payload\.template_kind/);
    assert.match(JS, /switch\s*\(kind\)/);
  });

  it('dispatches to renderFormCompletion for form_completion', () => {
    assert.match(JS, /case\s*['"]form_completion['"]\s*:\s*return\s+renderFormCompletion/);
  });

  it('dispatches to renderTableCompletion for table_completion', () => {
    assert.match(JS, /case\s*['"]table_completion['"]\s*:\s*return\s+renderTableCompletion/);
  });

  it('dispatches to renderNotesCompletion for notes_completion', () => {
    assert.match(JS, /case\s*['"]notes_completion['"]\s*:\s*return\s+renderNotesCompletion/);
  });

  it('dispatches to renderSummaryCompletion for summary_completion', () => {
    assert.match(JS, /case\s*['"]summary_completion['"]\s*:\s*return\s+renderSummaryCompletion/);
  });

  it('dispatches to renderSentenceCompletion for sentence_completion', () => {
    assert.match(JS, /case\s*['"]sentence_completion['"]\s*:\s*return\s+renderSentenceCompletion/);
  });

  it('dispatches to renderShortAnswer for short_answer', () => {
    assert.match(JS, /case\s*['"]short_answer['"]\s*:\s*return\s+renderShortAnswer/);
  });

  it('dispatches to renderMCQ for mcq_3option', () => {
    assert.match(JS, /case\s*['"]mcq_3option['"]\s*:\s*return\s+renderMCQ/);
  });

  it('dispatches to renderPlanLabel for plan_label / mcq_letter_label', () => {
    assert.match(JS, /case\s*['"]plan_label['"]\s*:|case\s*['"]mcq_letter_label['"]\s*:/);
    assert.match(JS, /return\s+renderPlanLabel/);
  });

  it('has a renderFallback for unknown template_kind', () => {
    assert.match(JS, /function\s+renderFallback/);
  });
});


describe('Sprint 13.5.2 — visual structure markers in renderers', () => {

  it('wraps each section in <section class="ielts-section"> with PART label + range', () => {
    assert.match(JS, /class="ielts-section"/);
    assert.match(JS, /PART\s+\$\{esc\(sec\.section_num\)\}/);
    assert.match(JS, /class="ielts-section-title">Questions/);
  });

  it('does NOT render narrator intro on the student paper (Cambridge audio-only)', () => {
    // Sprint 13.5.7 — narrator intro is audio-only; the renderer must
    // not emit a `<div class="ielts-narrator-intro">` block. The data
    // stays on the payload for admin preview / debugging.
    assert.ok(!/class="ielts-narrator-intro"/.test(JS),
      'narrator intro element must not render in student view');
  });

  it('renders Questions X – Y block headers', () => {
    assert.match(JS, /class="ielts-block-header">Questions/);
  });

  it('form renderer outputs heading + grid + example + numbered rows', () => {
    assert.match(JS, /class="ielts-form-heading"/);
    assert.match(JS, /class="ielts-form-grid"/);
    assert.match(JS, /class="ielts-form-example"/);
    assert.match(JS, /class="ielts-question-num"/);
  });

  it('table renderer outputs <table class="ielts-table"> with thead + tbody', () => {
    assert.match(JS, /<table class="ielts-table">/);
    assert.match(JS, /<thead>/);
    assert.match(JS, /<tbody>/);
  });

  it('table renderer puts a circled question num inside gap cells', () => {
    // Inside the table mapper, the gap cell must include the question
    // number span AND the gap input.
    assert.match(JS, /<td>[\s\S]*?ielts-question-num[\s\S]*?gapInput\(c\.q_num\)/);
  });

  it('MCQ renderer puts options inside .ielts-mcq-options with radio inputs', () => {
    assert.match(JS, /class="ielts-mcq-options"/);
    assert.match(JS, /type="radio"\s+name="q-\$\{esc\(q\.q_num\)\}"/);
  });

  it('plan-label renderer renders a <select> with A-H options (no description text)', () => {
    // Sprint 13.5.8 — map_description is admin-only metadata (AI image
    // prompt input). The student renderer must never reach for it.
    assert.match(JS, /class="ielts-plan-container"/);
    assert.match(JS, /<select[^>]+class="ft-q-input ielts-gap-input"/);
    assert.ok(!/class="ielts-map-description"/.test(JS),
      'student renderer must not emit the .ielts-map-description block');
  });

  it('notes renderer emits hierarchical list with group headings', () => {
    assert.match(JS, /class="ielts-notes-container"/);
    assert.match(JS, /class="ielts-notes-list"/);
  });

  it('summary renderer tokenises {{QN}} into circled num + gap input', () => {
    assert.match(JS, /\\\{\\\{Q\\d\+\\\}\\\}/);
    assert.match(JS, /class="ielts-summary-paragraph"/);
  });

  it('sentence renderer wraps prefix + gap + suffix on one row', () => {
    assert.match(JS, /class="ielts-sentence-row"/);
    // PR #455 polish — prefix/suffix render emphasis via mdInline (escape-first).
    assert.match(JS, /mdInline\(s\.prefix/);
    assert.match(JS, /mdInline\(s\.suffix/);
  });

  it('short answer renderer renders prompt + circled num + gap', () => {
    assert.match(JS, /class="ielts-short-row"/);
  });

  it('shared gapInput() helper renders ft-q-input + ielts-gap-input', () => {
    assert.match(JS, /function gapInput\(/);
    assert.match(JS, /class="ft-q-input ielts-gap-input"/);
  });

  it('falls back to renderFallback when a renderer cannot build structure', () => {
    // Each variant renderer guards `if (!rows.length) return renderFallback(...)`.
    assert.match(JS, /return\s+renderFallback\(/);
  });
});


// ── Sprint 13.5.5 — tab navigation ─────────────────────────────────────

describe('Sprint 13.5.5 — tab navigation markup + controller', () => {

  it('player markup declares 4 tabs with PART labels + per-tab progress slots', () => {
    assert.match(HTML, /<nav class="ielts-tabs"[^>]*id="ft-tabs"[^>]*role="tablist"/);
    for (const n of [1, 2, 3, 4]) {
      assert.match(HTML, new RegExp(`data-tab="${n}"`));
      assert.match(HTML, new RegExp(`PART ${n}`));
      assert.match(HTML, new RegExp(`data-tab-progress="${n}"`));
    }
  });

  it('first tab starts active + aria-selected="true"', () => {
    assert.match(HTML, /class="ielts-tab active"[^>]*data-tab="1"[^>]*aria-selected="true"/);
  });

  it('STATE carries activeTab + cuePointsByTab fields', () => {
    assert.match(JS, /activeTab:\s*1/);
    assert.match(JS, /cuePointsByTab/);
  });

  it('sectionForQ() uses the real q→section map, falling back to Cambridge /10', () => {
    assert.match(JS, /function sectionForQ\(/);
    // #454 prefers the data map; the /10 formula is now the FALLBACK (var n).
    assert.match(JS, /STATE\.qToSection && STATE\.qToSection\.has/);
    assert.match(JS, /Math\.floor\(\(n\s*-\s*1\)\s*\/\s*10\)\s*\+\s*1/);
  });

  it('applyActiveTab toggles [hidden] on .ielts-section per active tab', () => {
    assert.match(JS, /function applyActiveTab\(/);
    assert.match(JS, /el\.hidden\s*=\s*\(n\s*!==\s*STATE\.activeTab\)/);
  });

  it('setActiveTab guards to the real section set and short-circuits no-ops', () => {
    assert.match(JS, /function setActiveTab\(tabNum\)/);
    // #454 param-ized the upper bound off sectionCount; the follow-up PR also
    // admits any REAL section number (a mini may be {3}) via sectionQCounts.
    assert.match(JS, /tabNum\s*<\s*1\s*\|\|\s*tabNum\s*>\s*\(STATE\.sectionCount\s*\|\|\s*4\)/);
    assert.match(JS, /hasOwnProperty\.call\(STATE\.sectionQCounts,\s*tabNum\)/);
    assert.match(JS, /STATE\.activeTab\s*===\s*tabNum/);
  });

  it('attachTabHandlers wires each tab button to setActiveTab', () => {
    assert.match(JS, /function attachTabHandlers\(/);
    assert.match(JS, /setActiveTab\(n\)/);
  });

  it('setActiveTab scrolls the new panel into view', () => {
    assert.match(JS, /scrollIntoView\(\s*\{\s*behavior:\s*['"]smooth['"]/);
  });

  it('renderPaper invokes applyActiveTab + renderProgressTracker + attach handlers', () => {
    const m = /function renderPaper\(\)\s*\{([\s\S]+?)\n\}/m.exec(JS);
    assert.ok(m, 'renderPaper body not found');
    assert.match(m[1], /applyActiveTab\(\)/);
    assert.match(m[1], /renderProgressTracker\(\)/);
    assert.match(m[1], /attachTabHandlers\(\)/);
    assert.match(m[1], /attachProgressHandlers\(\)/);
  });

  it('CSS hides .ielts-section[hidden] so inactive tabs disappear', () => {
    const CSS_PATH = join(__dirname, '..', 'css', 'ielts-test-paper.css');
    const CSS = readFileSync(CSS_PATH, 'utf8');
    assert.match(CSS, /\.ielts-section\[hidden\][\s\S]+?display:\s*none\s*!important/);
  });
});


describe('Sprint 13.5.5 — sticky progress tracker (40 squares)', () => {

  it('page markup declares the tracker + 40-square bar + submit button', () => {
    assert.match(HTML, /<footer class="ielts-progress-tracker"[^>]*id="ft-progress-tracker"/);
    assert.match(HTML, /id="ft-progress-bar"/);
    assert.match(HTML, /id="btn-submit"/);
    assert.match(HTML, /class="btn-submit-final"/);
  });

  it('renderProgressTracker generates a button per question 1..total', () => {
    assert.match(JS, /function renderProgressTracker\(/);
    // #454 param-ized the loop bound from a literal 40 to the real total.
    assert.match(JS, /for \(let q\s*=\s*1;\s*q\s*<=\s*\(STATE\.totalQuestions\s*\|\|\s*40\);\s*q\+\+\)/);
    assert.match(JS, /class="progress-square"/);
    assert.match(JS, /data-q-num="\$\{q\}"/);
    assert.match(JS, /data-section="\$\{section\}"/);
  });

  it('attachProgressHandlers wires every square to onProgressSquareClick', () => {
    assert.match(JS, /function attachProgressHandlers\(/);
    assert.match(JS, /onProgressSquareClick\(q,\s*section\)/);
  });

  it('onProgressSquareClick switches tab if the question lives elsewhere', () => {
    assert.match(JS, /function onProgressSquareClick\(qNum,\s*sectionNum\)/);
    assert.match(JS, /STATE\.activeTab\s*!==\s*sectionNum/);
    assert.match(JS, /setActiveTab\(sectionNum\)/);
  });

  it('onProgressSquareClick scrolls + focuses the input after a brief delay', () => {
    const m = /function onProgressSquareClick\([\s\S]+?\n\}/m.exec(JS);
    assert.ok(m);
    assert.match(m[0], /setTimeout\(/);
    assert.match(m[0], /scrollIntoView\(\s*\{\s*behavior:\s*['"]smooth['"]/);
    assert.match(m[0], /input\.focus\(\)/);
  });

  it('updateAnsweredCount paints square answered class + tab counts', () => {
    assert.match(JS, /function updateProgressTrackerSquares\(/);
    assert.match(JS, /classList\.toggle\(['"]answered['"],/);
    assert.match(JS, /function updateTabProgressCounts\(/);
    assert.match(JS, /data-tab-progress="\$\{s\}"/);
  });

  it('updateAnsweredCount delegates to both progress helpers', () => {
    const m = /function updateAnsweredCount\(\)\s*\{([\s\S]+?)\n\}/m.exec(JS);
    assert.ok(m);
    assert.match(m[1], /updateProgressTrackerSquares\(\)/);
    assert.match(m[1], /updateTabProgressCounts\(\)/);
  });

  it('CSS defines the progress-square grid (20 cols desktop ×2 rows, 10 cols tablet, 5 cols mobile)', () => {
    // Sprint 13.5.8 — grid moved from a single 40-col row to a 20-col
    // × 2-row layout so 40 squares always fit the test-paper column.
    // Tablet stacks to 10×4; ultra-narrow (<480px) collapses to 5×8.
    const CSS_PATH = join(__dirname, '..', 'css', 'ielts-test-paper.css');
    const CSS = readFileSync(CSS_PATH, 'utf8');
    assert.match(CSS, /\.ielts-progress-bar\s*\{[\s\S]+?grid-template-columns:\s*repeat\(20,\s*minmax\(24px,\s*1fr\)\)/);
    assert.match(CSS, /@media\s*\(\s*max-width:\s*768px\s*\)[\s\S]+?grid-template-columns:\s*repeat\(10,\s*minmax\(28px,\s*1fr\)\)/);
    assert.match(CSS, /@media\s*\(\s*max-width:\s*480px\s*\)[\s\S]+?grid-template-columns:\s*repeat\(5,\s*1fr\)/);
  });

  it('CSS sticky-positions the tracker at the bottom of the viewport', () => {
    const CSS_PATH = join(__dirname, '..', 'css', 'ielts-test-paper.css');
    const CSS = readFileSync(CSS_PATH, 'utf8');
    assert.match(CSS, /\.ielts-progress-tracker\s*\{[\s\S]+?position:\s*sticky[\s\S]+?bottom:\s*0/);
  });

  it('CSS defines the .answered + .current visual states on squares', () => {
    const CSS_PATH = join(__dirname, '..', 'css', 'ielts-test-paper.css');
    const CSS = readFileSync(CSS_PATH, 'utf8');
    assert.match(CSS, /\.progress-square\.answered\b/);
    assert.match(CSS, /\.progress-square\.current\b/);
  });
});


describe('Sprint 13.5.5 — audio cue auto-advance + parser cleanup expectations', () => {

  it('mountAudio indexes cue points by section into STATE.cuePointsByTab', () => {
    assert.match(JS, /STATE\.cuePointsByTab\s*=\s*new Map/);
    assert.match(JS, /cue\.type\s*===\s*['"]section_start['"]/);
    assert.match(JS, /STATE\.cuePointsByTab\.set\(/);
  });

  it('timeupdate listener calls maybeAutoAdvanceTab(currentTime)', () => {
    assert.match(JS, /maybeAutoAdvanceTab\(audio\.currentTime\)/);
  });

  it('maybeAutoAdvanceTab never yanks the user backwards', () => {
    // Only advances when `tabNum > bestTab` so a manual jump forward
    // by the student is preserved.
    assert.match(JS, /function maybeAutoAdvanceTab\(/);
    assert.match(JS, /tabNum\s*>\s*bestTab/);
  });

  it('maybeAutoAdvanceTab uses a small lookahead so cue-point drift is tolerated', () => {
    // ±0.5s window per the implementation.
    assert.match(JS, /currentTime\s*\+\s*0\.5\s*>=\s*ts/);
  });

  // Parser-cleanup expectations (the renderer must show the cleaned
  // values — no audio markers in narrator-intro, no Q40 footer).

  it('renderer no longer wires narrator intro into the DOM (Sprint 13.5.7)', () => {
    // The narrator intro is audio-only in real Cambridge IELTS exams.
    // Sprint 13.5.7 removed the `<div class="ielts-narrator-intro">`
    // emission. The parser still cleans the field for admin preview
    // (Sprint 13.5.5) — we just don't render it here.
    assert.ok(!/esc\(sec\.narrator_intro\)/.test(JS),
      'narrator intro must not be wired into the student paper');
  });

  it('summary renderer reads payload.template.paragraph (bound at parse time)', () => {
    assert.match(JS, /tmpl\.paragraph/);
  });

  it('summary renderer tokenises {{QN}} into circled num + gap input', () => {
    // Regression guard for Sprint 13.5.2 contract — Sprint 13.5.5
    // parser bounds the paragraph; the tokeniser is unchanged but must
    // still split + interleave gaps cleanly.
    assert.match(JS, /\\\{\\\{Q\\d\+\\\}\\\}/);
  });

  it('notes renderer iterates the cleaned items[] (no Unicode-bullet residue)', () => {
    // The renderer trusts the parser cleanup; the test below pins that
    // it doesn't accidentally re-prepend a bullet glyph.
    assert.match(JS, /class="ielts-notes-list"/);
    assert.ok(!/['"]•['"]/.test(JS), 'renderer must not hardcode a bullet glyph');
  });

  it('submit button still wires to confirmSubmit (regression after tracker move)', () => {
    // Sprint 13.5.5 moved the submit button INTO the progress tracker.
    // The click binding must follow.
    assert.match(JS, /\$\(['"]btn-submit['"]\)\.addEventListener\(['"]click['"],\s*confirmSubmit\)/);
  });

  it('CSS dark-mode override styles the tabs + tracker', () => {
    const CSS_PATH = join(__dirname, '..', 'css', 'ielts-test-paper.css');
    const CSS = readFileSync(CSS_PATH, 'utf8');
    assert.match(CSS, /\[data-theme="dark"\]\s+\.ielts-tabs\b/);
    assert.match(CSS, /\[data-theme="dark"\]\s+\.ielts-progress-tracker\b/);
  });
});


// ── Sprint 13.5.7 — Cambridge UI polish (audio + narrator + layout) ──────

describe('Sprint 13.5.7 — Cambridge audio authenticity', () => {

  it('Play button still mounted (single-shot start)', () => {
    assert.match(HTML, /id="btn-playpause"/);
    // Default label is the play glyph; the JS swaps it to "Đang phát"
    // / "Đã hết" as state changes.
    assert.match(HTML, /▶ Play/);
  });

  it('volume slider still present (Cambridge allows volume adjustment)', () => {
    assert.match(HTML, /id="ft-volume"/);
    assert.match(HTML, /type="range"[^>]+id="ft-volume"/);
  });

  it('NO speed-control buttons render in markup', () => {
    assert.ok(!/ft-speed-btn/.test(HTML),
      'speed buttons removed in 13.5.7');
    assert.ok(!/ft-speed-group/.test(HTML),
      'speed group container removed in 13.5.7');
    assert.ok(!/data-speed=/.test(HTML),
      'data-speed attributes removed in 13.5.7');
  });

  it('NO speed-control CSS rules remain in the inline page styles', () => {
    assert.ok(!/\.ft-speed-btn\s*\{/.test(HTML),
      'inline .ft-speed-btn CSS removed in 13.5.7');
    assert.ok(!/\.ft-speed-group\s*\{/.test(HTML),
      'inline .ft-speed-group CSS removed in 13.5.7');
  });

  it('startPlayback() guards against multiple clicks via STATE.playbackStarted', () => {
    assert.match(JS, /function startPlayback\(/);
    assert.match(JS, /STATE\.playbackStarted/);
    assert.match(JS, /if \(STATE\.playbackStarted\) return/);
  });

  it('startPlayback() locks playbackRate to 1.0 and disables the button', () => {
    const m = /function startPlayback\(\)\s*\{([\s\S]+?)\n\}/m.exec(JS);
    assert.ok(m, 'startPlayback body not found');
    assert.match(m[1], /playbackRate\s*=\s*1\.0/);
    assert.match(m[1], /btn\.disabled\s*=\s*true/);
    assert.match(m[1], /'Đang phát'|"Đang phát"/);
  });

  it('audio.ended switches button to "Đã hết" and keeps it disabled', () => {
    // No replay: the terminal label is "Đã hết" and the button stays
    // disabled so there is no UI affordance to restart.
    assert.match(JS, /'Đã hết'|"Đã hết"/);
    assert.match(JS, /addEventListener\('ended'/);
  });

  it('STATE declares playbackStarted: false at module load', () => {
    assert.match(JS, /playbackStarted:\s*false/);
  });

  it('NO togglePlay / setSpeed handlers remain (replaced by startPlayback)', () => {
    assert.ok(!/function togglePlay\b/.test(JS),
      'togglePlay removed in 13.5.7');
    assert.ok(!/function setSpeed\b/.test(JS),
      'setSpeed removed in 13.5.7');
    assert.ok(!/'⏸ Pause'|"⏸ Pause"/.test(JS),
      'pause label removed in 13.5.7');
  });

  it('the click listener binds to startPlayback (not togglePlay)', () => {
    assert.match(JS, /addEventListener\('click',\s*startPlayback\)/);
    assert.ok(!/addEventListener\('click',\s*togglePlay\)/.test(JS),
      'old togglePlay binding removed');
  });
});


describe('Sprint 13.5.7 — narrator intro suppressed from student paper', () => {

  it('renderPaper does not emit a .ielts-narrator-intro block', () => {
    // The entire wrapper class is gone from the renderer source.
    assert.ok(!/class="ielts-narrator-intro"/.test(JS),
      'narrator intro element removed from student renderer');
    assert.ok(!/esc\(sec\.narrator_intro\)/.test(JS),
      'narrator intro field no longer wired to esc() in renderer');
  });

  it('section header still renders the PART label + question range', () => {
    assert.match(JS, /class="ielts-section-label">PART \$\{esc\(sec\.section_num\)\}/);
    assert.match(JS, /class="ielts-section-title">Questions/);
  });

  it('narrator_intro field is still accepted on the section shape (data preserved)', () => {
    // Renderer must not strip the field from the API response — the
    // admin preview pipeline still needs it. The contract here is that
    // `sec` is still indexable on narrator_intro even though we don't
    // read it during render.
    // Easier sentinel: ensure the legacy "narrator_intro" name doesn't
    // get renamed to something else (regression guard).
    // (No active read → no positive match needed.)
    // We pin the negative: the renderer does NOT delete the key.
    assert.ok(!/delete\s+sec\.narrator_intro/.test(JS));
  });

  it('"You will hear" narrator preamble cannot leak via hardcoded strings', () => {
    // The renderer must never hardcode the narrator preamble text. If
    // it did, our parser cleanup would be moot.
    assert.ok(!/You will hear/i.test(JS),
      'hardcoded narrator preamble must not appear in the JS bundle');
  });

  it('strip-on-parse cleanup is still trusted by the renderer', () => {
    // Sprint 13.5.5 guard preserved — when the renderer eventually does
    // read intro text again (admin preview), markers stay stripped
    // server-side. Just pin that the JS doesn't ALSO try to strip.
    assert.ok(!/\[pause:30s\]/.test(JS),
      'no client-side audio-marker handling — parser owns this');
  });
});


describe('Sprint 13.5.7 — progress tracker fits container + submit button', () => {
  const CSS_PATH = join(__dirname, '..', 'css', 'ielts-test-paper.css');
  const CSS = readFileSync(CSS_PATH, 'utf8');

  it('tracker constrains itself with box-sizing + max-width 100%', () => {
    assert.match(CSS, /\.ielts-progress-tracker\s*\{[\s\S]+?max-width:\s*100%[\s\S]+?box-sizing:\s*border-box/);
  });

  it('progress bar uses 20-col × 2-row grid so 40 squares never overflow (Sprint 13.5.8)', () => {
    assert.match(CSS,
      /\.ielts-progress-bar\s*\{[\s\S]+?grid-template-columns:\s*repeat\(20,\s*minmax\(24px,\s*1fr\)\)/);
  });

  it('progress bar caps width at 800px and centres itself (Sprint 13.5.8)', () => {
    const m = /\.ielts-progress-bar\s*\{([\s\S]+?)\n\}/m.exec(CSS);
    assert.ok(m, '.ielts-progress-bar rule not found');
    assert.match(m[1], /max-width:\s*800px/);
    assert.match(m[1], /margin:\s*0\s+auto/);
  });

  it('mobile grid uses minmax(28px, 1fr) for thumb-friendly squares', () => {
    assert.match(CSS,
      /@media\s*\(\s*max-width:\s*768px\s*\)[\s\S]+?grid-template-columns:\s*repeat\(10,\s*minmax\(28px,\s*1fr\)\)/);
  });

  it('submit button has min-width + nowrap + flex-shrink:0 so text cannot truncate', () => {
    const m = /\.btn-submit-final\s*\{([\s\S]+?)\n\}/m.exec(CSS);
    assert.ok(m, '.btn-submit-final rule not found');
    assert.match(m[1], /min-width:\s*100px/);
    assert.match(m[1], /white-space:\s*nowrap/);
    assert.match(m[1], /flex-shrink:\s*0/);
  });

  it('progress summary wraps + gaps so cramped layouts stack cleanly', () => {
    const m = /\.ielts-progress-summary\s*\{([\s\S]+?)\n\}/m.exec(CSS);
    assert.ok(m);
    assert.match(m[1], /flex-wrap:\s*wrap/);
    assert.match(m[1], /gap:\s*var\(--av-space-3\)/);
  });
});


describe('Sprint 13.5.7 — MCQ + responsive padding adjustments', () => {
  const CSS_PATH = join(__dirname, '..', 'css', 'ielts-test-paper.css');
  const CSS = readFileSync(CSS_PATH, 'utf8');

  it('MCQ options padding-left reduced from --av-space-6 to --av-space-4', () => {
    // The matched rule must NOT carry --av-space-6 inside the
    // padding-left declaration any more.
    const m = /\.ielts-mcq-options\s*\{([\s\S]+?)\n\}/m.exec(CSS);
    assert.ok(m, '.ielts-mcq-options rule not found');
    assert.match(m[1], /padding-left:\s*var\(--av-space-4\)/);
    assert.ok(!/padding-left:\s*var\(--av-space-6\)/.test(m[1]),
      'old --av-space-6 padding removed in 13.5.7');
  });

  it('MCQ option rows use flex with fixed 8px gap + baseline alignment (Sprint 13.5.8)', () => {
    const m = /\.ielts-mcq-option\s*\{([\s\S]+?)\n\}/m.exec(CSS);
    assert.ok(m);
    assert.match(m[1], /display:\s*flex/);
    assert.match(m[1], /align-items:\s*baseline/);
    assert.match(m[1], /gap:\s*8px/);
    assert.ok(!/gap:\s*var\(--av-space-2\)/.test(m[1]),
      'flex-var gap replaced with fixed 8px in 13.5.8');
  });

  it('progress square mobile min-height bumped to 24px for touch (was 18px)', () => {
    // Easier-to-tap squares on small screens.
    assert.match(CSS,
      /@media\s*\(\s*max-width:\s*768px\s*\)[\s\S]+?\.progress-square\s*\{\s*min-height:\s*24px/);
  });

  it('Sprint 13.5.6 map-image clamp survives the layout pass', () => {
    // Regression — the .ielts-map-rendered max-height must stay so the
    // image doesn't break the test-paper column post-13.5.7 changes.
    assert.match(CSS, /\.ielts-map-rendered[\s\S]+?max-height:\s*480px/);
  });

  it('dark-mode rules cover both tracker and submit button (regression guard)', () => {
    assert.match(CSS, /\[data-theme="dark"\]\s+\.ielts-progress-tracker\b/);
    assert.match(CSS, /\[data-theme="dark"\]\s+\.btn-submit-final\b/);
  });

  it('audio progress bar (visual fill) still updates from timeupdate', () => {
    // The student should still SEE elapsed time / fill, just not be
    // able to scrub. The fill width assignment is the read-only visual.
    const playerJs = readFileSync(
      join(__dirname, '..', 'js', 'listening-test-player.js'), 'utf8',
    );
    assert.match(playerJs, /ft-audio-fill[\s\S]{0,80}style\.width/);
  });

  it('tab nav still routes via setActiveTab (regression after audio refactor)', () => {
    const playerJs = readFileSync(
      join(__dirname, '..', 'js', 'listening-test-player.js'), 'utf8',
    );
    assert.match(playerJs, /function setActiveTab\(tabNum\)/);
    assert.match(playerJs, /applyActiveTab\(\)/);
  });

  it('map image inline render survives (Sprint 13.5.6 regression)', () => {
    const playerJs = readFileSync(
      join(__dirname, '..', 'js', 'listening-test-player.js'), 'utf8',
    );
    assert.match(playerJs, /payload\.map_image_url/);
    assert.match(playerJs, /class="ielts-map-rendered"/);
  });

  it('progress squares stay clickable + scroll the corresponding input (regression)', () => {
    const playerJs = readFileSync(
      join(__dirname, '..', 'js', 'listening-test-player.js'), 'utf8',
    );
    assert.match(playerJs, /function onProgressSquareClick\(qNum,\s*sectionNum\)/);
    assert.match(playerJs, /input\.scrollIntoView/);
  });
});


describe('Sprint 13.5.8 — progress tracker 2-row layout', () => {
  const CSS_PATH = join(__dirname, '..', 'css', 'ielts-test-paper.css');
  const CSS = readFileSync(CSS_PATH, 'utf8');

  it('desktop grid is exactly 20 cols (40 squares reflow into 2 rows)', () => {
    const m = /\.ielts-progress-bar\s*\{([\s\S]+?)\n\}/m.exec(CSS);
    assert.ok(m, '.ielts-progress-bar rule not found');
    assert.match(m[1], /grid-template-columns:\s*repeat\(20,\s*minmax\(24px,\s*1fr\)\)/);
    assert.ok(!/repeat\(40,/.test(m[1]),
      'Sprint 13.5.7 single-row 40-col layout must be gone');
  });

  it('grid-auto-rows pins both rows to ≥28px (matches square min-height)', () => {
    const m = /\.ielts-progress-bar\s*\{([\s\S]+?)\n\}/m.exec(CSS);
    assert.ok(m);
    assert.match(m[1], /grid-auto-rows:\s*minmax\(28px,\s*auto\)/);
  });

  it('gap bumped from 3px to 4px so squares breathe in the 2-row layout', () => {
    const m = /\.ielts-progress-bar\s*\{([\s\S]+?)\n\}/m.exec(CSS);
    assert.ok(m);
    assert.match(m[1], /gap:\s*4px/);
  });

  it('grid is centred via margin: 0 auto and capped at 800px', () => {
    const m = /\.ielts-progress-bar\s*\{([\s\S]+?)\n\}/m.exec(CSS);
    assert.ok(m);
    assert.match(m[1], /max-width:\s*800px/);
    assert.match(m[1], /margin:\s*0\s+auto/);
  });

  it('ultra-narrow (≤480px) collapses to 5-col grid', () => {
    assert.match(CSS,
      /@media\s*\(\s*max-width:\s*480px\s*\)[\s\S]+?\.ielts-progress-bar\s*\{[\s\S]+?grid-template-columns:\s*repeat\(5,\s*1fr\)/);
  });

  it('tab nav still routes via setActiveTab (regression after grid refactor)', () => {
    const playerJs = readFileSync(
      join(__dirname, '..', 'js', 'listening-test-player.js'), 'utf8',
    );
    assert.match(playerJs, /function setActiveTab\(tabNum\)/);
  });
});


describe('Sprint 13.5.8 — plan-label suppresses map_description from student view', () => {
  const JS_PATH = join(__dirname, '..', 'js', 'listening-test-player.js');
  const JS = readFileSync(JS_PATH, 'utf8');

  it('renderPlanLabel does NOT read payload.map_description', () => {
    const m = /function\s+renderPlanLabel\([\s\S]+?\n\}\s*\n/.exec(JS);
    assert.ok(m, 'renderPlanLabel() function not found');
    // Strip line comments so the doc-comment explaining the omission
    // (which legitimately mentions "map_description") doesn't trigger
    // the sentinel. Code-level access patterns must not appear.
    const code = m[0].replace(/\/\/[^\n]*/g, '');
    assert.ok(!/payload\.map_description/.test(code),
      'renderPlanLabel must not reach for payload.map_description');
    assert.ok(!/meta\.map_description/.test(code),
      'renderPlanLabel must not reach for meta.map_description either');
  });

  it('renderPlanLabel does NOT emit the .ielts-map-description block', () => {
    const m = /function\s+renderPlanLabel\([\s\S]+?\n\}\s*\n/.exec(JS);
    assert.ok(m);
    assert.ok(!/ielts-map-description/.test(m[0]),
      'description block must not surface in the student paper');
  });

  it('renderPlanLabel renders the image when map_image_url is present', () => {
    const m = /function\s+renderPlanLabel\([\s\S]+?\n\}\s*\n/.exec(JS);
    assert.ok(m);
    assert.match(m[0], /payload\.map_image_url/);
    assert.match(m[0], /class="ielts-map-rendered"/);
  });

  it('renderPlanLabel falls back to .ielts-plan-no-image notice when no image', () => {
    const m = /function\s+renderPlanLabel\([\s\S]+?\n\}\s*\n/.exec(JS);
    assert.ok(m);
    assert.match(m[0], /class="ielts-plan-no-image"/);
    assert.match(m[0], /Hình map chưa được tạo/);
  });

  it('CSS defines the .ielts-plan-no-image notice block', () => {
    const CSS_PATH = join(__dirname, '..', 'css', 'ielts-test-paper.css');
    const CSS = readFileSync(CSS_PATH, 'utf8');
    const m = /\.ielts-plan-no-image\s*\{([\s\S]+?)\n\}/m.exec(CSS);
    assert.ok(m, '.ielts-plan-no-image rule not found');
    assert.match(m[1], /background:\s*#fef9e7/);
    assert.match(m[1], /border:\s*1px\s+solid\s+#f5d564/);
  });

  it('backend student endpoint strips map_description (defense-in-depth)', () => {
    const BACKEND_PATH = join(__dirname, '..', '..', 'backend', 'routers', 'listening.py');
    const PY = readFileSync(BACKEND_PATH, 'utf8');
    // The student endpoint must call .pop("map_description", None) on
    // the payload (and on payload.metadata if present) for plan-label
    // exercises so the description never leaves the server.
    assert.match(PY, /payload\.pop\(["']map_description["'],\s*None\)/);
    assert.match(PY, /metadata"?\]\.pop\(["']map_description["'],\s*None\)/);
  });
});


describe('Sprint 13.5.8 — MCQ tight inline layout', () => {
  const CSS_PATH = join(__dirname, '..', 'css', 'ielts-test-paper.css');
  const CSS = readFileSync(CSS_PATH, 'utf8');
  const JS_PATH = join(__dirname, '..', 'js', 'listening-test-player.js');
  const JS = readFileSync(JS_PATH, 'utf8');

  it('MCQ HTML splits letter and option text into separate slots', () => {
    // The renderer must emit <strong>letter</strong> followed by
    // <span class="ielts-mcq-option-text">text</span> as siblings of
    // the radio input — three flex slots, not "<span><strong/>text</span>".
    assert.match(JS, /<strong>\$\{esc\(letter\)\}<\/strong>\s*\n\s*<span class="ielts-mcq-option-text">/);
  });

  it('CSS styles the .ielts-mcq-option-text slot with flex:1 + min-width:0', () => {
    const m = /\.ielts-mcq-option-text\s*\{([\s\S]+?)\n\}/m.exec(CSS);
    assert.ok(m, '.ielts-mcq-option-text rule not found');
    assert.match(m[1], /flex:\s*1/);
    assert.match(m[1], /min-width:\s*0/);
  });

  it('CSS styles the inline letter <strong> with the paper accent', () => {
    const m = /\.ielts-mcq-option\s+strong\s*\{([\s\S]+?)\n\}/m.exec(CSS);
    assert.ok(m, '.ielts-mcq-option strong rule not found');
    assert.match(m[1], /color:\s*var\(--ielts-paper-accent\)/);
    assert.match(m[1], /flex-shrink:\s*0/);
  });

  it('radio is shrink-locked + centred, sized 16×16 (compact inline)', () => {
    const m = /\.ielts-mcq-option\s+input\[type="radio"\]\s*\{([\s\S]+?)\n\}/m.exec(CSS);
    assert.ok(m);
    assert.match(m[1], /flex-shrink:\s*0/);
    assert.match(m[1], /width:\s*16px/);
    assert.match(m[1], /height:\s*16px/);
    assert.match(m[1], /margin:\s*0\b/);
  });

  it('hover state preserved on .ielts-mcq-option:hover', () => {
    assert.match(CSS, /\.ielts-mcq-option:hover\s*\{[\s\S]+?background:\s*var\(--ielts-paper-surface-alt\)/);
  });

  it('option list still stacks vertically with 4px gap (regression)', () => {
    const m = /\.ielts-mcq-options\s*\{([\s\S]+?)\n\}/m.exec(CSS);
    assert.ok(m);
    assert.match(m[1], /flex-direction:\s*column/);
    assert.match(m[1], /gap:\s*4px/);
  });

  it('renderMCQ still wires data-q-num + radio so click flow works', () => {
    assert.match(JS, /type="radio"\s+name="q-\$\{esc\(q\.q_num\)\}"/);
    assert.match(JS, /data-q-num="\$\{esc\(q\.q_num\)\}"/);
  });

  it('dark-mode coverage for plan-no-image notice (theme parity)', () => {
    assert.match(CSS, /\[data-theme="dark"\]\s+\.ielts-plan-no-image\b/);
  });
});

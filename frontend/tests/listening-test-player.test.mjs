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
    // Sprint 13.5.2 — MCQ renderer reads q.prompt rather than item.prompt.
    assert.match(JS, /esc\(q\.prompt/);
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

  it('renders narrator intro inside .ielts-narrator-intro', () => {
    assert.match(JS, /class="ielts-narrator-intro"/);
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

  it('plan-label renderer renders a <select> with A-H options + map description', () => {
    assert.match(JS, /class="ielts-plan-container"/);
    assert.match(JS, /class="ielts-map-description"/);
    assert.match(JS, /<select[^>]+class="ft-q-input ielts-gap-input"/);
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
    assert.match(JS, /esc\(s\.prefix/);
    assert.match(JS, /esc\(s\.suffix/);
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

  it('sectionForQ() maps Q-num to Cambridge section (1-10 → 1, …)', () => {
    assert.match(JS, /function sectionForQ\(/);
    assert.match(JS, /Math\.floor\(\(qNum\s*-\s*1\)\s*\/\s*10\)\s*\+\s*1/);
  });

  it('applyActiveTab toggles [hidden] on .ielts-section per active tab', () => {
    assert.match(JS, /function applyActiveTab\(/);
    assert.match(JS, /el\.hidden\s*=\s*\(n\s*!==\s*STATE\.activeTab\)/);
  });

  it('setActiveTab guards range 1..4 and short-circuits no-ops', () => {
    assert.match(JS, /function setActiveTab\(tabNum\)/);
    assert.match(JS, /tabNum\s*<\s*1\s*\|\|\s*tabNum\s*>\s*4/);
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

  it('renderProgressTracker generates a button per question 1..40', () => {
    assert.match(JS, /function renderProgressTracker\(/);
    assert.match(JS, /for \(let q\s*=\s*1;\s*q\s*<=\s*40;\s*q\+\+\)/);
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

  it('CSS defines the progress-square grid (40 cols desktop, 10 cols mobile)', () => {
    const CSS_PATH = join(__dirname, '..', 'css', 'ielts-test-paper.css');
    const CSS = readFileSync(CSS_PATH, 'utf8');
    assert.match(CSS, /\.ielts-progress-bar\s*\{[\s\S]+?grid-template-columns:\s*repeat\(40,\s*1fr\)/);
    assert.match(CSS, /@media\s*\(\s*max-width:\s*768px\s*\)[\s\S]+?grid-template-columns:\s*repeat\(10,\s*1fr\)/);
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

  it('renderer uses sec.narrator_intro verbatim (no extra strip on the client)', () => {
    // Parser strips audio markers at convert time; client just esc()s.
    assert.match(JS, /esc\(sec\.narrator_intro\)/);
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

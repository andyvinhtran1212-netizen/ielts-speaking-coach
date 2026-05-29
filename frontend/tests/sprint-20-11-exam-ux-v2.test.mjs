/**
 * frontend/tests/sprint-20-11-exam-ux-v2.test.mjs
 *
 * Sprint 20.11 — exam UX iteration v2 sentinel. Five deliverables:
 *
 *   D1 — Draggable divider visual upgrade (10px target + grip).
 *   D2 — English instruction blocks above each consecutive run of
 *        same-typed questions inside a passage.
 *   D3 — Palette: stronger per-part visual separation (framed group
 *        containers + bigger gap + wrap to additional rows on narrow).
 *   D4 — English inside exam content (dropdown placeholder, gap
 *        placeholder); chrome buttons + modals stay Vietnamese.
 *   D5 — Pre-start surfaces Resume + Start-fresh; restart-confirm modal
 *        wires through POST /attempts (Q7 abandons prior).
 *
 * Static-analysis only — no DOM. Mirrors the cluster's existing sentinel
 * pattern (sprint-20-2 / 20-3 / 20-6 / 20-8 / 20-10).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');


// ── D1 — Draggable divider regression: visual upgrade ─────────────────


describe('Sprint 20.11 D1 — divider 10px target + grip affordance', () => {
  const css = read('frontend/css/reading-exam.css');
  const js  = read('frontend/js/reading-exam.js');

  test('production CSS overrides the mockup 6px divider with 10px', () => {
    // The mockup ships `grid-template-columns: var(--exam-split-left, 50%) 6px 1fr`;
    // production now overrides with a 10px middle column.
    assert.match(
      css,
      /\.exam-split\s*\{[\s\S]{0,200}grid-template-columns:\s*var\(--exam-split-left[^)]*\)\s+10px\s+1fr/,
    );
  });

  test('divider grip styling shows three horizontal lines (not a thin dot)', () => {
    // The base mockup renders a single vertical strip with dots. The 20.11
    // upgrade uses three lines for a stronger affordance.
    assert.match(css, /\.exam-divider::before\s*\{[\s\S]{0,300}box-shadow:\s*-3px\s+0\s+0/);
  });

  test('JS wireDivider handlers are still wired (no regression)', () => {
    // wireDivider is an IIFE that attaches mousedown / mousemove / mouseup
    // + touch equivalents. Sentinel pins the attachment so a future refactor
    // can't silently delete the resize feature.
    assert.match(js, /function\s+wireDivider\b/);
    assert.match(js, /divider\.addEventListener\(\s*['"]mousedown['"]/);
    assert.match(js, /document\.addEventListener\(\s*['"]mousemove['"]/);
    assert.match(js, /document\.addEventListener\(\s*['"]mouseup['"]/);
    // Keyboard accessibility — ArrowLeft / ArrowRight reposition the split.
    assert.match(js, /ev\.key\s*===\s*['"]ArrowLeft['"]/);
  });
});


// ── D2 — English instruction blocks per question-type run ─────────────


describe('Sprint 20.11 D2 — per-type English instruction templates', () => {
  const js = read('frontend/js/reading-exam.js');

  test('QTYPE_INSTRUCTIONS map exists with every Phase 1 question type', () => {
    assert.match(js, /var\s+QTYPE_INSTRUCTIONS\s*=\s*\{/);
    for (const t of ['matching_headings', 'true_false_not_given',
                     'yes_no_not_given', 'mcq_single',
                     'sentence_completion', 'summary_completion',
                     'notes_completion', 'table_completion',
                     'form_completion', 'short_answer']) {
      assert.match(
        js,
        new RegExp(`\\b${t}\\b\\s*:\\s*function`),
        `missing instruction template for ${t}`,
      );
    }
  });

  test('templates produce English wording (real-IELTS phrases pinned)', () => {
    // Each template's body must contain a phrase from the BC/IDP/Cambridge
    // official-sample wording — locking the locale + phrasing in one shot.
    assert.match(js, /Reading Passage/);
    assert.match(js, /TRUE\s+if the statement agrees/);
    assert.match(js, /Choose the correct letter/);
    assert.match(js, /NO MORE THAN TWO WORDS/);
    assert.match(js, /Choose the correct heading/);
  });

  test('renderQuestions sub-groups by consecutive question_type runs', () => {
    // The 20.6 implementation rendered each question with its own prompt
    // and no group instruction; 20.11 collects consecutive runs of the
    // same type and renders one instruction block per run.
    assert.match(js, /function\s+_consecutiveTypeRuns\s*\(/);
    assert.match(js, /function\s+_qRangeLabel\s*\(/);
    assert.match(
      js,
      /exam-questions__instructions--type/,
    );
  });

  test('part-heading is still rendered (no regression vs 20.6)', () => {
    assert.match(js, /exam-questions__part-heading/);
  });
});


describe('Sprint 20.11 D2 — instruction-block CSS', () => {
  const css = read('frontend/css/reading-exam.css');
  test('production CSS defines the per-type instruction block + part heading', () => {
    assert.match(css, /\.exam-questions__instructions--type\s*\{/);
    assert.match(css, /\.exam-questions__part-heading\s*\{/);
  });
});


// ── D3 — Palette stronger per-part separation ─────────────────────────


describe('Sprint 20.11 D3 — palette per-part visual separation', () => {
  const css = read('frontend/css/reading-exam.css');

  test('palette grid uses a bigger gap (≥ 24px) and can wrap', () => {
    // 20.10 D3 shipped 18px gaps without wrap. Andy's dogfood wanted
    // "2 visual rows" — wrap enables that automatically on narrower
    // viewports while keeping single-row layout where space allows.
    // Look for the LAST `.exam-palette__grid { … }` rule in the file —
    // the 20.11 override.
    const blocks = [...css.matchAll(/\.exam-palette__grid\s*\{([\s\S]*?)\}/g)];
    assert.ok(blocks.length >= 2, 'expected 20.10 + 20.11 grid rules');
    const last = blocks[blocks.length - 1][1];
    assert.match(last, /gap:\s*(2[4-9]|[3-9]\d)px/, 'gap < 24px in 20.11 grid rule');
    assert.match(last, /flex-wrap:\s*wrap/);
  });

  test('group container is a framed pill (background + border + radius)', () => {
    // Match the standalone `.exam-palette__group { … }` rule by anchoring
    // at the start of a line — this excludes the sibling combinator
    // `.exam-palette__group + .exam-palette__group {` whose trailing
    // `.exam-palette__group {` would otherwise match too.
    const blocks = [...css.matchAll(/(?:^|\n)\.exam-palette__group\s*\{([\s\S]*?)\}/g)];
    assert.ok(blocks.length >= 2, 'expected 20.10 + 20.11 standalone group rules');
    const last = blocks[blocks.length - 1][1];
    assert.match(last, /background:/);
    assert.match(last, /border:/);
    assert.match(last, /border-radius:/);
  });
});


// ── D4 — English inside exam content; Vietnamese chrome ───────────────


describe('Sprint 20.11 D4 — English inside exam content, Vietnamese chrome', () => {
  const js   = read('frontend/js/reading-exam.js');
  const html = read('frontend/pages/reading-exam.html');

  test('matching_headings dropdown placeholder is English', () => {
    assert.match(js, /['"`]— Select —['"`]/);
    // And the Vietnamese phrase is gone.
    assert.ok(!/Chọn tiêu đề/.test(js),
      'Vietnamese dropdown placeholder must be replaced with English');
  });

  test('text-gap placeholder is English', () => {
    assert.match(js, /['"`]Type your answer…['"`]/);
    assert.ok(!/Nhập câu trả lời/.test(js),
      'Vietnamese gap placeholder must be replaced with English');
  });

  test('chrome buttons (Settings/Hide/Help) and pre-start orientation stay Vietnamese', () => {
    // The app voice is Vietnamese — only the surface a student READS to
    // answer an IELTS question is English. Pre-start orientation copy
    // (rules + meta) is app voice → Vietnamese.
    assert.match(html, /Trước khi bắt đầu/);
    assert.match(html, /Bắt đầu bài thi/);
    // Hide / Help / Settings labels (English in chrome by 20.4c
    // institutional fidelity convention; Settings popover may carry VN
    // sub-labels). The presence test below pins the chrome buttons
    // explicitly.
    assert.match(html, /Settings/);
    assert.match(html, /Help/);
    assert.match(html, /Hide/);
  });
});


// ── D5 — Resume + Start-fresh affordance + restart-confirm modal ──────


describe('Sprint 20.11 D5 — Resume + Start-fresh on pre-start', () => {
  const js   = read('frontend/js/reading-exam.js');
  const html = read('frontend/pages/reading-exam.html');

  test('HTML adds the Resume button in pre-start actions (hidden by default)', () => {
    assert.match(
      html,
      /id="exam-resume-btn-prestart"[^>]*hidden/,
    );
  });

  test('HTML adds the restart-confirm modal', () => {
    assert.match(html, /id="exam-restart-modal"/);
    assert.match(html, /id="exam-restart-confirm"/);
    assert.match(html, /id="exam-restart-cancel"/);
    // Confirmation copy mentions abandoning the current attempt so a
    // student isn't surprised after the click.
    assert.match(html, /abandoned|bị hủy/);
  });

  test('JS SESSION has the resume_inprogress flag', () => {
    assert.match(js, /resume_inprogress:\s*false/);
  });

  test('boot sets resume_inprogress=true and goes to pre-start (not auto-resume)', () => {
    // Pre-20.11: boot called enterInProgress() directly on resume detect.
    // 20.11: boot calls showState('prestart') + configurePreStartActions(true).
    assert.match(
      js,
      /SESSION\.resume_inprogress\s*=\s*true[\s\S]{0,300}configurePreStartActions\(true\)[\s\S]{0,100}showState\(['"]prestart['"]\)/,
    );
  });

  test('Start button opens restart-confirm modal when a resume is live', () => {
    assert.match(
      js,
      // Sprint 20.13b B1 — the open path was refactored from a direct
      // `#exam-restart-modal.hidden = false` to `openOverlay($('exam-restart-modal'), ...)`
      // for focus-trap + return-focus discipline. Accept either form:
      // the contract pinned here is "Start button opens the restart-confirm
      // modal when a resume is live", not the specific assignment style.
      /SESSION\.resume_inprogress\s*\)[\s\S]{0,300}(?:exam-restart-modal['"]\)\.hidden\s*=\s*false|openOverlay\(\s*\$\(\s*['"]exam-restart-modal['"])/,
    );
  });

  test('Resume button calls enterInProgress without re-POSTing /attempts', () => {
    // Mirror of the start-fresh path: Resume should NOT issue a new
    // POST /attempts (which would abandon the resumed attempt and create
    // a fresh one — the OPPOSITE of resuming).
    const block = /exam-resume-btn-prestart['"]\)\.addEventListener\([\s\S]{0,300}\}\)/.exec(js);
    assert.ok(block, 'Resume button handler not found');
    assert.ok(!/api\.post/.test(block[0]),
      'Resume button must NOT issue POST /attempts (that is the Start-fresh path)');
    assert.match(block[0], /enterInProgress\(\)/);
  });

  test('Start-fresh path clears the resumed answers and flagged set', () => {
    // startFreshAttempt resets SESSION.answers + SESSION.flagged before
    // entering in_progress — otherwise the new attempt would inherit
    // answers from the abandoned one.
    assert.match(js, /function\s+startFreshAttempt[\s\S]{0,800}SESSION\.answers\s*=\s*new\s+Map\(\)/);
    assert.match(js, /function\s+startFreshAttempt[\s\S]{0,800}SESSION\.flagged\s*=\s*new\s+Set\(\)/);
  });
});

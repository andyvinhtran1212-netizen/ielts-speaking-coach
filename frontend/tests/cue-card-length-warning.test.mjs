/**
 * frontend/tests/cue-card-length-warning.test.mjs — Sprint 14.6.4
 *
 * UX-side sentinels for the Pattern #35 "constrain user input via UX"
 * approach to Andy's 2026-05-23 full-cue-card paste bug.
 *
 * The Part 2 input UX gets three new affordances:
 *
 *   1. Dynamic textarea placeholder — Part 2 shows a single-line
 *      example ("Describe a traditional festival..."); Part 1/3 keeps
 *      the multi-question example.
 *   2. Dynamic form-hint copy — Part 2 explicitly mentions "1 dòng
 *      đầu" guidance; Part 1/3 keeps the multi-question copy.
 *   3. Length warning — Part 2 + (>200 chars OR >30 words) renders a
 *      soft warning under the textarea. Part 1/3 and short Part 2
 *      pastes never show it.
 *
 * These sentinels pin the source contract — the JS helpers in
 * speaking.html and the CSS rules in ds.css. No headless browser
 * needed; the regex scan is enough to catch a regression where the
 * dynamic copy reverts to a static string or the warning helper
 * starts emitting inline colour literals (Pattern #26 violation).
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

const SPEAKING_HTML = readFront('pages', 'speaking.html');
const DS_CSS        = readFront('css', 'ds.css');


// ── Helper: extract a JS function body from speaking.html ──────────────────


function _extractFn(name) {
  const startRe = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{');
  const m = SPEAKING_HTML.match(startRe);
  if (!m) throw new Error(`function ${name} not found in speaking.html`);
  const startIdx = m.index + m[0].length;
  // The next top-level (4-space indented) `function` declaration
  // inside the inline <script> is the natural boundary.
  const tail = SPEAKING_HTML.slice(startIdx);
  const endMatch = tail.match(/\n    function\s+\w+/);
  return endMatch ? tail.slice(0, endMatch.index) : tail;
}


// ── 1) Markup: the warning element + the hint id are wired up ─────────────


describe('Sprint 14.6.4 — markup wiring for both cue-card forms', () => {

  test('practice form has the length-warning element with role="status"', () => {
    assert.match(
      SPEAKING_HTML,
      /id="prac-custom-q-length-warning"[\s\S]{0,200}role="status"/,
      'prac-custom-q-length-warning must carry role="status" so screen ' +
      'readers announce the warning when it appears.',
    );
    // Visible state is driven by data-state, not a class — pin the
    // initial "hidden" state so a refactor doesn't ship the warning
    // visible on first paint.
    assert.match(SPEAKING_HTML, /id="prac-custom-q-length-warning"[\s\S]{0,200}data-state="hidden"/);
  });

  test('modal form has the length-warning element with role="status"', () => {
    assert.match(SPEAKING_HTML, /id="myq-input-length-warning"[\s\S]{0,200}role="status"/);
    assert.match(SPEAKING_HTML, /id="myq-input-length-warning"[\s\S]{0,200}data-state="hidden"/);
  });

  test('practice form hint carries id="prac-custom-q-hint" for dynamic copy', () => {
    // The helper looks up `<textareaId>-hint` to swap the inner HTML.
    // Without the id the hint stays static and the Part 2 guidance
    // never appears.
    assert.match(SPEAKING_HTML, /id="prac-custom-q-hint"/);
  });

  test('modal form hint carries id="myq-input-hint" for dynamic copy', () => {
    assert.match(SPEAKING_HTML, /id="myq-input-hint"/);
  });

});


// ── 2) Helpers exist + are wired into setPracPart + openTopicModal ─────────


describe('Sprint 14.6.4 — helpers exist and are called from the Part setters', () => {

  test('_applyCueCardFormCopyForPart helper is defined', () => {
    assert.match(SPEAKING_HTML, /function\s+_applyCueCardFormCopyForPart\s*\(/);
  });

  test('_evaluateCueCardLengthWarning helper is defined', () => {
    assert.match(SPEAKING_HTML, /function\s+_evaluateCueCardLengthWarning\s*\(/);
  });

  test('setPracPart calls _applyCueCardFormCopyForPart + warning eval', () => {
    const body = _extractFn('setPracPart');
    assert.match(body, /_applyCueCardFormCopyForPart\(\s*['"]prac-custom-q['"]\s*,\s*part\s*\)/);
    assert.match(body, /_evaluateCueCardLengthWarning\(\s*['"]prac-custom-q['"]/);
  });

  test('openTopicModal calls _applyCueCardFormCopyForPart + warning eval', () => {
    // openTopicModal is async — _extractFn skips the `async ` keyword.
    // Just regex-search the file body for the call pair inside the
    // function's body window.
    assert.match(
      SPEAKING_HTML,
      /async function openTopicModal[\s\S]{0,2000}_applyCueCardFormCopyForPart\(\s*['"]myq-input['"]\s*,\s*part\s*\)/,
    );
    assert.match(
      SPEAKING_HTML,
      /async function openTopicModal[\s\S]{0,2000}_evaluateCueCardLengthWarning\(\s*['"]myq-input['"]/,
    );
  });

});


// ── 3) Copy contract: VN text the user actually reads ─────────────────────


describe('Sprint 14.6.4 — Vietnamese copy is pinned for both Part-2 surfaces', () => {

  test('Part 2 placeholder mentions the 1-line example + AI gen hint', () => {
    assert.match(SPEAKING_HTML, /_CUE_CARD_PLACEHOLDER_PART2\s*=/);
    // Pinned text: the explicit "1 dòng đầu" guidance + the canonical
    // "Describe a traditional festival..." example so the dogfood
    // case is visible in the placeholder.
    assert.match(SPEAKING_HTML, /Describe a traditional festival you attended/);
    assert.match(SPEAKING_HTML, /Chỉ cần 1 dòng đầu/);
  });

  test('Part 2 hint copy mentions "1 dòng đầu" + auto-generation', () => {
    assert.match(SPEAKING_HTML, /_CUE_CARD_HINT_PART2_HTML\s*=/);
    assert.match(SPEAKING_HTML, /chỉ nhập <em>1 dòng đầu<\/em>/);
    assert.match(SPEAKING_HTML, /web tự tạo phần/);
  });

  test('length-warning message includes the discarded-content reminder', () => {
    const body = _extractFn('_evaluateCueCardLengthWarning');
    assert.match(body, /Part 2 chỉ cần 1 dòng đầu/);
    assert.match(body, /sẽ bị bỏ qua/);
  });

});


// ── 4) Threshold contract: L3 200 chars / 30 words pinned ─────────────────


describe('Sprint 14.6.4 — length-warning thresholds match L3 lock', () => {

  test('threshold constants are 200 chars / 30 words (L3)', () => {
    assert.match(SPEAKING_HTML, /_CUE_CARD_LENGTH_WARN_CHARS\s*=\s*200\b/);
    assert.match(SPEAKING_HTML, /_CUE_CARD_LENGTH_WARN_WORDS\s*=\s*30\b/);
  });

  test('warning only fires when partNum === 2 (L4 — Part 1/3 stays clean)', () => {
    const body = _extractFn('_evaluateCueCardLengthWarning');
    // The guard `partNum !== 2` short-circuits to "hidden" before
    // the threshold maths run. Pin so Part 1/3 can't accidentally
    // trip the warning on a long multi-question paste.
    assert.match(body, /partNum\s*!==\s*2/);
  });

  test('warning hidden state is set via data-state, not inline display', () => {
    const body = _extractFn('_evaluateCueCardLengthWarning');
    // Pattern #26: visual state lives in CSS, not inline JS styles.
    assert.match(body, /warn\.dataset\.state\s*=\s*['"]hidden['"]/);
    assert.match(body, /warn\.dataset\.state\s*=\s*['"]visible['"]/);
  });

});


// ── 5) Pattern #26 — no inline color/bg in the new helpers ────────────────


describe('Sprint 14.6.4 — helpers carry NO inline color/bg literals (Pattern #26)', () => {

  test('_evaluateCueCardLengthWarning body has no inline color: style', () => {
    const body = _extractFn('_evaluateCueCardLengthWarning');
    assert.doesNotMatch(body, /style\s*=\s*["'][^"']*color\s*:/,
      'Sprint 14.6.4 length warning must reach colour through the ' +
      '.ds-cuecard-length-warning CSS rule. Inline styles break the ' +
      'light-theme flip (Sprint 14.6.1 lesson).');
  });

  test('_evaluateCueCardLengthWarning body has no inline background style', () => {
    const body = _extractFn('_evaluateCueCardLengthWarning');
    assert.doesNotMatch(body, /style\s*=\s*["'][^"']*background/);
  });

  test('_evaluateCueCardLengthWarning body has no hex / rgba colour literals', () => {
    const body = _extractFn('_evaluateCueCardLengthWarning');
    assert.doesNotMatch(body, /rgba\(\s*\d+\s*,/);
    assert.doesNotMatch(body, /#[0-9a-fA-F]{3,6}\b/);
  });

  test('_applyCueCardFormCopyForPart body has no inline color/bg literals', () => {
    const body = _extractFn('_applyCueCardFormCopyForPart');
    assert.doesNotMatch(body, /style\s*=\s*["'][^"']*color\s*:/);
    assert.doesNotMatch(body, /style\s*=\s*["'][^"']*background/);
  });

});


// ── 6) ds.css — length-warning rule binds to the --ds-warning-* tokens ────


describe('Sprint 14.6.4 — ds.css length-warning rule reuses Sprint 14.7 tokens', () => {

  test('.ds-cuecard-length-warning binds background + border to --ds-warning-*', () => {
    // Reusing the Sprint 14.7 amber palette means the light-theme
    // override is inherited — we don't have to re-derive WCAG AA
    // contrast for a separate token family.
    assert.match(
      DS_CSS,
      /\.ds-cuecard-length-warning\s*\{[\s\S]*?var\(--ds-warning-bg\)/,
    );
    assert.match(
      DS_CSS,
      /\.ds-cuecard-length-warning\s*\{[\s\S]*?var\(--ds-warning-border\)/,
    );
  });

  test('.ds-cuecard-length-warning-message binds colour to --ds-warning-text', () => {
    assert.match(
      DS_CSS,
      /\.ds-cuecard-length-warning-message\s*\{[\s\S]*?var\(--ds-warning-text\)/,
    );
  });

  test('.ds-cuecard-length-warning[data-state="hidden"] uses display:none', () => {
    // The toggle MUST be display-driven so screen readers don't read
    // hidden warnings via role="status" aria-live. opacity:0 would
    // keep the node announced.
    assert.match(
      DS_CSS,
      /\.ds-cuecard-length-warning\[data-state="hidden"\]\s*\{[\s\S]*?display\s*:\s*none/,
    );
  });

});


// ── 7) DOMContentLoaded wires the input listener for both forms ───────────


describe('Sprint 14.6.4 — debounced input listeners are bound at DOMContentLoaded', () => {

  test('practice textarea has a length watcher bound on DOMContentLoaded', () => {
    // The watcher signature is _bindCueCardLengthWatcher(
    //   textareaId, warningId, getPart). Pin the (textareaId,
    //   warningId) pair so a refactor that renames the textarea
    //   also has to update the listener — preventing silent UI
    //   regressions.
    assert.match(
      SPEAKING_HTML,
      /_bindCueCardLengthWatcher\(\s*\n?\s*['"]prac-custom-q['"]\s*,\s*['"]prac-custom-q-length-warning['"]/,
    );
  });

  test('modal textarea has a length watcher bound on DOMContentLoaded', () => {
    assert.match(
      SPEAKING_HTML,
      /_bindCueCardLengthWatcher\(\s*\n?\s*['"]myq-input['"]\s*,\s*['"]myq-input-length-warning['"]/,
    );
  });

  test('the watcher debounces input events (300ms timer pattern)', () => {
    // The debounce keeps the warning check off the keystroke critical
    // path. Pin the setTimeout so a future "make it real-time" change
    // gets a code review trigger.
    assert.match(
      SPEAKING_HTML,
      /_bindCueCardLengthWatcher[\s\S]{0,800}setTimeout\([\s\S]{0,300}300\s*\)/,
    );
  });

});

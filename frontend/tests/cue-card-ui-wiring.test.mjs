/**
 * frontend/tests/cue-card-ui-wiring.test.mjs — Sprint 14.4 (created)
 *                                              Sprint 14.6.2 (rewritten)
 *
 * Source-regex sentinels for the cue-card UI integration in
 * speaking.html. No headless browser in CI; these pin the structural
 * wire-up between the textareas and the part-driven routing function.
 *
 * Sprint 14.4 → 14.6.2 migration:
 *   - The 3-option radio toggle (Tự nhận diện / Câu hỏi riêng lẻ /
 *     Cue card Part 2) was redundant with the existing Part 1/2/3
 *     selector (Andy's 2026-05-22 17:03 screenshot). The toggle is
 *     gone; routing now flows from the Part button via
 *     `parseCustomQuestionsByPart(text, partNum)`.
 *   - This test file used to pin the toggle structure
 *     (`name="prac-q-mode"` / `name="myq-q-mode"`, role="radiogroup",
 *     `_wireCueCardPreview` listeners). Those assertions are inverted
 *     here: the toggle and its helper must be GONE so a future
 *     refactor can't silently reintroduce the redundant UI.
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
const DETECTOR_JS   = readFront('js',    'cue-card-detector.js');


// ── Script load order ─────────────────────────────────────────────────────


describe('Sprint 14.4 — cue-card-detector.js is loaded on speaking.html', () => {

  test('speaking.html ships a <script src> for cue-card-detector.js', () => {
    assert.match(SPEAKING_HTML, /<script\s+src="[^"]*cue-card-detector\.js"\s*>/);
  });

  test('cue-card-detector.js exposes window.CueCardDetector with both APIs', () => {
    assert.match(DETECTOR_JS, /window\.CueCardDetector\s*=/);
    assert.match(DETECTOR_JS, /detectCueCard:\s*detectCueCard/);
    // Sprint 14.4 — kept for L10 backward compat.
    assert.match(DETECTOR_JS, /parseCustomQuestions:\s*parseCustomQuestions/);
    // Sprint 14.6.2 — new part-driven router.
    assert.match(DETECTOR_JS, /parseCustomQuestionsByPart:\s*parseCustomQuestionsByPart/);
  });

});


// ── Sprint 14.6.2 — toggle is REMOVED (inverted sentinel) ────────────────


describe('Sprint 14.6.2 — Sprint 14.4 3-option mode toggle is gone', () => {

  test('no radio inputs named prac-q-mode remain', () => {
    // Andy lock L1 — the toggle is redundant with the Part selector.
    // Re-introducing it would re-create the screenshot bug.
    assert.doesNotMatch(SPEAKING_HTML, /name="prac-q-mode"/,
      'Sprint 14.6.2 removed the practice-page mode toggle; do not re-add it');
  });

  test('no radio inputs named myq-q-mode remain', () => {
    assert.doesNotMatch(SPEAKING_HTML, /name="myq-q-mode"/,
      'Sprint 14.6.2 removed the topic-modal mode toggle; do not re-add it');
  });

  test('no radiogroup labelled "Định dạng câu hỏi" remains', () => {
    assert.doesNotMatch(
      SPEAKING_HTML,
      /role="radiogroup"\s+aria-label="Định dạng câu hỏi"/,
      'The Sprint 14.4 mode-toggle radiogroup must stay removed (Sprint 14.6.2)',
    );
  });

  test('no _wireCueCardPreview / _renderCueCardPreview helpers remain', () => {
    // The preview helpers existed to re-render on toggle change. With
    // the toggle removed, the helpers are dead code; their removal is
    // part of the migration. Catch any accidental revert.
    assert.doesNotMatch(SPEAKING_HTML, /function\s+_wireCueCardPreview/);
    assert.doesNotMatch(SPEAKING_HTML, /function\s+_renderCueCardPreview/);
  });

});


// ── Sprint 14.6.2 — format-hint copy replaces the toggle UX ──────────────


describe('Sprint 14.6.2 — format-hint replaces the toggle in both forms', () => {

  test('hint paragraph carries the Part 1/3 vs Part 2 routing copy', () => {
    // The hint is the user-facing replacement for the toggle: tells
    // them what each part does with their paste so the "auto" routing
    // doesn't feel like a black box.
    const matches = SPEAKING_HTML.match(/class="cue-card-form-hint/g) || [];
    assert.ok(matches.length >= 2,
      'expected the cue-card-form-hint on BOTH custom-Q forms');
    assert.match(SPEAKING_HTML, /Part 1 \/ 3:\s*mỗi dòng một câu/);
    assert.match(SPEAKING_HTML, /Part 2:\s*paste cue card đầy đủ, hoặc nhập 1 dòng/);
  });

});


// ── Sprint 14.6.2 — submit handlers route through parseCustomQuestionsByPart ─


describe('Sprint 14.6.2 — submit handlers use the part-driven router', () => {

  test('confirmTopicAndStart awaits parseCustomQuestionsByPart with _modalPart', () => {
    // The handler must read the current Part button selection and
    // forward it as the routing argument. A regression to the
    // legacy parseCustomQuestions(text, mode) signature would silently
    // break Part 2 1-line trigger flow.
    assert.match(
      SPEAKING_HTML,
      /confirmTopicAndStart[\s\S]{0,4000}window\.CueCardDetector\.parseCustomQuestionsByPart\(\s*raw\s*,\s*_modalPart/,
    );
  });

  test('startPracticeCustomQ awaits parseCustomQuestionsByPart with _pracPart', () => {
    assert.match(
      SPEAKING_HTML,
      /startPracticeCustomQ[\s\S]{0,4000}window\.CueCardDetector\.parseCustomQuestionsByPart\(\s*raw\s*,\s*_pracPart/,
    );
  });

  test('cue card detected → session POST is forced to part: 2 (L9 carry-over)', () => {
    // Sprint 14.4 L9 still applies under Sprint 14.6.2: when the
    // detector returns a cue-card object, the session must be opened
    // as Part 2 so the Sprint 14.2 length gate (P2 = 80s) kicks in.
    // Match the pattern in BOTH handlers.
    const matches = SPEAKING_HTML.match(/isCueCard\s*\?\s*2\s*:\s*_(prac|modal)Part/g) || [];
    assert.ok(matches.length >= 2,
      'expected the part-clamp ternary in BOTH custom-Q submit handlers');
  });

});

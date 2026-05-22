/**
 * frontend/tests/cue-card-ui-wiring.test.mjs — Sprint 14.4.
 *
 * Source-regex sentinels for the cue-card UI integration in
 * speaking.html. No headless browser in CI; these pin the structural
 * wire-up between the textareas, the radio toggles, and the JS
 * helpers that call window.CueCardDetector.
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

  test('cue-card-detector.js exposes window.CueCardDetector', () => {
    // The HTML wire-up reads window.CueCardDetector.parseCustomQuestions;
    // if the module accidentally only export-defaults, the page breaks.
    assert.match(DETECTOR_JS, /window\.CueCardDetector\s*=/);
    assert.match(DETECTOR_JS, /detectCueCard:\s*detectCueCard/);
    assert.match(DETECTOR_JS, /parseCustomQuestions:\s*parseCustomQuestions/);
  });

});


// ── Radio toggle present in BOTH custom-Q forms ──────────────────────────


describe('Sprint 14.4 — toggle UI present in both custom-Q forms', () => {

  test('practice-page form (prac-custom-q) has 3-option mode toggle', () => {
    // The radio group is the entry point for L1 / L4. All three
    // values must exist or the parser can't be forced/auto-set.
    assert.match(SPEAKING_HTML, /name="prac-q-mode"\s+value="auto"\s+checked/);
    assert.match(SPEAKING_HTML, /name="prac-q-mode"\s+value="single"/);
    assert.match(SPEAKING_HTML, /name="prac-q-mode"\s+value="cue_card"/);
  });

  test('topic modal form (myq-input) has 3-option mode toggle', () => {
    assert.match(SPEAKING_HTML, /name="myq-q-mode"\s+value="auto"\s+checked/);
    assert.match(SPEAKING_HTML, /name="myq-q-mode"\s+value="single"/);
    assert.match(SPEAKING_HTML, /name="myq-q-mode"\s+value="cue_card"/);
  });

  test('toggle group carries an aria-label for accessibility', () => {
    // The two toggles are visually labelled in Vietnamese; the role +
    // aria-label keeps them announceable to screen readers.
    const matches = SPEAKING_HTML.match(
      /role="radiogroup"\s+aria-label="Định dạng câu hỏi"/g,
    ) || [];
    assert.ok(matches.length >= 2,
      'expected the aria-labelled radiogroup on BOTH custom-Q forms');
  });

  test('preview <p> elements exist for both forms', () => {
    assert.match(SPEAKING_HTML, /id="prac-custom-q-preview"/);
    assert.match(SPEAKING_HTML, /id="myq-input-preview"/);
  });

});


// ── Submit handlers route through the detector ───────────────────────────


describe('Sprint 14.4 — submit handlers call window.CueCardDetector', () => {

  test('confirmTopicAndStart calls parseCustomQuestions with the mode radio', () => {
    // The handler must read the radio value and hand it to the
    // detector. A plain `.split('\n')` regression would skip the
    // cue-card branch entirely.
    assert.match(
      SPEAKING_HTML,
      /confirmTopicAndStart[\s\S]{0,4000}window\.CueCardDetector\.parseCustomQuestions/,
    );
    assert.match(
      SPEAKING_HTML,
      /confirmTopicAndStart[\s\S]{0,4000}input\[name="myq-q-mode"\]:checked/,
    );
  });

  test('startPracticeCustomQ calls parseCustomQuestions with the mode radio', () => {
    assert.match(
      SPEAKING_HTML,
      /startPracticeCustomQ[\s\S]{0,2000}window\.CueCardDetector\.parseCustomQuestions/,
    );
    assert.match(
      SPEAKING_HTML,
      /startPracticeCustomQ[\s\S]{0,2000}input\[name="prac-q-mode"\]:checked/,
    );
  });

  test('cue card detected → session POST is forced to part: 2 (L9)', () => {
    // Without this clamp, a user pasting a cue card into a Part 1
    // session would still land in Part 1; the Sprint 14.2 length gate
    // (P2 = 80s) wouldn't apply.
    // Match the pattern in BOTH handlers — they both compute it.
    const matches = SPEAKING_HTML.match(/isCueCard\s*\?\s*2\s*:\s*_(prac|modal)Part/g) || [];
    assert.ok(matches.length >= 2,
      'expected the part-clamp ternary in BOTH custom-Q submit handlers');
  });

});


// ── Live-preview wiring (L6: blur + change re-parse) ─────────────────────


describe('Sprint 14.4 — preview re-renders on blur + toggle change (L6)', () => {

  test('_wireCueCardPreview attaches blur + change listeners', () => {
    assert.match(SPEAKING_HTML, /function\s+_wireCueCardPreview/);
    assert.match(
      SPEAKING_HTML,
      /_wireCueCardPreview[\s\S]{0,800}addEventListener\(\s*['"]blur['"]/,
    );
    assert.match(
      SPEAKING_HTML,
      /_wireCueCardPreview[\s\S]{0,800}addEventListener\(\s*['"]change['"]/,
    );
  });

  test('DOMContentLoaded wires both forms', () => {
    // Single source of truth for which textarea-id ↔ preview-id ↔
    // radio-group-name triples exist on the page.
    assert.match(
      SPEAKING_HTML,
      /_wireCueCardPreview\(\s*['"]prac-custom-q['"]\s*,\s*['"]prac-custom-q-preview['"]\s*,\s*['"]prac-q-mode['"]\s*\)/,
    );
    assert.match(
      SPEAKING_HTML,
      /_wireCueCardPreview\(\s*['"]myq-input['"]\s*,\s*['"]myq-input-preview['"]\s*,\s*['"]myq-q-mode['"]\s*\)/,
    );
  });

  test('preview text uses the canonical Vietnamese copy (L10)', () => {
    // The user-facing strings must survive a future tidy-up. Pin them
    // exactly — if a copy edit lands, this test forces the diff to
    // notice and update.
    assert.match(SPEAKING_HTML, /Đã nhận diện cue card/);
    assert.match(SPEAKING_HTML, /Đã nhận diện ['"]\s*\+\s*parsed\.length\s*\+\s*['"]/);
  });

});

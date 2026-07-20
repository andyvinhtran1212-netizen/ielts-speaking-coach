/**
 * frontend/tests/reading-completion-flowing-fix.test.mjs
 *
 * reading-completion-flowing-fix — the converted Cambridge reading set
 * emits EVERY completion type (sentence / table / form / flow-chart /
 * diagram) with the shared `template.summary_text` + `{{N}}` pattern and
 * per-Q `prompt: "(see summary above)"`. Before this fix the flowing block
 * (reading-exam.js) only fired for summary_completion / notes_completion, so
 * the other types fell through to the mono-block per-Q path — the
 * summary_text + its gaps were NEVER rendered and the run showed
 * "(see summary above)" with nothing above → UNANSWERABLE.
 *
 * This pins: (1) the flowing gate now covers all completion types that
 * carry summary_text, (2) the diagram/flow IMAGE check still runs BEFORE
 * the flowing gate so an uploaded image wins, (3) the flowing renderer uses
 * the line-preserving (STRUCTURED_LAYOUT) branch for tables/flow/sentence,
 * (4) the mono-block fallback for runs WITHOUT summary_text is untouched.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

describe('reading-completion-flowing-fix — broadened flowing gate', () => {
  const js = read('frontend/js/reading-exam.js');

  test('flowing gate now routes sentence / table / form / flow / diagram (+ summary / notes)', () => {
    // All completion types that authors emit with the shared summary_text
    // pattern must reach _renderFlowingSummaryBlock when summary_text is a
    // string. The gate lists the new types first, then the original tail.
    const gate = js.match(
      /if \(\(type === 'sentence_completion'[\s\S]{0,400}typeof run\[0\]\.payload\.template\.summary_text === 'string'\) \{[\s\S]{0,160}_renderFlowingSummaryBlock\(run\)/,
    );
    assert.ok(gate, 'broadened flowing gate not found');
    for (const t of ['sentence_completion', 'table_completion', 'form_completion',
                     'flow_chart_completion', 'diagram_label_completion',
                     'summary_completion', 'notes_completion']) {
      assert.match(gate[0], new RegExp(`type === '${t}'`), `gate missing ${t}`);
    }
  });

  test('original tail shape preserved (summary || notes) so legacy pins still hold', () => {
    // reading-rich-chuabai + 20.14e pin `... || type === 'notes_completion')`.
    assert.match(
      js,
      /type === 'summary_completion' \|\| type === 'notes_completion'\)[\s\S]{0,300}_renderFlowingSummaryBlock/,
    );
  });

  test('early-return after the flowing block still skips the per-Q card path', () => {
    assert.match(
      js,
      /_renderFlowingSummaryBlock\(run\)[\s\S]{0,200}return;\s*\/\/\s*skip the per-Q card path/,
    );
  });
});

describe('reading-completion-flowing-fix — diagram/flow image wins (ordering)', () => {
  const js = read('frontend/js/reading-exam.js');

  test('the image_url check appears BEFORE the flowing-block gate', () => {
    const imgIdx = js.indexOf('run[0].payload.image_url) {');
    const flowIdx = js.indexOf("if ((type === 'sentence_completion'");
    assert.ok(imgIdx > -1, 'image_url check not found');
    assert.ok(flowIdx > -1, 'flowing gate not found');
    assert.ok(
      imgIdx < flowIdx,
      'diagram/flow image_url check must precede the flowing gate so an uploaded image wins',
    );
  });

  test('image block still short-circuits with _renderDiagramImageBlock + return', () => {
    assert.match(
      js,
      /type === 'diagram_label_completion'[\s\S]{0,200}type === 'flow_chart_completion'[\s\S]{0,400}run\[0\]\.payload\.image_url[\s\S]{0,400}_renderDiagramImageBlock\(run\)[\s\S]{0,200}return;\s*\/\/\s*skip the mono-block path/,
    );
  });
});

describe('reading-completion-flowing-fix — line-preserving layout', () => {
  const js = read('frontend/js/reading-exam.js');

  test('_renderFlowingSummaryBlock uses STRUCTURED_LAYOUT for table/flow/sentence/form/diagram/notes', () => {
    const m = js.match(/var STRUCTURED_LAYOUT = \{([\s\S]{0,300}?)\};/);
    assert.ok(m, 'STRUCTURED_LAYOUT map not found');
    for (const t of ['notes_completion', 'table_completion', 'form_completion',
                     'flow_chart_completion', 'diagram_label_completion',
                     'sentence_completion']) {
      assert.match(m[1], new RegExp(`${t}:\\s*1`), `STRUCTURED_LAYOUT missing ${t}`);
    }
    // summary_completion is intentionally ABSENT (stays a prose paragraph).
    assert.doesNotMatch(m[1], /summary_completion:/);
  });

  test('isNotes flag is driven by STRUCTURED_LAYOUT (not a single-type equality)', () => {
    assert.match(js, /var isNotes = !!STRUCTURED_LAYOUT\[first\.question_type\]/);
  });
});

describe('reading-completion-flowing-fix — mono-block fallback intact', () => {
  const js = read('frontend/js/reading-exam.js');

  test('boxedTypes still tags table/form/flow/diagram as mono for no-summary_text runs', () => {
    assert.match(
      js,
      /var boxedTypes = \{[\s\S]{0,300}table_completion:\s*true[\s\S]{0,200}flow_chart_completion:\s*true[\s\S]{0,120}diagram_label_completion:\s*true/,
    );
  });
});

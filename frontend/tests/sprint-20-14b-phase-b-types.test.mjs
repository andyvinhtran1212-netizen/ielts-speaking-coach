/**
 * frontend/tests/sprint-20-14b-phase-b-types.test.mjs
 *
 * Sprint 20.14b — Phase B reading question types: frontend render
 * sentinels for the 7 newly-supported types and the shared bank-box
 * renderer they all use.
 *
 *   mcq_multi                    — Standards §2A.2: checkbox + bold
 *                                   prefix, soft-lock at template.choose
 *   matching_information         — §2A.6: select paragraph letters
 *                                   (no separate bank); letters come
 *                                   from template.paragraph_labels
 *   matching_features            — §2A.7: select + .exam-features-box
 *   matching_sentence_endings    — §2A.8: select + .exam-endings-box
 *   summary_completion word-bank — §2A.11: select + .exam-word-bank-box
 *                                   (variant distinguished by presence
 *                                   of authored options)
 *   flow_chart_completion        — §2A.12: inline-gap + .exam-gap-box--mono
 *   diagram_label_completion     — §2A.13: inline-gap + .exam-gap-box--mono
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');


// ── Shared bank-box renderer (matching / word-bank family) ────────────

describe('Sprint 20.14b — _renderBankBox shared renderer', () => {
  const js = read('frontend/js/reading-exam.js');

  test('_renderBankBox replaces _renderHeadingsBox as the shared helper', () => {
    assert.match(js, /function\s+_renderBankBox\s*\(\s*options\s*,\s*variant\s*\)/);
    // The old single-purpose name should be gone — the helper is generic.
    assert.ok(!/function\s+_renderHeadingsBox\s*\(/.test(js),
      '_renderHeadingsBox is replaced by the variant-aware _renderBankBox');
  });

  test('renderQuestions dispatches all 4 bank variants to the same helper', () => {
    assert.match(
      js,
      /BANK_VARIANTS\s*=\s*\{[\s\S]{0,800}matching_headings[\s\S]{0,400}matching_features[\s\S]{0,400}matching_sentence_endings[\s\S]{0,400}summary_completion/,
    );
  });

  test('word-bank variant only fires when authored options: are present', () => {
    // The summary_completion enum tag covers BOTH the no-bank (§2A.10)
    // and the word-bank (§2A.11) variants. The bank box must NOT render
    // for the no-bank one. The `requireOptions` flag on the variant
    // record is the gate.
    assert.match(
      js,
      /summary_completion:\s*\{[\s\S]{0,200}requireOptions:\s*true/,
    );
  });
});


// ── mcq_multi rendering (Standards §2A.2) ─────────────────────────────

describe('Sprint 20.14b — mcq_multi checkbox renderer', () => {
  const js = read('frontend/js/reading-exam.js');
  const css = read('frontend/css/reading-exam.css');

  test('renderInputs has a `mcq_multi` branch that builds a checkbox group', () => {
    assert.match(
      js,
      /type\s*===\s*['"]mcq_multi['"][\s\S]{0,1500}setAttribute\(\s*['"]role['"]\s*,\s*['"]group['"]/,
    );
    assert.match(js, /checkboxOption\(name,\s*val,\s*prefix,\s*o\.text/);
  });

  test('chooseN is read from q.payload.template.choose (not from q.payload)', () => {
    // The author writes `template: { choose: 2 }`; the builder copies
    // template → payload.template. The renderer must read from the
    // built-storage path, NOT a top-level `choose` field.
    assert.match(
      js,
      /tmpl\s*=\s*\(q\.payload\s*&&\s*q\.payload\.template\)\s*\|\|\s*\{\}[\s\S]{0,200}chooseN\s*=\s*\(typeof\s+tmpl\.choose/,
    );
  });

  test('soft-lock disables remaining checkboxes when chooseN ticks are made', () => {
    assert.match(
      js,
      /opts\.addEventListener\(['"]change['"][\s\S]{0,600}checked\s*>=\s*chooseN[\s\S]{0,200}disabled\s*=\s*lock/,
    );
  });

  test('checkboxOption helper exists and mirrors radioOption shape', () => {
    assert.match(js, /function\s+checkboxOption\s*\(\s*name\s*,\s*value\s*,\s*prefix\s*,\s*text\s*\)/);
    assert.match(
      js,
      /function\s+checkboxOption[\s\S]{0,600}input\.type\s*=\s*['"]checkbox['"]/,
    );
  });

  test('CSS for checkbox option ships', () => {
    assert.match(css, /\.exam-q__option--checkbox/);
  });
});


// ── matching_information (no bank, paragraph letters from template) ───

describe('Sprint 20.14b — matching_information renderer (§2A.6)', () => {
  const js = read('frontend/js/reading-exam.js');

  test('renderInputs branch reads paragraph_labels from template + falls back to A–H', () => {
    assert.match(
      js,
      /type\s*===\s*['"]matching_information['"][\s\S]{0,800}tmpl\.paragraph_labels[\s\S]{0,400}\[\s*['"]A['"]\s*,\s*['"]B['"]/,
    );
  });

  test('matching_information has its OWN QTYPE_INSTRUCTIONS template (not the shared one)', () => {
    assert.match(
      js,
      /matching_information:\s*function[\s\S]{0,400}Which paragraph contains/,
    );
  });
});


// ── matching_features (.exam-features-box) ────────────────────────────

describe('Sprint 20.14b — matching_features (§2A.7)', () => {
  const js = read('frontend/js/reading-exam.js');
  const css = read('frontend/css/reading-exam.css');

  test('renderInputs routes matching_features through the bank-select branch', () => {
    assert.match(
      js,
      /type\s*===\s*['"]matching_headings['"][\s\S]{0,400}matching_features/,
    );
  });

  test('BANK_VARIANTS declares the features-box variant', () => {
    assert.match(
      js,
      /matching_features:\s*\{\s*className:\s*['"]exam-features-box['"]/,
    );
  });

  test('CSS for .exam-features-box ships (sticky + bordered, like headings)', () => {
    assert.match(
      css,
      /\.exam-features-box[\s\S]{0,400}position:\s*sticky/,
    );
  });
});


// ── matching_sentence_endings (.exam-endings-box) ─────────────────────

describe('Sprint 20.14b — matching_sentence_endings (§2A.8)', () => {
  const js = read('frontend/js/reading-exam.js');
  const css = read('frontend/css/reading-exam.css');

  test('BANK_VARIANTS declares the endings-box variant', () => {
    assert.match(
      js,
      /matching_sentence_endings:\s*\{\s*className:\s*['"]exam-endings-box['"]/,
    );
  });

  test('CSS for .exam-endings-box ships', () => {
    assert.match(
      css,
      /\.exam-endings-box[\s\S]{0,400}position:\s*sticky/,
    );
  });
});


// ── summary_completion with word bank (§2A.11) ────────────────────────

describe('Sprint 20.14b — summary_completion word-bank variant (§2A.11)', () => {
  const js = read('frontend/js/reading-exam.js');
  const css = read('frontend/css/reading-exam.css');

  test('_isWordBankSummary helper distinguishes the two variants', () => {
    assert.match(js, /function\s+_isWordBankSummary\s*\(\s*q\s*\)/);
    assert.match(
      js,
      /_isWordBankSummary[\s\S]{0,400}question_type\s*===\s*['"]summary_completion['"][\s\S]{0,200}options/,
    );
  });

  test('word-bank summary is excluded from the inline-stem path (uses dropdown instead)', () => {
    assert.match(
      js,
      /_isInlineGapType\(q\.question_type\)[\s\S]{0,200}_stemHasGap[\s\S]{0,200}!_isWordBankSummary/,
    );
  });

  test('BANK_VARIANTS declares the word-bank-box variant + requireOptions gate', () => {
    assert.match(
      js,
      /summary_completion:\s*\{\s*className:\s*['"]exam-word-bank-box['"][\s\S]{0,200}requireOptions:\s*true/,
    );
  });

  test('CSS for .exam-word-bank-box ships', () => {
    assert.match(
      css,
      /\.exam-word-bank-box[\s\S]{0,400}position:\s*sticky/,
    );
  });
});


// ── flow_chart_completion + diagram_label_completion (mono-block) ─────

describe('Sprint 20.14b — flow_chart + diagram_label (mono-block, §2A.12 / §2A.13)', () => {
  const js = read('frontend/js/reading-exam.js');

  test('both types are in _isInlineGapType (stems carry ____ gap)', () => {
    assert.match(js, /_isInlineGapType[\s\S]{0,400}flow_chart_completion/);
    assert.match(js, /_isInlineGapType[\s\S]{0,400}diagram_label_completion/);
  });

  test('boxedTypes table tags both as mono (true) so .exam-gap-box--mono wraps the run', () => {
    assert.match(
      js,
      /var\s+boxedTypes\s*=\s*\{[\s\S]{0,500}flow_chart_completion:\s*true[\s\S]{0,200}diagram_label_completion:\s*true/,
    );
  });

  test('flow_chart + diagram_label each have a QTYPE_INSTRUCTIONS template', () => {
    assert.match(js, /flow_chart_completion:\s*function[\s\S]{0,300}Complete the flow-chart/);
    assert.match(js, /diagram_label_completion:\s*function[\s\S]{0,300}Label the diagram/);
  });
});


// ── readAnswer / restoreAnswers updated for checkboxes ────────────────

describe('Sprint 20.14b — checkbox serialise/restore round-trip', () => {
  const js = read('frontend/js/reading-exam.js');

  test('readAnswer comma-joins ticked checkbox values', () => {
    assert.match(
      js,
      /function\s+readAnswer[\s\S]{0,800}input\[type="checkbox"\]:checked[\s\S]{0,400}vals\.join\(',\s*'\)/,
    );
  });

  test('restoreAnswers splits the stored value on , (and ;) and ticks each box', () => {
    assert.match(
      js,
      /function\s+restoreAnswers[\s\S]{0,1500}input\[type="checkbox"\][\s\S]{0,200}replace\(\/;\/g[\s\S]{0,100}split\(','\)/,
    );
  });
});


// ── Whitelist + v2 spec sync ──────────────────────────────────────────

describe('Sprint 20.14b — backend whitelist + v2 spec sync', () => {
  test('backend whitelist includes all 7 Phase B types', () => {
    const svc = read('backend/services/content_import_service.py');
    for (const t of [
      'mcq_multi', 'matching_information', 'matching_features',
      'matching_sentence_endings', 'flow_chart_completion',
      'diagram_label_completion',
    ]) {
      assert.match(svc, new RegExp(`["']${t}["']`), `${t} missing from content_import_service.py`);
    }
  });

  test('options-required tuple includes matching_features + matching_sentence_endings + mcq_multi', () => {
    const svc = read('backend/services/content_import_service.py');
    assert.match(
      svc,
      /_READING_QUESTION_TYPES_REQUIRE_OPTIONS[\s\S]{0,400}matching_features[\s\S]{0,400}matching_sentence_endings/,
    );
    assert.match(svc, /_READING_QUESTION_TYPES_REQUIRE_OPTIONS[\s\S]{0,400}mcq_multi/);
  });

  test('grader has mcq_multi set-equality branch', () => {
    const grader = read('backend/services/reading_test_grader.py');
    // Python `==`, not JS `===`. The branch ends in
    // `user_norm == expected_norm` (or the reverse).
    assert.match(
      grader,
      /qtype\s*==\s*['"]mcq_multi['"][\s\S]{0,1500}user_norm\s*==\s*expected_norm/,
    );
  });

  test('v2 spec docs §4.2 marks all 7 types as Phase B unlocked', () => {
    const spec = read('docs/clusters/20_x/reading_content_format_v2.md');
    // Should NOT have "Phase B" against these types anymore (they're
    // now author-able). The Phase B label is replaced with the Sprint
    // 20.14b unlock note.
    assert.match(spec, /mcq_multi[^|]*\|\s*✅\s*\(Sprint 20\.14b\)/);
    assert.match(spec, /matching_information[^|]*\|\s*✅/);
    assert.match(spec, /flow_chart_completion[^|]*\|\s*✅/);
  });
});

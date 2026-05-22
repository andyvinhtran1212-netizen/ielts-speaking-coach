/**
 * frontend/tests/speaking-rubric-v2-compat.test.mjs — Sprint 14.5.
 *
 * Sprint 14.5 is intentionally a backend-only uplift (prompt + rubric
 * data + additive `rubric_version` field). The frontend rendering
 * contract MUST NOT change — pre-14.5 results and post-14.5 results
 * have the same shape (the new `rubric_version` field is ignored by
 * the renderer). These sentinels pin that we did NOT accidentally
 * break the renderer's expectations.
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
function readBack(...parts) {
  return readFileSync(join(__dirname, '..', '..', 'backend', ...parts), 'utf8');
}

const PRACTICE_JS = readFront('js', 'practice.js');
const GRADER_PY   = readBack('services', 'claude_grader.py');


// ── Frontend renderer still reads the legacy field names ─────────────────


describe('Sprint 14.5 — frontend renderer contract unchanged', () => {

  test('practice.js still reads band_fc / band_lr / band_gra / band_p', () => {
    // The Sprint 14.5 uplift ADDS rubric_version to the JSON shape but
    // keeps every existing field. If the renderer stops reading these,
    // results pages go blank.
    for (const field of ['band_fc', 'band_lr', 'band_gra', 'band_p']) {
      assert.ok(
        PRACTICE_JS.includes('data.' + field),
        `practice.js must still reference data.${field}`,
      );
    }
  });

  test('practice.js still reads *_feedback strings', () => {
    for (const field of ['fc_feedback', 'lr_feedback', 'gra_feedback', 'p_feedback']) {
      assert.ok(
        PRACTICE_JS.includes('data.' + field),
        `practice.js must still reference data.${field}`,
      );
    }
  });

  test('practice.js still reads strengths / improvements / improved_response', () => {
    assert.match(PRACTICE_JS, /data\.strengths/);
    assert.match(PRACTICE_JS, /data\.improvements/);
    assert.match(PRACTICE_JS, /data\.improved_response/);
  });

  test('practice.js still reads grammar_issues / vocabulary_issues / corrections (practice mode)', () => {
    assert.match(PRACTICE_JS, /data\.grammar_issues/);
    assert.match(PRACTICE_JS, /data\.vocabulary_issues/);
    assert.match(PRACTICE_JS, /data\.corrections/);
  });

});


// ── Backend prompt + validator additive shape ────────────────────────────


describe('Sprint 14.5 — backend additive contract', () => {

  test('claude_grader still defines the same legacy required fields in test mode', () => {
    // The _REQUIRED_FIELDS dict is the single source of truth for which
    // keys the validator demands. If a future cleanup tries to bend it
    // toward the original commission\'s v2 shape (criteria object), the
    // diff would show as removing these keys — pin them.
    for (const field of [
      '"band_fc"', '"band_lr"', '"band_gra"', '"band_p"',
      '"overall_band"',
      '"fc_feedback"', '"lr_feedback"', '"gra_feedback"', '"p_feedback"',
      '"strengths"', '"improvements"', '"improved_response"',
    ]) {
      assert.ok(
        GRADER_PY.includes(field),
        `claude_grader.py must still reference required field ${field}`,
      );
    }
  });

  test('rubric_version field is additive (default v1) — no required-field promotion', () => {
    // The validator normalises rubric_version with a default of "v1"
    // for missing/empty. A future tidy-up flipping the default to
    // "v2" would silently mis-tag every legacy DB row that runs
    // through the validator post-fetch (admin regrade re-validates).
    assert.match(
      GRADER_PY,
      /data\["rubric_version"\]\s*=\s*str\(rv\)\s+if\s+isinstance\(rv,\s*str\)\s+and\s+rv\s+else\s+"v1"/,
    );
  });

  test('grading endpoint still returns the legacy practice + test shape', () => {
    // Anchor that grading.py keeps mapping the validated payload into
    // the response keys the frontend already consumes. Sprint 14.5
    // adds no new keys to the HTTP response.
    const GRADING_PY = readBack('routers', 'grading.py');
    for (const field of [
      '"band_fc":', '"band_lr":', '"band_gra":', '"band_p":',
      '"fc_feedback":', '"lr_feedback":', '"gra_feedback":', '"p_feedback":',
      '"strengths":', '"improvements":', '"improved_response":',
      '"grammar_issues":', '"vocabulary_issues":', '"corrections":',
    ]) {
      assert.ok(
        GRADING_PY.includes(field),
        `grading.py response payload must still set ${field}`,
      );
    }
  });

});

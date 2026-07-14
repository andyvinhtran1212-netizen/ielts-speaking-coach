// Spike-2 fix (defect g) — source pins. Behavioral coverage lives in
// tests/e2e/test_part_resume.spec.js; these lock the invariants a refactor
// could silently drop.
//
// Design (hardened per review #749): test_part grades each answer through the
// SAME awaited path as practice (_startProcessing → _uploadAndGrade), which
// persists the response BEFORE advancing — so a refresh can never lose a
// confirmed answer, and there is no in-memory blob queue to abort.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = readFileSync(path.join(FRONTEND, 'js', 'practice.js'), 'utf8');

test('the in-memory answer queue AND the fire-and-forget eager path are GONE', () => {
  assert.ok(!SRC.includes('var _pendingTestAnswers'),
    'queued blobs die on refresh — that WAS the defect');
  assert.ok(!SRC.includes('_pendingTestAnswers.push'));
  assert.ok(!SRC.includes('_processPendingAnswers'));
  // review #749: no fire-and-forget-then-advance for test_part — that left a
  // refresh-during-grading window (blob in memory, fetch abortable).
  assert.ok(!SRC.includes('_ptTrackUpload'));
  assert.ok(!SRC.includes('_waitForEagerUploads'));
});

test('test_part submit awaits grading before advancing (no immediate advance)', () => {
  // Neither submit path (submitRecording, p2c onstop) may special-case
  // test_part with an immediate advance — both must reach _startProcessing,
  // whose _uploadAndGrade awaits and only then _showFeedback advances.
  const advanceImmediate = SRC.match(/_testMode === 'test_part'[\s\S]{0,200}?_advanceTestMode\(\);\s*\n\s*return;/g) || [];
  assert.strictEqual(advanceImmediate.length, 0,
    'test_part must NOT advance before the upload resolves (review #749 window)');
  // _showFeedback is the test-mode advance point, reached only after the
  // awaited grade.
  assert.match(SRC, /function _showFeedback\(data\) \{[\s\S]{0,160}?if \(_testMode\) \{[\s\S]{0,220}?_advanceTestMode\(\);/);
});

test('end of test_part hands straight to the canonical result page', () => {
  assert.match(SRC, /_testMode === 'test_part'\) \{[\s\S]{0,220}?_finishTestAndShowResults\(\);/);
});

test('init resumes test_part at the first unanswered question', () => {
  assert.match(SRC, /_testMode === 'test_part' && _sessionData\.responses/,
    'resume is driven by PERSISTED responses (backend truth)');
  assert.match(SRC, /_answeredQ\[_questions\[_currentIdx\]\.id \|\| _questions\[_currentIdx\]\.question_id\]/);
  const resumeIdx = SRC.indexOf("_testMode === 'test_part' && _sessionData.responses");
  const finishIdx = SRC.indexOf('_finishTestAndShowResults();', resumeIdx);
  assert.ok(finishIdx !== -1 && finishIdx - resumeIdx < 1200,
    'refresh after the last answer must hand off to the result page');
});

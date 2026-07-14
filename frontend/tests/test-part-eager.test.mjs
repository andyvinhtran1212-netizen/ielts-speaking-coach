// Spike-2 fix (defect g) — source pins. Behavioral coverage lives in
// tests/e2e/test_part_resume.spec.js; these lock the invariants a refactor
// could silently drop.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = readFileSync(path.join(FRONTEND, 'js', 'practice.js'), 'utf8');

test('the in-memory answer queue is GONE — uploads are eager', () => {
  assert.ok(!SRC.includes('var _pendingTestAnswers'),
    'queued blobs die on refresh — that WAS the defect');
  assert.ok(!SRC.includes('_pendingTestAnswers.push'));
  assert.ok(!SRC.includes('_processPendingAnswers'),
    'end-of-test must NOT re-upload — answers were already graded eagerly');
  const eagerCalls = SRC.match(/_ptTrackUpload\(_submitGradingEager\(_sessionId, questionId, _recordedBlob\)\)/g) || [];
  assert.strictEqual(eagerCalls.length, 2,
    'BOTH test_part submit paths (Part 1/3 + Part 2 onstop) must upload eagerly');
});

test('end of test waits for in-flight uploads, never re-submits', () => {
  assert.match(SRC, /function _waitForEagerUploads\(callback\)/);
  assert.match(SRC, /Promise\.all\(pending\)/);
  assert.match(SRC, /_ptUploadFailures\.push\(questionId\)/,
    'failed eager uploads must be recorded, not vanish silently');
});

test('init resumes test_part at the first unanswered question', () => {
  assert.match(SRC, /_testMode === 'test_part' && _sessionData\.responses/,
    'resume is driven by PERSISTED responses (backend truth)');
  assert.match(SRC, /_answeredQ\[_questions\[_currentIdx\]\.id \|\| _questions\[_currentIdx\]\.question_id\]/);
  // all-answered refresh → finish (complete + canonical result page), not Q1
  const resumeIdx = SRC.indexOf("_testMode === 'test_part' && _sessionData.responses");
  const finishIdx = SRC.indexOf('_finishTestAndShowResults();', resumeIdx);
  assert.ok(finishIdx !== -1 && finishIdx - resumeIdx < 1200,
    'refresh after the last answer must hand off to the result page');
});

/**
 * practice-persist-failure.test.mjs — P0-2 (silent grade-save failure).
 *
 * Backend now fails loud (500 error_code=response_persist_failed) instead of the
 * old silent 200/null, and flags partial saves. The frontend must:
 *   • on a persist-failure 500 → show retry, NOT enter feedback;
 *   • tolerate an old 200 with no response_id (treat as persist failure → retry);
 *   • surface data.partial as a soft note but still show feedback.
 * Real-value checks (run the actual _gradeMissingPersist), not "element exists".
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const js = readFileSync(path.join(REPO, 'frontend/js/practice.js'), 'utf8');
const grading = readFileSync(path.join(REPO, 'backend/routers/grading.py'), 'utf8');


describe('P0-2 FE — _gradeMissingPersist detects an unsaved grade (real value)', () => {
  const m = js.match(/function _gradeMissingPersist\(data\) \{[\s\S]*?\n  \}/);
  const fn = new Function(m[0] + '\nreturn _gradeMissingPersist;')();
  test('200 WITH response_id → saved (false)', () => {
    assert.equal(fn({ response_id: 'r1', overall_band: 6 }), false);
  });
  test('200 with NULL response_id → unsaved → true (old silent-fail, tolerant)', () => {
    assert.equal(fn({ response_id: null, overall_band: 6 }), true);
    assert.equal(fn({ overall_band: 6 }), true);
  });
  test('client error-stub (_error) is exempt → false (keeps legacy stub path)', () => {
    assert.equal(fn({ _stub: true, _error: 'network' }), false);
  });
  test('server stub WITH response_id → false (audio saved, grading unavailable)', () => {
    assert.equal(fn({ _stub: true, response_id: 'r1' }), false);
  });
});


describe('P0-2 FE — persist failure routes to RETRY, never feedback', () => {
  test('the 500 persist-failure branch calls _handlePersistFailure and returns (no feedback)', () => {
    const fn = js.slice(js.indexOf('async function _uploadAndGrade'), js.indexOf('function _handleAudioTooShort'));
    assert.match(fn, /error_code === 'response_persist_failed'/);
    assert.match(fn, /_handlePersistFailure\(detail\)/);
  });
  test('the success path guards on _gradeMissingPersist before _showFeedback', () => {
    const fn = js.slice(js.indexOf('async function _uploadAndGrade'), js.indexOf('function _handlePersistFailure'));
    assert.match(fn, /!_testMode && _gradeMissingPersist\(data\)/);
    assert.match(fn, /_handlePersistFailure\(null\)/);
  });
  test('_handlePersistFailure enters the RECORDING/retry state, not feedback', () => {
    const fn = js.slice(js.indexOf('function _handlePersistFailure'), js.indexOf('function _showPartialNote'));
    assert.match(fn, /showState\('recording'\)/);
    assert.match(fn, /_showRecSub\('recorded'\)/);
    assert.match(fn, /_showRecError\(/);
    assert.ok(!/showState\('feedback'\)/.test(fn), 'must NOT enter feedback on a persist failure');
  });
  test('partial save → soft note shown in feedback (still viewable)', () => {
    assert.match(js, /_showPartialNote\(!!\(data && data\.partial\)\)/);
    const fn = js.slice(js.indexOf('function _showPartialNote'));
    assert.match(fn, /feedback-partial-note/);
    assert.match(fn, /thiếu một số thông tin/);
  });
});


describe('P0-2 BE cross-ref — fails loud + flags partial', () => {
  test('both-fail raises 500 with error_code, not a silent 200/null', () => {
    assert.match(grading, /"error_code":\s*"response_persist_failed"/);
    assert.match(grading, /status_code=500/);
    assert.match(grading, /response_persist_failed=1/);   // observability metric tag
  });
  test('partial flag is returned in the practice + test payloads', () => {
    assert.match(grading, /"partial":\s*partial/);
    assert.match(grading, /response_persist_partial=1/);  // observability metric tag
  });
});

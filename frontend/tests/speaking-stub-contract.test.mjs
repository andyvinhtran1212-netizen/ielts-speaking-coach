/**
 * frontend/tests/speaking-stub-contract.test.mjs — Sprint 14.3.
 *
 * Pins the "AI grading temporarily unavailable" fallback contract that
 * Sprint 14.3's provider fallback chain must preserve on the
 * all-providers-fail path (L8).
 *
 * The contract is structural, not visual: the backend returns
 *   { _stub: true, _error: "...temporarily unavailable..." }
 * and the frontend dispatches on those two fields in
 * practice.js _showFeedback. Sprint 14.3 ADDS a new fallback chain
 * (Haiku → Gemini → Sonnet) but reuses this same stub shape on the
 * chain-exhausted path. If a future cleanup migrates either side to
 * a different shape (e.g. HTTP 503 status), this sentinel forces an
 * explicit coordinated change.
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
const GRADING_PY  = readBack('routers', 'grading.py');


describe('Sprint 14.3 — backend returns stub shape on grading failure', () => {

  test('grading.py emits {_stub: True, _error: "...temporarily unavailable..."}', () => {
    // Two `_stub` paths exist; the user-facing "AI unavailable" message
    // is the one Sprint 14.3 must preserve. Pin the literal string the
    // frontend keys off (.includes('temporarily unavailable')).
    assert.match(GRADING_PY, /"_stub":\s*True/);
    assert.match(
      GRADING_PY,
      /"_error":\s*"AI grading is temporarily unavailable\./,
      'grading.py must keep the canonical English error message ' +
      'the frontend keys off via .includes("temporarily unavailable")',
    );
  });

  test('grading.py keeps grading_status = "completed" | "failed" semantics', () => {
    // Sprint 14.3 considered adding a 'pending_retry' status but the
    // existing 'failed' value drives the admin regrade UI already.
    // Pin that the wire-in did NOT introduce a third status string,
    // which would split the admin queue.
    assert.match(
      GRADING_PY,
      /"grading_status":\s+"completed"\s+if\s+grading\s+else\s+"failed"/,
    );
    assert.doesNotMatch(GRADING_PY, /"grading_status":\s*"pending_retry"/);
  });

});


describe('Sprint 14.3 — frontend stub-banner UX preserved', () => {

  test('practice.js still dispatches on data._stub + "temporarily unavailable"', () => {
    // _showFeedback's stub branch (existing UX from Sprint <14) is
    // the L8 destination when every provider in the chain fails.
    assert.match(PRACTICE_JS, /data\._stub/);
    assert.match(
      PRACTICE_JS,
      /data\._error\s*&&\s*data\._error\.includes\(['"]temporarily unavailable['"]\)/,
    );
  });

  test('practice.js renders the canonical Vietnamese fallback message', () => {
    // Pin the user-visible copy so a future redesign cannot silently
    // delete it. Andy's empirical evidence (2026-05-22 screenshot)
    // shows exactly this string in production; the chain must keep
    // that surface stable until the rubric overhaul lands.
    assert.match(PRACTICE_JS, /AI chấm điểm tạm thời không khả dụng/);
    assert.match(PRACTICE_JS, /Bản ghi âm và văn bản của bạn đã được lưu thành công/);
  });

});

// EXAMLISTENT-0070 T001: pure exam-room model for the Listening test room.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LISTENING_ABANDONED_MESSAGE,
  LISTENING_SUBMIT_AUTO_RETRIES,
  listeningAudioPolicy,
  listeningSubmitOutcome,
} from '../lib/listening-test-controller.mjs';

const ID = '11111111-2222-4333-8444-555555555555';
const httpError = (status, detail) => Object.assign(new Error(typeof detail === 'string' ? detail : `HTTP ${status}`), { status, detail });

describe('listeningAudioPolicy (FR-006)', () => {
  test('full test plays as a test', () => {
    assert.equal(listeningAudioPolicy({ test_type: 'full' }), 'test');
  });
  test('mini test, drill and practice play as practice', () => {
    for (const type of ['mini', 'drill', 'practice']) assert.equal(listeningAudioPolicy({ test_type: type }), 'practice', type);
  });
  test('a full-type class assignment plays as a test; an assigned mini test stays practice', () => {
    assert.equal(listeningAudioPolicy({ test_type: 'full' }, { classItem: 'item-1' }), 'test');
    assert.equal(listeningAudioPolicy({ test_type: 'mini' }, { classItem: 'item-1' }), 'practice');
  });
  test('a mock sitting always plays as a test', () => {
    assert.equal(listeningAudioPolicy({ test_type: 'full' }, { sittingId: 'sit-1' }), 'test');
    assert.equal(listeningAudioPolicy({ test_type: 'mini' }, { sittingId: 'sit-1' }), 'test');
  });
  test('missing or unknown type fails closed to test', () => {
    assert.equal(listeningAudioPolicy({}), 'test');
    assert.equal(listeningAudioPolicy(null), 'test');
    assert.equal(listeningAudioPolicy({ test_type: 'surprise' }), 'test');
  });
});

describe('listeningSubmitOutcome (FR-010)', () => {
  test('matching attempt_id is confirmed', () => {
    const s = listeningSubmitOutcome({ attemptId: ID, reply: { attempt_id: ID, score: 30 } });
    assert.deepEqual({ ...s }, { outcome: 'confirmed', next: 'results', waitFor: null, message: null, sealed: false, clearLocalCopy: false });
    assert.ok(Object.isFrozen(s));
  });
  test('a sealed mock receipt is confirmed and flagged sealed', () => {
    const s = listeningSubmitOutcome({ attemptId: ID, sittingId: 's', reply: { received: true, sitting_id: 's', sealed: true } });
    assert.equal(s.outcome, 'confirmed');
    assert.equal(s.sealed, true);
  });
  test('a sealed reply for a different sitting or attempt cannot acknowledge this submission', () => {
    for (const reply of [
      { received: true, sealed: true, sitting_id: 'other', attempt_id: ID },
      { received: true, sealed: true, sitting_id: 's', attempt_id: 'other' },
    ]) {
      assert.equal(listeningSubmitOutcome({ attemptId: ID, sittingId: 's', reply }).next, 'retry');
    }
  });
  test('a sealed receipt with a capture envelope (it also carries attempt_id) stays sealed', () => {
    const s = listeningSubmitOutcome({ attemptId: ID, sittingId: 's', reply: { received: true, sitting_id: 's', sealed: true, attempt_id: ID, post_test_capture_required: true } });
    assert.equal(s.outcome, 'confirmed');
    assert.equal(s.sealed, true);
  });
  test('a re-read showing submitted is confirmed', () => {
    const s = listeningSubmitOutcome({ attemptId: ID, error: new TypeError('Failed to fetch'), reread: { status: 'submitted' } });
    assert.equal(s.outcome, 'confirmed');
    assert.equal(s.next, 'results');
  });
  test('offline / network error stays in the test and retries when online', () => {
    const s = listeningSubmitOutcome({ attemptId: ID, error: new TypeError('Failed to fetch'), online: false });
    assert.equal(s.outcome, 'unconfirmed');
    assert.equal(s.next, 'retry');
    assert.equal(s.waitFor, 'online');
    assert.equal(listeningSubmitOutcome({ attemptId: ID, error: httpError(503), online: false }).waitFor, 'online');
  });
  test('a request cut off while the browser is still online backs off; it never waits for an online event (CR #2557)', () => {
    for (const autoRetries of [0, 1, 2]) {
      const s = listeningSubmitOutcome({ attemptId: ID, error: new TypeError('Failed to fetch'), online: true, autoRetries });
      assert.deepEqual([s.outcome, s.next, s.waitFor], ['unconfirmed', 'retry', null], String(autoRetries));
    }
    const spent = listeningSubmitOutcome({ attemptId: ID, error: new TypeError('Failed to fetch'), online: true, autoRetries: 3 });
    assert.deepEqual([spent.outcome, spent.next], ['unconfirmed_manual', 'manual']);
  });
  test('401 stops the automatic retries and keeps "Try again" (CR #2557 F1)', () => {
    for (const autoRetries of [0, 1, 3]) {
      const s = listeningSubmitOutcome({ attemptId: ID, error: httpError(401), autoRetries });
      assert.equal(s.outcome, 'unconfirmed_manual');
      assert.equal(s.next, 'manual');
      assert.equal(s.waitFor, 'signin');
    }
  });
  test('a failed re-read keeps the automatic tries while they last (CR #2557 F4)', () => {
    const lost = { status: 'unknown' };
    for (const autoRetries of [0, 1, 2]) {
      const s = listeningSubmitOutcome({ attemptId: ID, error: httpError(409), reread: lost, autoRetries });
      assert.equal(s.outcome, 'unconfirmed', String(autoRetries));
      assert.equal(s.next, 'retry');
      assert.equal(s.waitFor, null);
    }
    assert.equal(listeningSubmitOutcome({ attemptId: ID, error: httpError(409), reread: lost, online: false }).waitFor, 'online');
    const spent = listeningSubmitOutcome({ attemptId: ID, error: httpError(409), reread: lost, autoRetries: 3 });
    assert.equal(spent.outcome, 'unconfirmed_manual');
    assert.equal(spent.next, 'manual');
    const signedOut = listeningSubmitOutcome({ attemptId: ID, error: httpError(409), reread: { status: 'unknown', signin: true } });
    assert.deepEqual([signedOut.outcome, signedOut.next, signedOut.waitFor], ['unconfirmed_manual', 'manual', 'signin']);
  });
  test('temporary errors retry after backoff', () => {
    for (const status of [408, 425, 429, 500, 502, 503]) {
      const s = listeningSubmitOutcome({ attemptId: ID, error: httpError(status) });
      assert.equal(s.outcome, 'unconfirmed', String(status));
      assert.equal(s.waitFor, null);
    }
  });
  test('a lost response (no matching acknowledgement) is unconfirmed, never confirmed', () => {
    for (const reply of [undefined, null, {}, { attempt_id: 'other' }, { received: true }, { sealed: true }]) {
      assert.equal(listeningSubmitOutcome({ attemptId: ID, reply }).outcome, 'unconfirmed', JSON.stringify(reply));
    }
  });
  test(`after ${LISTENING_SUBMIT_AUTO_RETRIES} automatic retries it becomes unconfirmed_manual`, () => {
    assert.equal(listeningSubmitOutcome({ attemptId: ID, error: httpError(503), autoRetries: LISTENING_SUBMIT_AUTO_RETRIES - 1 }).next, 'retry');
    const s = listeningSubmitOutcome({ attemptId: ID, error: httpError(503), autoRetries: LISTENING_SUBMIT_AUTO_RETRIES });
    assert.equal(s.outcome, 'unconfirmed_manual');
    assert.equal(s.next, 'manual');
  });
  test('409 asks for a re-read; in_progress then allows a resubmit, submitted is confirmed', () => {
    const conflict = httpError(409, 'Attempt đã thay đổi; hãy tải lại trạng thái.');
    assert.deepEqual([listeningSubmitOutcome({ attemptId: ID, error: conflict }).outcome, listeningSubmitOutcome({ attemptId: ID, error: conflict }).next], ['unconfirmed', 'reread']);
    const open = listeningSubmitOutcome({ attemptId: ID, error: conflict, reread: { status: 'in_progress' } });
    assert.deepEqual([open.outcome, open.next], ['idle', 'resubmit']);
    assert.equal(listeningSubmitOutcome({ attemptId: ID, error: conflict, reread: { status: 'submitted' } }).outcome, 'confirmed');
  });
  test('422 already-submitted replay re-reads and confirms from the re-read', () => {
    const replay = httpError(422, 'Attempt đã submit rồi — không thể submit lại.');
    assert.equal(listeningSubmitOutcome({ attemptId: ID, error: replay }).next, 'reread');
    assert.equal(listeningSubmitOutcome({ attemptId: ID, error: replay, reread: { status: 'submitted' } }).outcome, 'confirmed');
    assert.equal(listeningSubmitOutcome({ attemptId: ID, error: replay, reread: { status: 'in_progress' } }).outcome, 'unconfirmed_manual');
  });
  test('a re-read showing abandoned is never confirmed and clears the local copy', () => {
    const s = listeningSubmitOutcome({ attemptId: ID, error: httpError(422, 'Attempt status không hợp lệ.'), reread: { status: 'abandoned' } });
    assert.deepEqual({ ...s }, { outcome: 'abandoned', next: 'back', waitFor: null, message: LISTENING_ABANDONED_MESSAGE, sealed: false, clearLocalCopy: true });
    assert.equal(listeningSubmitOutcome({ attemptId: ID, reply: { attempt_id: ID }, reread: { status: 'abandoned' } }).outcome, 'abandoned');
  });
  test('24 h resume expiry (410) shows the server message with Back', () => {
    const detail = 'Phiên làm bài đã hết thời gian tiếp tục. Dữ liệu cũ vẫn được lưu; hãy bắt đầu một phiên mới.';
    const s = listeningSubmitOutcome({ attemptId: ID, error: httpError(410, detail) });
    assert.deepEqual([s.outcome, s.next, s.message], ['expired', 'back', detail]);
  });
  test('other refusals stop retrying with the server message, no full-page error', () => {
    const s = listeningSubmitOutcome({ attemptId: ID, error: httpError(403, { message: 'Lớp đã lưu trữ.' }) });
    assert.deepEqual([s.outcome, s.next, s.message], ['unconfirmed_manual', 'manual', 'Lớp đã lưu trữ.']);
  });
  test('never returns the timed-close outcomes Listening does not use', () => {
    const inputs = [
      { reply: { attempt_id: ID } }, { error: new TypeError('x') }, { error: httpError(401) }, { error: httpError(409) },
      { error: httpError(410) }, { error: httpError(422) }, { error: httpError(403) }, { error: httpError(500), autoRetries: 9 },
      { reread: { status: 'weird' } },
    ];
    for (const input of inputs) {
      assert.ok(!['closed_unconfirmed', 'expired_unsubmitted'].includes(listeningSubmitOutcome({ attemptId: ID, ...input }).outcome));
    }
  });
  test('requires the attempt id', () => {
    assert.throws(() => listeningSubmitOutcome({ attemptId: '', reply: {} }), /missing-listening-attempt/);
  });
});

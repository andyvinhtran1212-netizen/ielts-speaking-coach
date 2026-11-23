// EXAMMOCK-0071 T001: pure helpers of the exam-room branch of the mock runner.
// FR-007 mockSubmitOutcome, FR-010 reconcileMockWritingCopy.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  legacyMockWritingKey, legacyRemovable, MOCK_SUBMIT_AUTO_RETRIES, mockSubmitOutcome, reconcileMockWritingCopy,
} from '../lib/mock-exam-model.mjs';

const T = '2026-11-23T10:45:00Z';
const state = ({ status = 'lrw_in_progress', submitted = {}, collected = null } = {}) => ({
  sitting: { id: 's-1', status, readingSubmittedAt: submitted.reading ?? null, listeningSubmittedAt: submitted.listening ?? null, writingSubmittedAt: submitted.writing ?? null },
  activeSection: 'reading',
  collectedSection: collected,
});

test('confirmed only with the server *SubmittedAt plus a secured final flush', () => {
  const done = state({ submitted: { reading: T } });
  assert.equal(mockSubmitOutcome({ state: done, section: 'reading', observed: true, finalFlushSecured: true }).outcome, 'confirmed');
  // Same server state, but the last flush did not report unsaved: 0 → closed, never "submitted".
  const closed = mockSubmitOutcome({ state: done, section: 'reading', observed: true, finalFlushSecured: false });
  assert.deepEqual([closed.outcome, closed.closedAt, closed.savedUpTo, closed.retry], ['closed_unconfirmed', T, null, false]);
  // The server's own save mark is shown only when the server sent one.
  assert.equal(mockSubmitOutcome({ state: done, section: 'reading', observed: true, finalFlushSecured: false, serverSavedUpTo: '10:42' }).savedUpTo, '10:42');
  // Another section's timestamp does not count.
  assert.equal(mockSubmitOutcome({ state: state({ submitted: { listening: T } }), section: 'reading', observed: true, finalFlushSecured: true }).outcome, 'submitting');
});

test('a flush-ack alone stays submitting; an ack then a failed domain submit is unconfirmed, never submitted', () => {
  const collected = state({ collected: 'reading' });
  assert.equal(mockSubmitOutcome({ state: collected, section: 'reading', observed: true, finalFlushSecured: true }).outcome, 'submitting');
  const failed = mockSubmitOutcome({ state: collected, section: 'reading', observed: true, finalFlushSecured: true, error: { status: 503 } });
  assert.deepEqual([failed.outcome, failed.retry], ['unconfirmed', true]);
});

test('3 automatic retries, then unconfirmed_manual', () => {
  assert.equal(MOCK_SUBMIT_AUTO_RETRIES, 3);
  const open = state();
  for (const retries of [0, 1, 2]) {
    assert.equal(mockSubmitOutcome({ state: open, section: 'writing', observed: true, finalFlushSecured: true, retries, error: { status: null } }).outcome, 'unconfirmed');
  }
  const manual = mockSubmitOutcome({ state: open, section: 'writing', observed: true, finalFlushSecured: true, retries: 3, error: { status: 0 } });
  assert.deepEqual([manual.outcome, manual.retry], ['unconfirmed_manual', false]);
});

test('sitting no longer live without the section timestamp: closed_unconfirmed with no invented time', () => {
  const m = mockSubmitOutcome({ state: state({ status: 'void' }), section: 'writing', observed: true, finalFlushSecured: true });
  assert.deepEqual([m.outcome, m.closedAt, m.savedUpTo], ['closed_unconfirmed', null, null]);
});

test('state not loaded yet or failed to load (null): never closed_unconfirmed; a 500 is retried', () => {
  // FR-007: closed only when the server reports the section closed.
  const pending = mockSubmitOutcome({ state: null, section: 'reading', observed: true, finalFlushSecured: true });
  assert.deepEqual([pending.outcome, pending.closedAt, pending.sectionSubmitted], ['submitting', null, false]);
  const failed = mockSubmitOutcome({ state: null, section: 'reading', observed: true, finalFlushSecured: true, error: { status: 500 } });
  assert.deepEqual([failed.outcome, failed.retry], ['unconfirmed', true]);
  const manual = mockSubmitOutcome({ state: null, section: 'reading', observed: true, finalFlushSecured: true, retries: 3, error: { status: 500 } });
  assert.equal(manual.outcome, 'unconfirmed_manual');
});

test('403/404 are denied without retry', () => {
  for (const status of [403, 404]) {
    const m = mockSubmitOutcome({ state: state(), section: 'reading', observed: true, finalFlushSecured: false, error: { status } });
    assert.deepEqual([m.outcome, m.retry], ['denied', false]);
  }
});

test('a section submitted before this tab opened shows only ✓ Submitted, never closed_unconfirmed', () => {
  const m = mockSubmitOutcome({ state: state({ submitted: { reading: T } }), section: 'reading', observed: false, finalFlushSecured: false });
  assert.deepEqual([m.outcome, m.sectionSubmitted], ['idle', true]);
});

const copy = (answers) => ({ v: 1, surface: 'mock', ownerKey: 'u-1', attemptKey: 's-1', savedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER, answers });

test('new copy compares by baseText (baseValue), never by time', () => {
  const plan = reconcileMockWritingCopy({
    copy: copy({ task1: { value: 'local one', baseValue: 'server one' }, task2: { value: 'local two', baseValue: 'old two', baseSavedAt: '2026-11-23T01:00:00Z' } }),
    legacy: {},
    server: { open: true, task1: 'server one', task2: 'edited elsewhere' },
    ownerMatches: true,
  });
  assert.deepEqual(plan.resend, [{ task: 'task1', value: 'local one' }]);
  assert.deepEqual(plan.keepServer, ['task2']);
  assert.deepEqual(plan.dropFromCopy, [{ q: 'task2', value: 'local two' }]);
  assert.equal(plan.clearCopy, false);
});

test('legacy key: equal → dropped; differs → ask and migrate, never written over the server', () => {
  const plan = reconcileMockWritingCopy({
    copy: null,
    legacy: { task1: { text: 'same' }, task2: { text: 'on this device' } },
    server: { open: true, task1: 'same', task2: 'saved' },
    ownerMatches: true,
  });
  assert.deepEqual(plan.dropLegacy, ['task1']);
  assert.deepEqual(plan.migrate, [{ q: 'task2', value: 'on this device' }]);
  assert.deepEqual(plan.ask, [{ task: 'task2', local: 'on this device', server: 'saved', source: 'legacy' }]);
  assert.deepEqual(plan.resend, []);
  assert.equal(legacyMockWritingKey('s-1', 'task2'), 'mock-writing:s-1:task2');
});

test('legacy key is kept until the new key reads back the same text or the server acks it', () => {
  assert.equal(legacyRemovable({ legacyText: 'x' }), false);
  assert.equal(legacyRemovable({ legacyText: 'x', readBack: 'x ' }), false);
  assert.equal(legacyRemovable({ legacyText: 'x', readBack: 'x' }), true);
  assert.equal(legacyRemovable({ legacyText: 'x', ackedText: 'x' }), true);
});

test('another owner: the legacy key is never read', () => {
  const plan = reconcileMockWritingCopy({
    copy: null, legacy: { task1: { text: 'theirs' } }, server: { open: true, task1: '' }, ownerMatches: false,
  });
  assert.deepEqual([plan.ask, plan.migrate, plan.dropLegacy], [[], [], []]);
});

test('a task with a new-key entry ignores its older legacy key; closed section clears everything', () => {
  const both = reconcileMockWritingCopy({
    copy: copy({ task1: { value: 'new', baseValue: '' } }), legacy: { task1: { text: 'older' } },
    server: { open: true, task1: '' }, ownerMatches: true,
  });
  assert.deepEqual([both.resend, both.dropLegacy, both.migrate], [[{ task: 'task1', value: 'new' }], ['task1'], []]);
  const closed = reconcileMockWritingCopy({
    copy: copy({ task1: { value: 'a', baseValue: '' } }), legacy: { task2: { text: 'b' } },
    server: { open: false, task1: 'x', task2: 'y' }, ownerMatches: true,
  });
  assert.deepEqual([closed.resend, closed.ask, closed.clearCopy, closed.dropLegacy], [[], [], true, ['task2']]);
});

test('an older copy entry without baseText asks instead of re-sending', () => {
  const plan = reconcileMockWritingCopy({
    copy: copy({ task2: { value: 'mine' } }), legacy: {}, server: { open: true, task2: 'saved' }, ownerMatches: true,
  });
  assert.deepEqual(plan.ask, [{ task: 'task2', local: 'mine', server: 'saved', source: 'copy' }]);
  assert.deepEqual(plan.resend, []);
});

test('no server text is "" in ask rows from the copy and from the legacy key alike', () => {
  const plan = reconcileMockWritingCopy({
    copy: copy({ task1: { value: 'mine' } }), legacy: { task2: { text: 'old draft' } },
    server: { open: true, task1: null }, ownerMatches: true,
  });
  assert.deepEqual(plan.ask, [
    { task: 'task1', local: 'mine', server: '', source: 'copy' },
    { task: 'task2', local: 'old draft', server: '', source: 'legacy' },
  ]);
});

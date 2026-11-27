// EXAMMOCK-0071 T001: pure helpers of the exam-room branch of the mock runner.
// FR-007 mockSubmitOutcome, FR-010 reconcileMockWritingCopy.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearLocalCopy, localCopyKey, planLocalCopyReplay, readLocalCopy, removeAckedFromCopy,
} from '../lib/exam-room/local-copy.mjs';
import { MemoryStorage } from './fixtures/exam-room-fakes.mjs';
import {
  holdBlockedMockSubmit, legacyMockWritingKey, legacyRemovable, MOCK_SUBMIT_AUTO_RETRIES, mockSubmitOutcome, reconcileMockWritingCopy,
  replayBlockedMockSubmit,
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

test('a different legacy text next to a new-key entry is kept, never dropped or migrated (FR-010)', () => {
  const both = reconcileMockWritingCopy({
    copy: copy({ task1: { value: 'new', baseValue: '' } }), legacy: { task1: { text: 'older' } },
    server: { open: true, task1: '' }, ownerMatches: true,
  });
  assert.deepEqual([both.resend, both.dropLegacy, both.migrate], [[{ task: 'task1', value: 'new' }], [], []]);
  // The same text in both keys: the legacy key is a duplicate and may go.
  const same = reconcileMockWritingCopy({
    copy: copy({ task1: { value: 'new', baseValue: '' } }), legacy: { task1: { text: 'new' } },
    server: { open: true, task1: '' }, ownerMatches: true,
  });
  assert.deepEqual([same.dropLegacy, same.migrate], [['task1'], []]);
});

test('a closed section clears the copy but keeps a legacy text the server does not hold (FR-010)', () => {
  const closed = reconcileMockWritingCopy({
    copy: copy({ task1: { value: 'a', baseValue: '' } }), legacy: { task2: { text: 'b' } },
    server: { open: false, task1: 'x', task2: 'y' }, ownerMatches: true,
  });
  assert.deepEqual([closed.resend, closed.ask, closed.clearCopy, closed.dropLegacy, closed.migrate], [[], [], true, [], []]);
  // The server holds exactly the legacy text: then it may go.
  const held = reconcileMockWritingCopy({
    copy: null, legacy: { task2: { text: 'y' } },
    server: { open: false, task1: 'x', task2: 'y' }, ownerMatches: true,
  });
  assert.deepEqual(held.dropLegacy, ['task2']);
});

test('a closed section keeps the legacy text when only the new key, which is being cleared, holds it (FR-010, HOLD on #2713)', () => {
  // Both device versions hold `y`, the server holds `x`: clearing the new key
  // must not also drop the legacy key, or nothing would hold `y` any more.
  const closed = reconcileMockWritingCopy({
    copy: copy({ task1: { value: 'y', baseValue: '' } }), legacy: { task1: { text: 'y' } },
    server: { open: false, task1: 'x' }, ownerMatches: true,
  });
  assert.deepEqual([closed.clearCopy, closed.dropLegacy, closed.migrate, closed.ask], [true, [], [], []]);
  // Still open, but replay chooses keepServer: neither device copy may go.
  const open = reconcileMockWritingCopy({
    copy: copy({ task1: { value: 'y', baseValue: '' } }), legacy: { task1: { text: 'y' } },
    server: { open: true, task1: 'x' }, ownerMatches: true,
  });
  assert.deepEqual([open.clearCopy, open.dropLegacy, open.dropFromCopy], [false, [], []]);
  // Open or closed, if the server holds exactly `y`, both may go.
  for (const serverOpen of [true, false]) {
    const held = reconcileMockWritingCopy({
      copy: copy({ task1: { value: 'y', baseValue: '' } }), legacy: { task1: { text: 'y' } },
      server: { open: serverOpen, task1: 'y' }, ownerMatches: true,
    });
    assert.deepEqual([held.clearCopy, held.dropLegacy, held.dropFromCopy], [!serverOpen, ['task1'], [{ q: 'task1', value: 'y' }]]);
  }
});

test('keepServer replay keeps both Writing storage keys when their text matches but the server differs (FR-010)', () => {
  for (const task of ['task1', 'task2']) {
    for (const baseValue of ['', 'b']) {
      const storage = new MemoryStorage();
      const local = copy({ [task]: { value: 'y', baseValue } });
      const scope = { surface: local.surface, ownerKey: local.ownerKey, attemptKey: local.attemptKey };
      const newKey = localCopyKey(scope);
      const oldKey = legacyMockWritingKey(scope.attemptKey, task);
      storage.setItem(newKey, JSON.stringify(local));
      storage.setItem(oldKey, 'y');
      const before = readLocalCopy(storage, scope);
      const replay = planLocalCopyReplay(before, { open: true, answers: { [task]: { value: 'x' } } });
      assert.deepEqual(replay.keepServer, [task]);
      assert.deepEqual(replay.drop, [{ q: task, value: 'y' }]);

      const plan = reconcileMockWritingCopy({
        copy: before, legacy: { [task]: { text: storage.getItem(oldKey) } },
        server: { open: true, [task]: 'x' }, ownerMatches: true,
      });
      assert.deepEqual([plan.keepServer, plan.resend, plan.migrate, plan.dropLegacy, plan.dropFromCopy], [[task], [], [], [], []]);
      // Apply the combined plan exactly as a storage consumer would.
      if (plan.clearCopy) clearLocalCopy(storage, scope);
      else removeAckedFromCopy(storage, { ...scope, entries: plan.dropFromCopy });
      for (const droppedTask of plan.dropLegacy) storage.removeItem(legacyMockWritingKey(scope.attemptKey, droppedTask));

      assert.notEqual(storage.getItem(newKey), null, 'the new copy key remains');
      assert.notEqual(storage.getItem(oldKey), null, 'the legacy key remains');
      assert.equal(storage.getItem(oldKey), 'y');
      assert.deepEqual(readLocalCopy(storage, scope).answers[task], { value: 'y', baseValue });
    }
  }
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

test('invigilator collection: tracked from the signal, final save fails, server closes → closed, never submitted', async () => {
  // HOLD #2551: the collection is a submit this tab saw from the moment the
  // signal arrives; while the final save keeps failing it reads `submitting`.
  const collecting = state({ collected: 'reading' });
  const during = mockSubmitOutcome({ state: collecting, section: 'reading', observed: true, finalFlushSecured: false });
  assert.equal(during.outcome, 'submitting');
  // The server then closes the section although the final save never got
  // through: closed with its time, not confirmed.
  const closedByServer = state({ submitted: { reading: T }, collected: 'reading' });
  const after = mockSubmitOutcome({ state: closedByServer, section: 'reading', observed: true, finalFlushSecured: false });
  assert.deepEqual([after.outcome, after.closedAt], ['closed_unconfirmed', T]);
  // Sitting closed with no section stamp: still closed, never confirmed.
  assert.equal(mockSubmitOutcome({ state: state({ status: 'lrw_submitted', collected: 'reading' }), section: 'reading', observed: true, finalFlushSecured: false }).outcome, 'closed_unconfirmed');

  // Runner wiring: the collection effect marks the section observed and starts
  // the track before its first flush attempt, not after the flush succeeds.
  const { readFileSync } = await import('node:fs');
  const runner = readFileSync(new URL('../app/(authed-mock-exam)/mock-exam/mock-exam-runner.tsx', import.meta.url), 'utf8');
  const effect = runner.slice(runner.indexOf('if (!collectionKey || !pendingCollectionSection || !awaitingCollectionFlush)'));
  const drainAt = effect.indexOf('const drain = async');
  assert.ok(drainAt > 0);
  const head = effect.slice(0, drainAt);
  assert.match(head, /observedSubmitRef\.current\.add\(pendingCollectionSection\)/);
  assert.match(head, /setSubmitTrack\(\{ section: pendingCollectionSection, retries: 0, error: null \}\)/);
  // A secured mark left by an earlier failed submit is cleared first (CR nit).
  assert.match(head, /flushSecuredRef\.current\.delete\(pendingCollectionSection\)/);
  assert.doesNotMatch(effect.slice(drainAt, effect.indexOf('void drain();')), /observedSubmitRef\.current\.add/);
});

test('FR-016: a link error still reads the flag once window.api is ready, with no request', async () => {
  const { readFileSync } = await import('node:fs');
  const runner = readFileSync(new URL('../app/(authed-mock-exam)/mock-exam/mock-exam-runner.tsx', import.meta.url), 'utf8');
  const start = runner.indexOf('if (!params.error) return undefined;');
  assert.ok(start > 0);
  const effect = runner.slice(start, runner.indexOf('}, [params.error]);', start));
  assert.match(effect, /whenGlobalReady\([\s\S]*examRoomEnabled\('mock'\)[\s\S]*setExamRoom\(on\)/);
  assert.doesNotMatch(effect, /window\.api\.(get|post)/);
});

test('write right lost between two submit attempts: the retry resumes at its own turn (FR-007, FR-013, HOLD on #2715)', () => {
  const live = state();
  // The first POST failed; retry 1 comes due while this tab is read-only.
  let held = holdBlockedMockSubmit(null, 'reading', 1);
  // The timer, a poll or an online event asks again at attempt 0: the turn is kept.
  held = holdBlockedMockSubmit(held, 'reading', 0);
  assert.deepEqual(held, { section: 'reading', attempt: 1 });
  // The write right comes back with nothing in flight: retry 1 runs, not a fresh attempt 0.
  assert.deepEqual(replayBlockedMockSubmit({ held, submitting: false, state: live }), { section: 'reading', attempt: 1 });
  // Never while another submit is in flight, and never once the server settled it.
  assert.equal(replayBlockedMockSubmit({ held, submitting: true, state: live }), null);
  assert.equal(replayBlockedMockSubmit({ held, submitting: false, state: state({ submitted: { reading: T } }) }), null);
  // A first submit refused before any POST is kept at attempt 0 (Codex P1).
  assert.deepEqual(replayBlockedMockSubmit({ held: holdBlockedMockSubmit(null, 'reading', 0), submitting: false, state: live }), { section: 'reading', attempt: 0 });
  // The last automatic retry keeps its turn too, so the limit is not reset.
  const last = holdBlockedMockSubmit(held, 'reading', MOCK_SUBMIT_AUTO_RETRIES);
  assert.equal(holdBlockedMockSubmit(last, 'reading', 0).attempt, MOCK_SUBMIT_AUTO_RETRIES);
});

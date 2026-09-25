import assert from 'node:assert/strict';
import test from 'node:test';

import { createProgrammeAnswerDraftStore, createProgrammeAnswerWriteQueue, createProgrammeSaveStatusTracker, programmeAnswerFlushEntries } from '../lib/listening-programme-answer-queue.mjs';

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('submit skips untouched questions but flushes a cleared answer in the same attempt', () => {
  const questions = [{ q_num: 1 }, { q_num: 2 }, { q_num: 3 }];
  assert.deepEqual(programmeAnswerFlushEntries(questions, {}), []);
  assert.deepEqual(programmeAnswerFlushEntries(questions, { 1: 'B', 3: '' }), [
    { qNum: 1, value: 'B' }, { qNum: 3, value: '' },
  ]);
  assert.deepEqual(programmeAnswerFlushEntries(questions, { 2: 'C', 99: 'stale' }), [
    { qNum: 2, value: 'C' },
  ]);
});

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test('restores a textarea draft before its debounce can fire', () => {
  const storage = memoryStorage();
  createProgrammeAnswerDraftStore(storage, 'attempt-1').remember(7, 'draft response');

  assert.deepEqual(createProgrammeAnswerDraftStore(storage, 'attempt-1').load(), {
    7: 'draft response',
  });
});

test('keeps an immediate checkbox draft until its delayed PATCH succeeds', async () => {
  const storage = memoryStorage();
  const drafts = createProgrammeAnswerDraftStore(storage, 'attempt-2');
  let release;
  const queue = createProgrammeAnswerWriteQueue(async (qNum, value) => {
    await new Promise((resolve) => { release = resolve; });
    drafts.clearIfCurrent(qNum, value);
  });

  drafts.remember(9, 'A, C');
  const saving = queue.enqueue(9, 'A, C');
  await tick();
  assert.deepEqual(createProgrammeAnswerDraftStore(storage, 'attempt-2').load(), { 9: 'A, C' });

  release();
  await saving;
  assert.deepEqual(drafts.load(), {});
});

test('an older PATCH completion cannot clear a newer local edit', () => {
  const storage = memoryStorage();
  const drafts = createProgrammeAnswerDraftStore(storage, 'attempt-3');
  drafts.remember(4, 'older');
  drafts.remember(4, 'newer');

  drafts.clearIfCurrent(4, 'older');
  assert.deepEqual(drafts.load(), { 4: 'newer' });
});

test('serializes one question and flushes the latest answer before submit', async () => {
  const calls = [];
  const releases = [];
  const queue = createProgrammeAnswerWriteQueue((qNum, value) => {
    calls.push({ qNum, value });
    return new Promise((resolve) => releases.push(resolve));
  });

  const first = queue.enqueue(1, 'A').catch(() => undefined);
  const second = queue.enqueue(1, 'B').catch(() => undefined);
  await tick();
  assert.deepEqual(calls, [{ qNum: 1, value: 'A' }], 'the delayed first PATCH must be the only active write');

  let flushed = false;
  const flush = queue.flush([{ qNum: 1, value: 'B' }]).then(() => { flushed = true; });
  releases[0]();
  await first;
  await tick();
  assert.deepEqual(calls, [{ qNum: 1, value: 'A' }, { qNum: 1, value: 'B' }]);
  assert.equal(flushed, false);

  releases[1]();
  await second;
  await tick();
  assert.deepEqual(calls, [
    { qNum: 1, value: 'A' },
    { qNum: 1, value: 'B' },
    { qNum: 1, value: 'B' },
  ], 'the submit flush must run after the older PATCHes and persist the visible value last');
  assert.equal(flushed, false, 'submit must remain blocked until its final PATCH resolves');

  releases[2]();
  await flush;
  assert.equal(flushed, true);
});

test('a failed autosave does not prevent the final flush retry', async () => {
  const calls = [];
  const queue = createProgrammeAnswerWriteQueue(async (_qNum, value) => {
    calls.push(value);
    if (value === 'old') throw new Error('transient');
  });

  await assert.rejects(queue.enqueue(2, 'old'), /transient/);
  await queue.flush([{ qNum: 2, value: 'latest' }]);
  assert.deepEqual(calls, ['old', 'latest']);
});

test('keeps one failed question visible after a later question saves first', () => {
  const tracker = createProgrammeSaveStatusTracker();
  const first = tracker.begin(1);
  const second = tracker.begin(2);

  assert.equal(second.status, 'saving');
  assert.equal(tracker.succeed(second.token), 'saving');
  assert.equal(tracker.fail(first.token), 'error');
  assert.equal(tracker.status(), 'error');
});

test('a successful final flush clears earlier per-question failures', () => {
  const tracker = createProgrammeSaveStatusTracker();
  const autosave = tracker.begin(1);
  assert.equal(tracker.fail(autosave.token), 'error');

  const flush = tracker.beginFlush();
  assert.equal(flush.status, 'saving');
  assert.equal(tracker.finishFlush(flush.token), 'saved');
});

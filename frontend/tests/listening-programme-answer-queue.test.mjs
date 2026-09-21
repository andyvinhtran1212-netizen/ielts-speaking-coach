import assert from 'node:assert/strict';
import test from 'node:test';

import { createProgrammeAnswerWriteQueue, createProgrammeSaveStatusTracker } from '../lib/listening-programme-answer-queue.mjs';

const tick = () => new Promise((resolve) => setImmediate(resolve));

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

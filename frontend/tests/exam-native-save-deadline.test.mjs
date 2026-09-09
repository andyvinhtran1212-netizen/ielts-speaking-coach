import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createListeningSaveCoordinator } from '../lib/listening-test-controller.mjs';
import { createReadingSaveCoordinator } from '../lib/reading-exam-controller.mjs';

const turn = () => new Promise((resolve) => setImmediate(resolve));
test('Reading question cards and inline hints both distinguish pending from failed', () => {
  const source = readFileSync(new URL('../app/(authed-reading-player)/reading/exam/session/reading-exam-session.tsx', import.meta.url), 'utf8');
  assert.match(source, /saveState === 'pending' \? 'Đang lưu…'/);
  assert.match(source, /state === 'pending' \? 'Đang lưu…'/);
});
for (const [name, create] of [['Listening', createListeningSaveCoordinator], ['Reading', createReadingSaveCoordinator]]) {
  test(`${name}: replacing a scheduled retry releases the older flush wait`, async () => {
    const c = create({ retryDelays: [10000], flushTimeoutMs: 10000, save: (_q, value) => {
      if (value === 'old') throw Object.assign(new Error('temporary'), { status: 500 });
      return Promise.resolve({ ok: true });
    } });
    try {
      c.update(1, 'old'); const oldFlush = c.flush(); await turn();
      assert.equal(c.snapshot().get(1), 'retrying');
      c.update(1, 'new'); assert.equal(await c.flush(), true);
      let completed = false; oldFlush.then(() => { completed = true; });
      await turn();
      assert.equal(completed, true);
    } finally { c.dispose(); }
  });

  test(`${name}: dirty immediately, hung transport aborts and flush returns not-clean`, async () => {
    let signal;
    const c = create({ requestTimeoutMs: 15, flushTimeoutMs: 200, retryDelays: [],
      save: (_q, _v, options) => { signal = options.signal; return new Promise(() => {}); } });
    c.update(1, 'answer');
    assert.equal(c.snapshot().get(1), 'pending');
    assert.equal(await c.flush(), false);
    assert.equal(signal.aborted, true);
    assert.equal(c.snapshot().get(1), 'failed');
    c.dispose();
  });

  test(`${name}: flush has its own deadline while a live save stays dirty`, async () => {
    let release;
    const c = create({ requestTimeoutMs: 1000, flushTimeoutMs: 10,
      save: () => new Promise((resolve) => { release = resolve; }) });
    c.update(1, 'answer');
    assert.equal(await c.flush(), false);
    assert.equal(c.snapshot().get(1), 'pending');
    release({ ok: true }); await turn();
    assert.equal(c.snapshot().size, 0);
    c.dispose();
  });

  test(`${name}: late ACK after timeout cannot erase a newer failed edit`, async () => {
    let release;
    let first = true;
    const c = create({ requestTimeoutMs: 10, retryDelays: [], save: () => {
      if (first) { first = false; return new Promise((resolve) => { release = resolve; }); }
      throw Object.assign(new Error('invalid'), { status: 422 });
    } });
    c.update(1, 'old'); assert.equal(await c.flush(), false);
    c.update(1, 'new'); assert.equal(await c.flush(), false);
    release({ ok: true }); await turn();
    assert.equal(c.snapshot().get(1), 'failed'); c.dispose();
  });

  test(`${name}: a newer debounced value is not dropped by flush during an older save`, async () => {
    const calls = []; let release;
    const c = create({ save: (_q, value) => {
      calls.push(value);
      return value === 'old' ? new Promise((resolve) => { release = resolve; }) : Promise.resolve({ ok: true });
    } });
    c.update(1, 'old'); const firstFlush = c.flush(); await turn();
    c.update(1, 'new'); const latestFlush = c.flush();
    release({ ok: true });
    await firstFlush; assert.equal(await latestFlush, true);
    assert.deepEqual(calls, ['old', 'new']); assert.equal(c.snapshot().size, 0); c.dispose();
  });

  test(`${name}: manual retry can recover after a bounded failure`, async () => {
    let recover = false;
    const c = create({ requestTimeoutMs: 10, retryDelays: [],
      save: () => recover ? Promise.resolve({ ok: true }) : new Promise(() => {}) });
    c.update(2, 'answer'); assert.equal(await c.flush(), false);
    recover = true; c.retryFailed(); await turn();
    assert.equal(c.snapshot().size, 0); c.dispose();
  });
}

test('Listening: one timed-out request cannot permanently starve subsequent questions', async () => {
  const calls = [];
  const c = createListeningSaveCoordinator({ requestTimeoutMs: 10, retryDelays: [],
    save: (q) => { calls.push(q); return q === 1 ? new Promise(() => {}) : Promise.resolve({ ok: true }); } });
  c.update(1, 'A'); c.update(2, 'B');
  assert.equal(await c.flush(), false);
  assert.deepEqual(calls, [1, 2]); assert.deepEqual([...c.snapshot()], [[1, 'failed']]); c.dispose();
});

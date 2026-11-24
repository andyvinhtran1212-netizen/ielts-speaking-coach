// EXAMROOM-0066 FR-017: one writing tab per attempt.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTabGuard, lockName, writerTokenKey } from '../lib/exam-room/tab-guard.mjs';
import { fakeBrowser, fakeTimers, flushMicrotasks, MemoryStorage } from './fixtures/exam-room-fakes.mjs';

function tab(browser, timers, extra = {}) {
  const log = [];
  const calls = { flush: 0, reload: 0 };
  const guard = createTabGuard({
    surface: 'reading', attemptKey: 'att-1', tabId: extra.tabId,
    flush: extra.flush ?? (async () => { calls.flush += 1; return { secured: true, unsaved: 0 }; }),
    onHandoverRefused: () => { calls.refused = (calls.refused ?? 0) + 1; },
    reloadFromServer: extra.reloadFromServer ?? (async () => { calls.reload += 1; }),
    onChange: (s) => log.push(s),
    locks: 'locks' in extra ? extra.locks : browser.locks,
    channelFactory: 'channelFactory' in extra ? extra.channelFactory : browser.channelFactory,
    storage: extra.storage ?? null,
    timers, now: timers.now,
  });
  return { guard, log, calls };
}

test('first tab writes after reloading; second tab is read-only and cannot write', async () => {
  const browser = fakeBrowser();
  const timers = fakeTimers();
  const a = tab(browser, timers);
  a.guard.start();
  await flushMicrotasks();
  assert.equal(a.guard.state, 'writer');
  assert.deepEqual(a.log, ['acquiring', 'writer']);
  assert.equal(a.calls.reload, 1);
  assert.equal(browser.locks.isHeld(lockName('reading', 'att-1')), true);
  const b = tab(browser, timers);
  b.guard.start();
  await flushMicrotasks();
  assert.equal(b.guard.state, 'read-only');
  assert.equal(b.guard.canWrite(), false);
  assert.equal(a.guard.canWrite(), true);
});

test('"Use this tab": old tab flushes, goes read-only, then releases; new tab writes after reload', async () => {
  const browser = fakeBrowser();
  const timers = fakeTimers();
  const order = [];
  const a = tab(browser, timers, { flush: async () => { order.push('a-flush'); await flushMicrotasks(2); order.push('a-flushed'); return { secured: true }; } });
  a.guard.start();
  await flushMicrotasks();
  const b = tab(browser, timers, { reloadFromServer: async () => { order.push(`b-reload(a=${a.guard.state})`); } });
  b.guard.start();
  await flushMicrotasks();
  b.guard.requestTakeover();
  await flushMicrotasks();
  await timers.advance(10);
  assert.equal(a.guard.state, 'read-only');
  assert.equal(b.guard.state, 'writer');
  assert.deepEqual(order, ['a-flush', 'a-flushed', 'b-reload(a=read-only)']);
  assert.ok(a.log.includes('releasing'));
  assert.equal(a.guard.canWrite(), false);
  assert.equal(b.guard.canWrite(), true);
});

test('no lock within 5 s: stays read-only (stuck); a late release does not make it write', async () => {
  const browser = fakeBrowser();
  const timers = fakeTimers();
  let releaseFlush;
  const a = tab(browser, timers, { flush: () => new Promise((r) => { releaseFlush = () => r({ secured: true }); }) });
  a.guard.start();
  await flushMicrotasks();
  const b = tab(browser, timers);
  b.guard.start();
  await flushMicrotasks();
  b.guard.requestTakeover();
  await flushMicrotasks();
  await timers.advance(5000);
  assert.equal(b.guard.state, 'stuck');
  assert.equal(b.guard.canWrite(), false);
  releaseFlush();
  await flushMicrotasks();
  await timers.advance(1000);
  assert.equal(b.guard.state, 'stuck');
  assert.equal(b.calls.reload, 0, 'never reloaded, never became the writer');
  b.guard.reload();
  await flushMicrotasks();
  assert.equal(b.guard.state, 'writer', 'Reload starts over and takes the now free lock');
});

test('reload failure after taking the lock releases it and reports stuck', async () => {
  const browser = fakeBrowser();
  const timers = fakeTimers();
  const a = tab(browser, timers, { reloadFromServer: async () => { throw new Error('network'); } });
  a.guard.start();
  await flushMicrotasks();
  assert.equal(a.guard.state, 'stuck');
  assert.equal(browser.locks.isHeld(lockName('reading', 'att-1')), false);
});

test('messages for another attempt are ignored', async () => {
  const browser = fakeBrowser();
  const timers = fakeTimers();
  const a = tab(browser, timers);
  a.guard.start();
  await flushMicrotasks();
  const other = createTabGuard({
    surface: 'reading', attemptKey: 'att-2', flush: async () => ({ secured: true }), reloadFromServer: async () => {},
    locks: browser.locks, channelFactory: browser.channelFactory, timers, now: timers.now,
  });
  other.start();
  await flushMicrotasks();
  assert.equal(other.state, 'writer');
  assert.equal(a.guard.state, 'writer');
});

test('fallback without Web Locks: writer token checked before each save', async () => {
  const browser = fakeBrowser();
  const timers = fakeTimers();
  const storage = new MemoryStorage();
  const a = tab(browser, timers, { locks: null, storage, tabId: 'A' });
  a.guard.start();
  await flushMicrotasks();
  assert.equal(a.guard.mode, 'token');
  assert.equal(a.guard.state, 'writer');
  const b = tab(browser, timers, { locks: null, storage, tabId: 'B' });
  b.guard.start();
  await flushMicrotasks();
  assert.equal(b.guard.state, 'read-only');
  b.guard.requestTakeover();
  await flushMicrotasks();
  await timers.advance(300);
  assert.equal(b.guard.state, 'writer');
  assert.equal(JSON.parse(storage.getItem(writerTokenKey('reading', 'att-1'))).tabId, 'B');
  assert.equal(a.guard.canWrite(), false);
  // Another tab overwrote the token behind B's back: B stops writing at its next check.
  storage.setItem(writerTokenKey('reading', 'att-1'), JSON.stringify({ tabId: 'C', at: timers.now() }));
  assert.equal(b.guard.canWrite(), false);
  assert.equal(b.guard.state, 'read-only');
});

test('fallback token: a stale writer (no heartbeat for 6 s) does not block a new tab', async () => {
  const browser = fakeBrowser();
  const timers = fakeTimers();
  const storage = new MemoryStorage();
  storage.setItem(writerTokenKey('reading', 'att-1'), JSON.stringify({ tabId: 'gone', at: 0 }));
  await timers.advance(7000);
  const a = tab(browser, timers, { locks: null, storage, tabId: 'A' });
  a.guard.start();
  await flushMicrotasks();
  assert.equal(a.guard.state, 'writer');
});

test('no Web Locks and no BroadcastChannel: guard off, the tab may write', async () => {
  const timers = fakeTimers();
  const a = tab({}, timers, { locks: null, channelFactory: null });
  a.guard.start();
  assert.equal(a.guard.state, 'unsupported');
  assert.equal(a.guard.canWrite(), true);
  const throwing = tab({}, timers, { locks: null, channelFactory: () => { throw new Error('no channel'); }, storage: new MemoryStorage() });
  throwing.guard.start();
  assert.equal(throwing.guard.canWrite(), true);
});

test('stop releases the lock so a waiting tab can take it', async () => {
  const browser = fakeBrowser();
  const timers = fakeTimers();
  const a = tab(browser, timers);
  a.guard.start();
  await flushMicrotasks();
  a.guard.stop();
  await flushMicrotasks();
  assert.equal(browser.locks.isHeld(lockName('reading', 'att-1')), false);
  const b = tab(browser, timers);
  b.guard.start();
  await flushMicrotasks();
  assert.equal(b.guard.state, 'writer');
});

test('the browser refusing the Web Lock ends read-only with the notice, never pending or writer', async () => {
  const timers = fakeTimers();
  const rejecting = { request: () => Promise.reject(Object.assign(new Error('denied'), { name: 'SecurityError' })) };
  const a = tab({}, timers, { locks: rejecting, channelFactory: null });
  a.guard.start();
  await flushMicrotasks();
  assert.equal(a.guard.state, 'stuck');
  assert.equal(a.guard.canWrite(), false);
  const throwing = { request: () => { throw new Error('SecurityError'); } };
  const b = tab({}, timers, { locks: throwing, channelFactory: null });
  b.guard.start();
  await flushMicrotasks();
  assert.equal(b.guard.state, 'stuck');
  assert.equal(b.guard.canWrite(), false);
  // A takeover whose lock request is refused also ends stuck, before the 5 s timer.
  const browser = fakeBrowser();
  const w = tab(browser, timers);
  w.guard.start();
  await flushMicrotasks();
  let calls = 0;
  const flaky = { request: (...args) => (calls++ === 0 ? browser.locks.request(...args) : Promise.reject(new Error('denied'))) };
  const r = tab(browser, timers, { locks: flaky });
  r.guard.start();
  await flushMicrotasks();
  assert.equal(r.guard.state, 'read-only');
  r.guard.requestTakeover();
  await flushMicrotasks();
  assert.equal(r.guard.state, 'stuck');
  assert.equal(r.guard.canWrite(), false);
});

test('a stopped guard never allows writing', async () => {
  const browser = fakeBrowser();
  const timers = fakeTimers();
  const a = tab(browser, timers);
  a.guard.start();
  await flushMicrotasks();
  assert.equal(a.guard.canWrite(), true);
  a.guard.stop();
  assert.equal(a.guard.canWrite(), false);
  const off = tab({}, timers, { locks: null, channelFactory: null });
  off.guard.start();
  assert.equal(off.guard.canWrite(), true);
  off.guard.stop();
  assert.equal(off.guard.canWrite(), false);
  const token = tab(browser, timers, { locks: null, storage: new MemoryStorage(), tabId: 'T' });
  token.guard.start();
  await flushMicrotasks();
  token.guard.stop();
  assert.equal(token.guard.canWrite(), false);
});

test('handover is refused when flush cannot secure the newest answers', async () => {
  for (const flush of [
    async () => ({ secured: false, unsaved: 1 }), // server save and local copy both failed
    async () => { throw new Error('flush failed'); },
    async () => undefined, // a flush that does not say it secured anything
  ]) {
    const browser = fakeBrowser();
    const timers = fakeTimers();
    const a = tab(browser, timers, { flush });
    a.guard.start();
    await flushMicrotasks();
    const b = tab(browser, timers);
    b.guard.start();
    await flushMicrotasks();
    b.guard.requestTakeover();
    await flushMicrotasks();
    await timers.advance(10);
    assert.equal(a.guard.state, 'writer', 'old tab keeps the right');
    assert.equal(a.guard.canWrite(), true);
    assert.equal(a.calls.refused, 1, 'old tab is told so it can show the error');
    assert.equal(browser.locks.isHeld(lockName('reading', 'att-1')), true);
    assert.equal(b.guard.state, 'stuck', 'new tab stays read-only');
    assert.equal(b.guard.canWrite(), false);
    assert.equal(b.calls.reload, 0);
    await timers.advance(6000);
    assert.equal(b.guard.state, 'stuck');
  }
});

test('saves of the flush itself are allowed while releasing', async () => {
  const browser = fakeBrowser();
  const timers = fakeTimers();
  let duringFlush = null;
  const holder = {};
  holder.a = tab(browser, timers, { flush: async () => { duringFlush = holder.a.guard.canWrite(); return { secured: true }; } });
  holder.a.guard.start();
  await flushMicrotasks();
  const b = tab(browser, timers);
  b.guard.start();
  await flushMicrotasks();
  b.guard.requestTakeover();
  await flushMicrotasks();
  await timers.advance(10);
  assert.equal(duringFlush, true);
  assert.equal(holder.a.guard.canWrite(), false);
  assert.equal(b.guard.state, 'writer');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAttemptFlagCoordinator } from '../lib/attempt-review-flags.mjs';

const turn = () => new Promise((resolve) => setImmediate(resolve));
const row = (q_num, flagged = false, revision = 0) => ({ q_num, question_id: `question-${q_num}`, flagged, revision, updated_at: null });
function harness(options = {}) {
  const server = new Map([[1, row(1)], [2, row(2)]]);
  const requests = [];
  let id = 0;
  const scope = { attempt_id: 'attempt-a', protocol: 'question-cas-v1' };
  const apply = (body) => {
    const previous = server.get(body.q_num);
    if (previous.operation_id === body.operation_id) return { ...scope, ...previous, accepted: true, reason: 'replayed' };
    if (previous.revision !== body.expected_revision) return { ...scope, ...previous, accepted: false, reason: 'conflict' };
    const next = { ...previous, flagged: body.flagged, revision: previous.revision + 1, operation_id: body.operation_id };
    server.set(body.q_num, next);
    return { ...scope, ...next, accepted: true, reason: 'applied' };
  };
  const c = createAttemptFlagCoordinator({
    attemptId: scope.attempt_id, debounceMs: 10000,
    makeOperationId: () => `operation-${++id}`,
    read: async () => ({ ...scope, review_flags: [...server.values()] }),
    write: async (body) => { requests.push(body); return apply(body); },
    ...options,
  });
  return { c, server, requests, apply, scope };
}
test('reload restores flagged and explicitly unflagged canonical rows without answer writes', async () => {
  const { c, server, requests } = harness();
  server.set(1, row(1, true, 3)); server.set(2, row(2, false, 4));
  await c.load(); assert.deepEqual([...c.snapshot().flagged], [1]);
  c.update(1, false); assert.equal(c.snapshot().states.get(1), 'pending');
  assert.equal(await c.flush(), true); assert.equal(server.get(1).flagged, false);
  await c.load(); assert.equal(c.snapshot().flagged.size, 0);
  assert.deepEqual(Object.keys(requests[0]).sort(), ['expected_revision', 'flagged', 'operation_id', 'q_num']);
  c.dispose();
});
test('latest rapid toggle survives older acknowledgement and uses its new revision', async () => {
  let release; let count = 0; let h;
  h = harness({ write: (body) => { h.requests.push(body); if (++count === 1) return new Promise((resolve) => { release = () => resolve(h.apply(body)); }); return Promise.resolve(h.apply(body)); } });
  await h.c.load(); h.c.update(1, true); const old = h.c.flush(); await turn();
  h.c.update(1, false); const latest = h.c.flush();
  release(); await old; assert.equal(await latest, true);
  assert.equal(h.server.get(1).flagged, false); assert.equal(h.requests[1].expected_revision, 1);
  assert.equal(h.c.snapshot().states.size, 0); h.c.dispose();
});
test('lost acknowledgement retries exactly the same operation UUID', async () => {
  let count = 0; let h;
  h = harness({ write: async (body) => {
    h.requests.push(body); const reply = h.apply(body);
    if (++count === 1) throw Object.assign(new Error('lost ack'), { status: 503 });
    return reply;
  } });
  await h.c.load(); h.c.update(1, true); assert.equal(await h.c.flush(), false);
  assert.equal(h.c.snapshot().states.get(1), 'failed');
  h.c.retryFailed(); await turn();
  assert.deepEqual(h.requests[0], h.requests[1]); assert.equal(h.server.get(1).revision, 1);
  assert.equal(h.c.snapshot().states.size, 0); h.c.dispose();
});
test('conflicting remote write stays visible as failed until explicit retry of latest intent', async () => {
  const h = harness(); await h.c.load(); h.c.update(1, true);
  h.server.set(1, { ...row(1, false, 8), operation_id: 'other-client-operation' });
  assert.equal(await h.c.flush(), false);
  assert.equal(h.c.snapshot().flagged.has(1), true);
  assert.equal(h.c.snapshot().canonical.get(1).revision, 8);
  assert.equal(h.requests.length, 1);
  h.c.retryFailed(); await turn();
  assert.equal(h.requests[1].expected_revision, 8);
  assert.notEqual(h.requests[0].operation_id, h.requests[1].operation_id);
  assert.equal(h.server.get(1).flagged, true); h.c.dispose();
});
test('an accepted receipt for another operation cannot acknowledge this mutation', async () => {
  const h = harness({ write: async () => ({ attempt_id: 'attempt-a', protocol: 'question-cas-v1',
    ...row(1, true, 1), operation_id: 'other-client-operation', accepted: true, reason: 'applied' }) });
  await h.c.load(); h.c.update(1, true);
  assert.equal(await h.c.flush(), false);
  assert.equal(h.c.snapshot().canonical.get(1).revision, 0);
  assert.equal(h.c.snapshot().states.get(1), 'failed');
  h.c.dispose();
});
test('late owner-scoped read after dispose cannot restore flags into a new attempt', async () => {
  let release;
  const h = harness({ read: () => new Promise((resolve) => { release = resolve; }) });
  const pending = h.c.load(); h.c.dispose();
  release({ ...h.scope, review_flags: [row(1, true, 9)] });
  assert.equal(await pending, false); assert.equal(h.c.snapshot().flagged.size, 0);
});
test('cross-attempt acknowledgement and malformed duplicate reads cannot become saved flags', async () => {
  const h = harness({ write: async (body) => ({ ...h.scope, ...row(1, true, 1), ...body, revision: 1, accepted: true, attempt_id: 'someone-else' }) });
  await h.c.load(); h.c.update(1, true); assert.equal(await h.c.flush(), false);
  assert.equal(h.c.snapshot().canonical.get(1).revision, 0); h.c.dispose();
  const bad = harness({ read: async () => ({ attempt_id: 'attempt-a', protocol: 'question-cas-v1', review_flags: [row(1), row(1, true, 1)] }) });
  await assert.rejects(bad.c.load()); assert.equal(bad.c.snapshot().ready, false); bad.c.dispose();
});
test('reload retains an unacknowledged operation and explicit retry obtains its canonical replay', async () => {
  let count = 0; let h;
  h = harness({ makeOperationId: () => '11111111-1111-4111-8111-111111111111', write: async (body) => {
    h.requests.push(body); const reply = h.apply(body);
    if (++count === 1) throw Object.assign(new Error('lost ack'), { status: 503 });
    return reply;
  } });
  await h.c.load(); h.c.update(1, true); assert.equal(await h.c.flush(), false);
  const receipts = h.c.snapshot().pending; assert.equal(receipts[0].sent, true); h.c.dispose();
  const reloaded = createAttemptFlagCoordinator({ attemptId: 'attempt-a', debounceMs: 10000,
    restoredPending: receipts, read: async () => ({ ...h.scope, review_flags: [...h.server.values()] }),
    write: async (body) => { h.requests.push(body); return h.apply(body); },
  });
  await reloaded.load(); assert.equal(reloaded.snapshot().states.get(1), 'failed');
  assert.equal(h.requests.length, 1); reloaded.retryFailed(); await turn();
  assert.deepEqual(h.requests[1], h.requests[0]); assert.equal(h.server.get(1).revision, 1);
  assert.equal(reloaded.snapshot().states.size, 0); reloaded.dispose();
});
test('an unsent latest toggle survives reload after an older toggle was saved', async () => {
  const h = harness(); h.server.set(1, row(1, true, 1));
  const c = createAttemptFlagCoordinator({ attemptId: 'attempt-a', debounceMs: 10000,
    restoredPending: [{ q_num: 1, flagged: false, expected_revision: 0, operation_id: '22222222-2222-4222-8222-222222222222', sent: false }],
    read: async () => ({ ...h.scope, review_flags: [...h.server.values()] }), write: async (body) => h.apply(body),
  });
  await c.load(); assert.equal(c.snapshot().flagged.has(1), false); assert.equal(c.snapshot().states.get(1), 'failed');
  c.retryFailed(); await turn(); assert.equal(h.server.get(1).flagged, false); assert.equal(c.snapshot().states.size, 0);
  c.dispose(); h.c.dispose();
});

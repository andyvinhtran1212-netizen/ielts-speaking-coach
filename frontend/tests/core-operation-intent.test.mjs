import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { anonymousReadingScope, coreInputDigest, createCoreOperationTransport, clearCoreOperationIntents, coreOperationHeaders } from '../lib/core-operation-intent.mjs';

const HEADER = 'X-Core-Operation-ID';
const accountId = randomUUID();
const base = { accountId, method: 'PATCH', path: '/api/reading/test/attempts/a/answers', slot: '1',
  input: { q_num: 1, user_answer: 'a learner answer' }, acknowledged: value => value?.ok === true };
function storage() {
  const rows = new Map();
  return { rows, get length() { return rows.size; }, key: i => [...rows.keys()][i],
    getItem: key => rows.get(key) ?? null, setItem: (key, value) => rows.set(key, String(value)), removeItem: key => rows.delete(key) };
}
function transport(store, extra = {}) {
  return createCoreOperationTransport({ getStorage: () => store, enabled: () => true, ...extra });
}

test('synchronous SHA-256 agrees with independent crypto implementation', () => {
  const values = ['', 'abc', 'Tiếng Việt 🎧', '\ud800', 'a'.repeat(262144), ...[1, 55, 56, 63, 64, 65, 119, 120, 1024].map(n => 'x'.repeat(n))];
  for (let i = 0; i < 64; i++) values.push(randomBytes(i * 13).toString('base64'));
  for (const value of values) assert.equal(coreInputDigest(value), createHash('sha256').update(value).digest('hex'));
  assert.throws(() => coreInputDigest('a'.repeat(262145)));
});

test('stores only versioned identifiers/fingerprint before synchronous send; pending reload reuses hint', async () => {
  const store = storage(), calls = [];
  let invoked = false;
  const error = new Error('lost acknowledgement');
  const first = transport(store)(base, headers => {
    invoked = true; calls.push(headers);
    assert.equal(store.length, 1);
    assert.ok(!JSON.stringify([...store.rows]).includes('a learner answer'));
    assert.ok(!JSON.stringify([...store.rows]).includes(base.path));
    return Promise.reject(error);
  });
  assert.equal(invoked, true, 'no await before send: pagehide fetch must already exist');
  await assert.rejects(first, e => e === error);
  const ack = { ok: true };
  assert.equal(await transport(store)(base, headers => { calls.push(headers); return Promise.resolve(ack); }), ack);
  assert.equal(calls[0][HEADER], calls[1][HEADER]);
  await transport(store)(base, headers => { calls.push(headers); return Promise.resolve(ack); });
  assert.notEqual(calls[2][HEADER], calls[1][HEADER], 'acknowledged next action has a new hint');
});

test('object key order is stable; changed answers, deliberate restart, account, path, method and question slots are distinct', async () => {
  const store = storage(), run = transport(store), ids = [];
  const send = headers => { ids.push(headers[HEADER]); return Promise.resolve(null); };
  await run(base, send);
  await run({ ...base, input: { user_answer: 'a learner answer', q_num: 1 } }, send);
  assert.equal(ids[0], ids[1]);
  for (const patch of [{ input: { q_num: 1, user_answer: 'different' } }, { fresh: true }, { accountId: randomUUID() },
    { path: '/different' }, { method: 'POST' }, { slot: '2' }]) await run({ ...base, ...patch }, send);
  assert.equal(new Set(ids.slice(1)).size, ids.length - 1);
});

test('same pending payload is not coalesced; late old ACK cannot erase newer input', async () => {
  const store = storage(), run = transport(store);
  let release;
  const ids = [];
  const first = run(base, headers => { ids.push(headers[HEADER]); return new Promise(resolve => { release = resolve; }); });
  await run(base, headers => { ids.push(headers[HEADER]); return Promise.resolve(null); });
  assert.equal(ids[0], ids[1]);
  const changed = { ...base, input: { q_num: 1, user_answer: 'new' } };
  await run(changed, headers => { ids.push(headers[HEADER]); return Promise.resolve(null); });
  release({ ok: true }); await first;
  await transport(store)(changed, headers => { ids.push(headers[HEADER]); return null; });
  assert.equal(ids[2], ids[3]);
  assert.notEqual(ids[0], ids[2]);
});

test('malformed response/throwing validator keeps pending, without replacing learner result', async () => {
  const store = storage(), ids = [];
  const run = transport(store);
  await run(base, h => { ids.push(h[HEADER]); return Promise.resolve({ ok: false }); });
  const result = { ok: true };
  assert.equal(await run({ ...base, acknowledged: () => { throw Error('bad response'); } }, h => { ids.push(h[HEADER]); return result; }), result);
  assert.equal(ids[0], ids[1]);
});

test('optional metadata cannot replace synchronous errors, rejected promises or cancelled requests', async () => {
  const run = transport(storage());
  const sync = new Error('sync original');
  assert.throws(() => run(base, () => { throw sync; }), e => e === sync);
  const cancelled = new DOMException('cancel', 'AbortError');
  await assert.rejects(run(base, () => Promise.reject(cancelled)), e => e === cancelled);
});

test('flag off bypasses storage/hash/crypto and returns original promise', () => {
  const run = createCoreOperationTransport({ enabled: () => false, getStorage: () => assert.fail(), mintId: () => assert.fail() });
  const promise = Promise.resolve('ok');
  assert.equal(run({ ...base, input: new FormData() }, h => { assert.deepEqual(h, {}); return promise; }), promise);
});

test('missing owner, denied storage, failed writes and invalid crypto omit hint but still send once', async () => {
  const denied = () => { throw Error('denied'); };
  for (const [patch, options] of [
    [{ accountId: null }, {}], [{ accountId: 'anonymous capability' }, {}], [{}, { getStorage: denied }],
    [{}, { getStorage: () => ({ getItem: denied }) }], [{}, { getStorage: () => ({ getItem: () => null, setItem: denied }) }],
    [{}, { mintId: () => 'not-a-uuid' }], [{ input: new FormData() }, {}], [{ input: { n: Infinity } }, {}],
    [{ input: 'x'.repeat(262145) }, {}],
  ]) {
    let calls = 0;
    const answer = { ok: true };
    const run = transport(storage(), options);
    assert.equal(await run({ ...base, ...patch }, headers => { calls++; assert.deepEqual(headers, {}); return answer; }), answer);
    assert.equal(calls, 1);
  }
});

test('corrupt storage is replaced; acknowledge-storage failure cannot fail a saved answer', async () => {
  const store = storage(), run = transport(store);
  let id;
  await run(base, h => { id = h[HEADER]; return null; });
  store.setItem([...store.rows.keys()][0], '{broken');
  const saved = { ok: true };
  assert.equal(await run(base, h => {
    assert.notEqual(h[HEADER], id);
    store.setItem = () => { throw new Error('quota'); };
    return Promise.resolve(saved);
  }), saved);
});

test('auth cleanup preserves current account only and never touches unrelated storage', async () => {
  const store = storage(), run = transport(store), other = randomUUID();
  await run(base, () => null); await run({ ...base, accountId: other }, () => null);
  store.setItem('unrelated', 'preserve');
  clearCoreOperationIntents(store, other);
  assert.equal(store.length, 2);
  assert.ok([...store.rows.keys()].some(key => key.includes(other)));
  clearCoreOperationIntents(store);
  assert.deepEqual([...store.rows], [['unrelated', 'preserve']]);
});

test('cleared auth receipts cannot be resurrected by a late acknowledgement', async () => {
  const store = storage(); let release;
  const pending = transport(store)(base, () => new Promise(resolve => { release = resolve; }));
  clearCoreOperationIntents(store); release({ ok: true }); await pending;
  assert.equal(store.length, 0);
});

test('existing canonical request IDs are forwarded only under strict opt-in', () => {
  const previous = globalThis.window;
  try {
    for (const enabled of [undefined, false, 'true', 1]) {
      globalThis.window = { __AVER_RUNTIME_CONFIG__: { coreOperationCorrelationEnabled: enabled } };
      assert.deepEqual(coreOperationHeaders(accountId), {});
    }
    globalThis.window = { __AVER_RUNTIME_CONFIG__: { coreOperationCorrelationEnabled: true } };
    assert.deepEqual(coreOperationHeaders(accountId), { [HEADER]: accountId });
    assert.deepEqual(coreOperationHeaders('invalid'), {});
  } finally { globalThis.window = previous; }
});

test('anonymous scope never persists a capability, aliases a user, or clears on unrelated account transitions', async () => {
  const previous = globalThis.window;
  globalThis.window = { __AVER_RUNTIME_CONFIG__: { coreOperationCorrelationEnabled: true } };
  try {
    const capability = 'a'.repeat(32), shareToken = 'synthetic-share-token';
    const scope = anonymousReadingScope({ capability, shareToken });
    assert.match(scope, /^[0-9a-f]{64}$/);
    assert.equal(anonymousReadingScope({ shareToken }), null, 'save without capability must remain uncorrelated');
    assert.notEqual(anonymousReadingScope({ shareToken, starting: true }), scope);
    assert.notEqual(anonymousReadingScope({ capability: 'b'.repeat(32), shareToken }), scope);
    assert.equal(anonymousReadingScope({ capability: 'historical-invalid-shape', shareToken, starting: true }), null);
    const store = storage(), run = transport(store), ids = [];
    const input = { ...base, accountId: null, anonymousScope: scope };
    await run(input, h => { ids.push(h[HEADER]); return null; });
    clearCoreOperationIntents(store, accountId); // Supabase refresh unrelated to share ownership
    clearCoreOperationIntents(store); // signed-out on the shared route's reload
    await transport(store)(input, h => { ids.push(h[HEADER]); return null; });
    assert.equal(ids[0], ids[1]);
    assert.ok(!JSON.stringify([...store.rows]).includes(capability));
    assert.ok(!JSON.stringify([...store.rows]).includes(shareToken));
    await run({ ...input, accountId }, h => { assert.deepEqual(h, {}); return null; });
  } finally { globalThis.window = previous; }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSpeakingStartController, clearSpeakingStartIntents, speakingStartId } from '../lib/speaking-start-intent.mjs';

const OWNER = randomUUID();
function storage() {
  const rows = new Map();
  return { rows, get length() { return rows.size; }, key: index => [...rows.keys()][index],
    getItem: key => rows.get(key) ?? null, setItem: (key, value) => rows.set(key, value), removeItem: key => rows.delete(key) };
}
function setup(options = {}) {
  const store = options.store || storage();
  const calls = [];
  const post = options.post || (async (path, body) => {
    calls.push({ path, body });
    return { session_id: body.client_session_id };
  });
  return { store, calls, controller: createSpeakingStartController({ getAccountId: async () => OWNER,
    getStorage: () => store, post, mintId: randomUUID, ...options }) };
}
const topic = (title = 'Library') => ({ slot: 'topic', intent: { mode: 'practice', part: 1, topic: title },
  prepare: async () => ({ body: { mode: 'practice', part: 1, topic: title } }) });

test('persists before POST and a later acknowledged start is a new intent', async () => {
  const store = storage();
  const ids = [];
  const { controller } = setup({ store, post: async (path, body) => {
    const receipt = JSON.parse([...store.rows.values()][0]);
    assert.equal(receipt.requestId, body.client_session_id);
    ids.push(body.client_session_id);
    return { session_id: body.client_session_id };
  } });
  await controller.start(topic());
  assert.equal(store.length, 0);
  await controller.start(topic());
  assert.notEqual(ids[0], ids[1]);
});

test('lost response + reload retries exactly the same session UUID and payload', async () => {
  const store = storage();
  const bodies = [];
  let posts = 0;
  const post = async (path, body) => {
    bodies.push(body);
    if (++posts === 1) throw new Error('response-lost-after-commit');
    return { id: body.client_session_id };
  };
  await assert.rejects(setup({ store, post }).controller.start(topic()));
  assert.equal(store.length, 1);
  await setup({ store, post }).controller.start({ ...topic(), prepare: () => assert.fail('must reuse prepared request') });
  assert.deepEqual(bodies[0], bodies[1]);
  assert.equal(store.length, 0);
});

test('custom-question retry does not regenerate content or consume another session', async () => {
  const store = storage();
  const calls = [];
  let fail = true;
  const post = async (path, body) => {
    calls.push({ path, body });
    if (path.endsWith('/custom')) {
      if (fail) { fail = false; throw new Error('question-response-lost'); }
      return [{ question_text: 'Original question?' }];
    }
    return { session_id: body.client_session_id };
  };
  const intent = { slot: 'custom', intent: { raw: 'Original question?', part: 1 }, prepare: async () => ({
    body: { mode: 'practice', part: 1, topic: 'Custom questions' }, questions: ['Original question?'],
  }) };
  await assert.rejects(setup({ store, post }).controller.start(intent));
  await setup({ store, post }).controller.start({ ...intent, prepare: () => assert.fail('must not regenerate') });
  assert.deepEqual(calls.slice(0, 2), calls.slice(2));
});

test('full-test retries preserve resolved random topics and Part 2 topic', async () => {
  const store = storage();
  const intent = { slot: 'full', intent: ['', '', '', ''], prepare: async () => ({
    body: { mode: 'test_full', part: 1, topic: 'A|||B|||C' }, nextPartTopic: 'D',
  }) };
  await assert.rejects(setup({ store, post: async () => { throw new Error('network'); } }).controller.start(intent));
  const retry = setup({ store });
  const result = await retry.controller.start({ ...intent, prepare: () => assert.fail('must not draw topics again') });
  assert.equal(result.nextPartTopic, 'D');
  assert.equal(retry.calls[0].body.topic, 'A|||B|||C');
});

test('changed input creates a distinct intent after a failed attempt', async () => {
  const store = storage();
  await assert.rejects(setup({ store, post: async () => { throw new Error('network'); } }).controller.start(topic('A')));
  const old = JSON.parse([...store.rows.values()][0]).requestId;
  const next = setup({ store });
  await next.controller.start(topic('B'));
  assert.notEqual(next.calls[0].body.client_session_id, old);
  assert.equal(next.calls[0].body.topic, 'B');
});

test('concurrent identical clicks share one create; conflicting clicks do not overwrite it', async () => {
  let finish;
  const started = new Promise(resolve => { finish = resolve; });
  const calls = [];
  const { controller } = setup({ post: async (path, body) => {
    calls.push(body); await started; return { session_id: body.client_session_id };
  } });
  const first = controller.start(topic());
  const second = controller.start(topic());
  await assert.rejects(controller.start(topic('Different')), /đang được chuẩn bị/);
  finish();
  assert.deepEqual(await first, await second);
  assert.equal(calls.length, 1);
});

test('storage failure prevents POST instead of silently degrading to duplicate-prone retries', async () => {
  const store = storage(); store.setItem = () => { throw new Error('quota'); };
  const { controller, calls } = setup({ store });
  await assert.rejects(controller.start(topic()), /quyền lưu trữ/);
  assert.equal(calls.length, 0);
});

test('storage readback failure also prevents POST', async () => {
  const store = storage(); store.setItem = () => {};
  const { controller, calls } = setup({ store });
  await assert.rejects(controller.start(topic()), /quyền lưu trữ/);
  assert.equal(calls.length, 0);
});

test('timeout aborts request and keeps retry identity', async () => {
  let signal;
  const { controller, store } = setup({ timeoutMs: 10, post: async (path, body, owner, s) => {
    signal = s; return new Promise(() => {});
  } });
  await assert.rejects(controller.start(topic()), /cùng lượt/);
  assert.equal(signal.aborted, true);
  assert.equal(store.length, 1);
});

test('account changes cannot continue custom writes or clear prior-account receipt', async () => {
  let account = OWNER;
  const { controller, store } = setup({ getAccountId: async () => account, post: async (path, body) => {
    account = randomUUID(); return { session_id: body.client_session_id };
  } });
  await assert.rejects(controller.start({ ...topic(), prepare: async () => ({
    body: { mode: 'practice', part: 1, topic: 'Library' }, questions: ['Question?'],
  }) }), /đăng nhập đã thay đổi/);
  assert.equal(store.length, 1);
});

test('wrong server UUID is not acknowledged or discarded', async () => {
  const { controller, store } = setup({ post: async () => ({ session_id: randomUUID() }) });
  await assert.rejects(controller.start(topic()), /đúng lượt/);
  assert.equal(store.length, 1);
});

test('logout cleanup removes only this feature’s tab receipts', () => {
  const store = storage();
  store.setItem('aver:speaking-start:v1:a:topic', 'private');
  store.setItem('unrelated', 'keep');
  clearSpeakingStartIntents(store);
  assert.deepEqual([...store.rows], [['unrelated', 'keep']]);
});

test('Safari crypto fallback produces a correctly versioned secure UUID', () => {
  let requested = false;
  const id = speakingStartId({ getRandomValues(bytes) { requested = true; bytes.fill(255); } });
  assert.equal(requested, true);
  assert.match(id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
});

test('prepared cue cards are allowlisted snapshots, not mutable caller objects', async () => {
  const original = { type: 'cue_card', prompt: 'Describe a library', bullets: ['where'], secret: 'discard' };
  const { controller, store } = setup({ post: async (path, body) => {
    if (path === '/sessions') {
      original.prompt = 'Changed'; original.bullets.push('changed');
      assert.ok(![...store.rows.values()][0].includes('discard'));
      return { id: body.client_session_id };
    }
    assert.deepEqual(body.questions, [{ type: 'cue_card', prompt: 'Describe a library', topic: '', bullets: ['where'] }]);
    return [];
  } });
  await controller.start({ ...topic(), prepare: async () => ({
    body: { mode: 'practice', part: 2, topic: 'Custom questions' }, questions: [original],
  }) });
});

test('invalid question shape fails before session creation', async () => {
  const { controller, calls } = setup();
  await assert.rejects(controller.start({ ...topic(), prepare: async () => ({
    body: { mode: 'practice', part: 2, topic: 'Custom questions' }, questions: [{ type: 'cue_card', prompt: 'Describe', bullets: [null] }],
  }) }), /câu hỏi hợp lệ/);
  assert.equal(calls.length, 0);
});

test('browser quota exhaustion explains the remedy and does not create a session', async () => {
  const store = storage();
  store.setItem = () => { throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); };
  const { controller, calls } = setup({ store });
  await assert.rejects(controller.start(topic('Vietnamese ế'.repeat(10000))), /Bộ nhớ tab không đủ/);
  assert.equal(calls.length, 0);
  assert.equal(store.length, 0);
});

test('large custom sets are not rejected by an arbitrary application byte cap', async () => {
  const { controller, calls } = setup();
  await controller.start(topic('Vietnamese ế'.repeat(10000)));
  assert.equal(calls.length, 1);
});

test('corrupted receipts require explicit discard, then the same input can start again', async () => {
  for (const raw of ['{', '', JSON.stringify({ version: 0 }), JSON.stringify({ version: 1,
    accountId: OWNER, slot: 'topic', requestId: randomUUID(), intentKey: '{}', prepared: { body: { mode: 'practice', part: 9, topic: 'Library' } } })]) {
    const { controller, store, calls } = setup();
    const key = `aver:speaking-start:v1:${OWNER}:topic`;
    store.setItem(key, raw);
    await assert.rejects(controller.start(topic()), error => error.canDiscardStart === true && /lịch sử/.test(error.message));
    assert.equal(store.getItem(key), raw);
    assert.equal(calls.length, 0);
    await controller.discard('topic');
    assert.equal(calls.length, 0, 'discard never issues a server mutation');
    await controller.start(topic());
    assert.equal(calls.length, 1);
  }
});

test('post-ack cleanup failure does not block entry or silently create a duplicate', async () => {
  const store = storage();
  store.removeItem = () => { throw new Error('storage revoked'); };
  const { controller, calls } = setup({ store });
  const first = await controller.start(topic());
  const replay = await setup({ store }).controller.start(topic());
  assert.equal(first.sessionId, calls[0].body.client_session_id);
  assert.equal(replay.sessionId, first.sessionId);
  assert.equal(store.length, 1);
});

test('expired custom save offers explicit restart without discarding the canonical receipt', async () => {
  const { controller, store } = setup({ post: async (path, body) => {
    if (path.endsWith('/custom')) throw Object.assign(new Error('expired'), { status: 410 });
    return { id: body.client_session_id };
  } });
  await assert.rejects(controller.start({ slot: 'custom', intent: 'custom', prepare: async () => ({
    body: { mode: 'practice', part: 1, topic: 'Custom questions' }, questions: ['Question?'],
  }) }), error => error.canDiscardStart === true);
  assert.equal(store.length, 1);
  await controller.discard('custom');
  assert.equal(store.length, 0);
});

test('coalesced callers share the mapped expiry recovery error', async () => {
  let finish, posted;
  const entered = new Promise(resolve => { posted = resolve; });
  const { controller } = setup({ post: async () => {
    posted(); await new Promise(resolve => { finish = resolve; });
    throw Object.assign(new Error('expired'), { status: 410 });
  } });
  const first = controller.start(topic());
  await entered;
  const second = controller.start(topic());
  const results = Promise.allSettled([first, second]);
  finish();
  for (const result of await results) {
    assert.equal(result.status, 'rejected');
    assert.equal(result.reason.canDiscardStart, true);
  }
});

test('account-switch cleanup preserves current account retry and unrelated storage only', () => {
  const store = storage();
  store.setItem(`aver:speaking-start:v1:${OWNER}:topic`, 'current');
  store.setItem(`aver:speaking-start:v1:${randomUUID()}:topic`, 'prior');
  store.setItem('other', 'keep');
  clearSpeakingStartIntents(store, OWNER);
  assert.deepEqual([...store.rows.values()], ['current', 'keep']);
});

test('changed storage during preparation is not overwritten', async () => {
  const { controller, store, calls } = setup();
  const key = `aver:speaking-start:v1:${OWNER}:topic`;
  await assert.rejects(controller.start({ ...topic(), prepare: async () => {
    store.setItem(key, 'another pending value'); return topic().prepare();
  } }), /quyền lưu trữ/);
  assert.equal(store.getItem(key), 'another pending value');
  assert.equal(calls.length, 0);
});

test('dispose aborts in-flight work, retains receipt, and cannot navigate via a late acknowledgement', async () => {
  let signal, finish, entered;
  const posted = new Promise(resolve => { entered = resolve; });
  const { controller, store } = setup({ post: async (path, body, account, s) => {
    signal = s; entered(); await new Promise(resolve => { finish = resolve; });
    return { id: body.client_session_id };
  } });
  const pending = controller.start(topic());
  await posted;
  controller.dispose();
  assert.equal(signal.aborted, true);
  finish();
  await assert.rejects(pending, /đăng nhập đã thay đổi/);
  assert.equal(store.length, 1);
  await assert.rejects(controller.start(topic()), /đăng nhập đã thay đổi/);
});

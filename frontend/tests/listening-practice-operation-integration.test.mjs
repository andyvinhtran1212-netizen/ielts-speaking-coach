import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import { createCoreOperationTransport, clearCoreOperationIntents } from '../lib/core-operation-intent.mjs';
import { normalizePracticeCheck, normalizePracticeStart, normalizePracticeSubmit, normalizePracticeAttempt } from '../lib/listening-practice-run-model.mjs';

const HEADER = 'X-Core-Operation-ID';
const source = readFileSync(new URL('../app/(authed-listening-practice-run)/listening/practice-run/practice-run-player.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('player.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function callback(name, scope) {
  let found;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name && ts.isCallExpression(node.initializer)
        && node.initializer.expression.getText(ast) === 'useCallback') found = node.initializer.arguments[0].getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(found, `actual ${name} callback`);
  const values = { normalizePracticeCheck, normalizePracticeStart, normalizePracticeSubmit, normalizePracticeAttempt, ...scope };
  const code = ts.transpileModule(`return (${found});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(values), code)(...Object.values(values));
}

function harness({ enabled = true, denied = false } = {}) {
  const rows = new Map();
  const storage = { get length() { return rows.size; }, key: i => [...rows.keys()][i],
    getItem: key => rows.get(key) ?? null, setItem: (key, value) => rows.set(key, String(value)), removeItem: key => rows.delete(key) };
  const request = () => createCoreOperationTransport({ enabled: () => enabled, getStorage: () => {
    if (!enabled) assert.fail('disabled hints must not read storage');
    if (denied) throw Error('denied');
    return storage;
  } });
  const calls = [];
  const world = { rows, storage, request, calls, accountId: randomUUID(), attemptId: randomUUID(), testId: randomUUID() };
  world.reply = async () => { throw Error('offline'); };
  world.post = callback('post', { window: { api: { postWith: (...args) => {
    calls.push(args); return world.reply(...args);
  } } } });
  world.scope = extra => ({ accountId: world.accountId, testId: world.testId, coreOperationRequest: request(),
    post: world.post, ...extra });
  world.check = extra => callback('checkQuestion', world.scope(extra));
  return world;
}

const request = (qNum = 1, answer = 'ninety') => ({ qNum, answer, reveal: false });
const checked = (qNum = 1) => ({ q_num: qNum, correct: false, canonical_correct: false,
  recorded: false, answered_before: true, audio_window: { start: 1, end: 2 } });

test('actual check keeps exact pending payload/hint across retry/remount; valid ACK rotates it', async () => {
  const h = harness();
  await assert.rejects(h.check()(h.attemptId, request()), /offline/);
  await assert.rejects(h.check()(h.attemptId, request()), /offline/);
  assert.deepEqual(h.calls[0], h.calls[1]);
  assert.ok(h.calls[0][2][HEADER]);
  assert.deepEqual(h.calls[0][1], { q_num: 1, user_answer: 'ninety' });
  assert.deepEqual(h.calls[0][3], { noRedirect: true });
  assert.equal(h.rows.size, 1);
  assert.ok(!JSON.stringify([...h.rows]).includes('ninety'));
  h.reply = async () => checked();
  const value = await h.check()(h.attemptId, request());
  assert.equal(value.canonicalCorrect, false);
  assert.equal(h.calls[2][2][HEADER], h.calls[0][2][HEADER]);
  assert.equal(h.rows.size, 0);
  await h.check()(h.attemptId, request());
  assert.notEqual(h.calls[3][2][HEADER], h.calls[0][2][HEADER]);
});

test('malformed or wrong-question check ACK stays pending and cannot advance the learner', async () => {
  const h = harness();
  h.reply = async () => checked(2);
  await assert.rejects(h.check()(h.attemptId, request()), /identity/);
  h.reply = async () => ({ ...checked(), expected: 'private leaked answer' });
  await assert.rejects(h.check()(h.attemptId, request()), /answer-leak/);
  assert.equal(h.calls[0][2][HEADER], h.calls[1][2][HEADER]);
  assert.equal(h.rows.size, 1);
  assert.ok(!JSON.stringify([...h.rows]).includes('private leaked answer'));
});

test('question slots, changed answers, attempts and accounts never share unrelated hints', async () => {
  const h = harness();
  for (const req of [request(1), request(2), request(1, 'nineteen'), request(1, 'ninety')]) {
    await assert.rejects(h.check()(h.attemptId, req));
  }
  await assert.rejects(h.check()(randomUUID(), request()));
  await assert.rejects(h.check({ accountId: randomUUID() })(h.attemptId, request()));
  assert.equal(new Set(h.calls.map(call => call[2][HEADER])).size, 6);
  await assert.rejects(h.check()(h.attemptId, request(2)));
  assert.equal(h.calls[6][2][HEADER], h.calls[1][2][HEADER]);
});

test('reveal bypasses mutation hints and cannot consume a pending answer-check hint', async () => {
  const h = harness();
  await assert.rejects(h.check()(h.attemptId, request()));
  const before = [...h.rows];
  h.reply = async () => ({ ...checked(), revealed: true, expected: 'nineteen', alternatives: [], solution: {} });
  const value = await h.check()(h.attemptId, { ...request(), reveal: true });
  assert.equal(value.revealed, true);
  assert.deepEqual(h.calls[1][1], { q_num: 1, reveal: true });
  assert.deepEqual(h.calls[1][2], {});
  assert.deepEqual([...h.rows], before);
});

for (const options of [{ enabled: false }, { denied: true }]) {
  test(`optional metadata failure never prevents check dispatch: ${JSON.stringify(options)}`, async () => {
    const h = harness(options); h.reply = async () => checked();
    assert.equal((await h.check()(h.attemptId, request())).canonicalCorrect, false);
    assert.equal(h.calls.length, 1); assert.deepEqual(h.calls[0][2], {}); assert.equal(h.rows.size, 0);
  });
}

test('account cleanup during an in-flight request is not undone by its late ACK', async () => {
  const h = harness(); let complete;
  h.reply = () => new Promise(resolve => { complete = resolve; });
  const pending = h.check()(h.attemptId, request());
  assert.equal(h.calls.length, 1, 'hint must not delay dispatch');
  clearCoreOperationIntents(h.storage);
  complete(checked()); await pending;
  assert.equal(h.rows.size, 0);
});

test('actual start resumes first and acknowledges a reconciled lost reply without another POST', async () => {
  const h = harness(); let reads = 0;
  const ensure = callback('ensureAttempt', h.scope({ startPromiseRef: { current: null },
    readOpenAttempt: async () => ++reads === 1 ? null : { attemptId: h.attemptId, answers: [] } }));
  const value = await ensure([1, 2], new AbortController().signal);
  assert.equal(value.attemptId, h.attemptId); assert.equal(reads, 2); assert.equal(h.calls.length, 1);
  assert.ok(h.calls[0][2][HEADER]); assert.equal(h.rows.size, 0);
  assert.deepEqual(h.calls[0][1], {});
  assert.equal((await ensure([1, 2], new AbortController().signal)).attemptId, h.attemptId);
  assert.equal(h.calls.length, 1, 'a current owned attempt must never trigger another start');
});

test('actual uncertain start retains the hint and its failed single-flight promise; no blind retry', async () => {
  const h = harness(), ref = { current: null };
  const ensure = callback('ensureAttempt', h.scope({ startPromiseRef: ref, readOpenAttempt: async () => null }));
  for (let i = 0; i < 2; i++) await assert.rejects(ensure([1], new AbortController().signal), /start-uncertain/);
  assert.equal(h.calls.length, 1); assert.equal(h.rows.size, 1);
});

test('a valid start ACK clears metadata, while cancellation before start sends nothing', async () => {
  const h = harness();
  h.reply = async () => ({ attempt_id: h.attemptId, status: 'in_progress' });
  const ensure = callback('ensureAttempt', h.scope({ startPromiseRef: { current: null }, readOpenAttempt: async () => null }));
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(ensure([1], aborted.signal), { name: 'AbortError' });
  assert.equal(h.calls.length, 0); assert.equal(h.rows.size, 0);
  const value = await ensure([1], new AbortController().signal);
  assert.equal(value.attemptId, h.attemptId); assert.ok(h.calls[0][2][HEADER]); assert.equal(h.rows.size, 0);
});

const summary = attemptId => ({ attempt_id: attemptId, score: 0, max_score: 1,
  per_question: [{ q_num: 1, correct: false, user_answer: 'ninety', expected: 'nineteen' }] });

test('actual submit keeps its hint after confirmed-active GET, then clears only on a valid summary', async () => {
  const h = harness();
  const submit = callback('submitWithReconciliation', h.scope({ submitPromiseRef: { current: null },
    get: async () => ({ attempt_id: h.attemptId, status: 'in_progress' }) }));
  const first = await submit(h.attemptId, [1]);
  assert.equal(first.retrySafe, true); assert.equal(h.calls.length, 1); assert.equal(h.rows.size, 1);
  h.reply = async () => summary(h.attemptId);
  const second = await submit(h.attemptId, [1]);
  assert.equal(second.summary.score, 0);
  assert.equal(h.calls[0][2][HEADER], h.calls[1][2][HEADER]); assert.ok(h.calls[0][2][HEADER]);
  assert.deepEqual(h.calls.map(call => call[1]), [{}, {}]); assert.equal(h.rows.size, 0);
});

test('actual submit acknowledges canonical GET after lost ACK without resubmitting', async () => {
  const h = harness();
  const submit = callback('submitWithReconciliation', h.scope({ submitPromiseRef: { current: null },
    get: async () => ({ attempt_id: h.attemptId, status: 'submitted', score: 0, grading_details: summary(h.attemptId).per_question }) }));
  const value = await submit(h.attemptId, [1]);
  assert.equal(value.summary.score, 0); assert.equal(h.calls.length, 1); assert.ok(h.calls[0][2][HEADER]);
  assert.equal(h.rows.size, 0);
});

test('unknown submit reconciliation cannot clear pending evidence or imply safe retry', async () => {
  const h = harness();
  const submit = callback('submitWithReconciliation', h.scope({ submitPromiseRef: { current: null },
    get: async () => { throw Error('unavailable'); } }));
  const value = await submit(h.attemptId, [1]);
  assert.equal(value.uncertain, true); assert.equal(value.retrySafe, false); assert.equal(h.rows.size, 1);
  assert.equal(h.calls.length, 1);
});

test('malformed submit and mismatched owner GET cannot acknowledge a different attempt', async () => {
  const h = harness();
  h.reply = async () => summary(randomUUID());
  const submit = callback('submitWithReconciliation', h.scope({ submitPromiseRef: { current: null },
    get: async () => ({ attempt_id: randomUUID(), status: 'submitted', score: 0, grading_details: summary(h.attemptId).per_question }) }));
  const value = await submit(h.attemptId, [1]);
  assert.equal(value.summary, null); assert.equal(value.uncertain, true); assert.equal(value.retrySafe, false);
  assert.equal(h.calls.length, 1); assert.equal(h.rows.size, 1);
});

test('overlapping submits preserve the existing single flight and one canonical result', async () => {
  const h = harness(); let complete;
  h.reply = () => new Promise(resolve => { complete = resolve; });
  const submit = callback('submitWithReconciliation', h.scope({ submitPromiseRef: { current: null },
    get: () => assert.fail('successful POST does not need reconciliation') }));
  const first = submit(h.attemptId, [1]), second = submit(h.attemptId, [1]);
  assert.equal(h.calls.length, 1);
  complete(summary(h.attemptId));
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, b); assert.equal(a.summary.score, 0); assert.equal(h.rows.size, 0);
});

test('actual UI check-error path keeps the exact pending request and does not apply a verdict', async () => {
  let pending, error, busy = false, checks = 0;
  const requested = request();
  const attemptId = randomUUID();
  const send = callback('sendCheck', { attemptId, busy: false, activeQuestion: { qNum: 1 },
    setBusy: value => { busy = value; }, setPendingCheck: value => { pending = value; },
    setInlineError: value => { error = value; }, checkQuestion: async (id, req) => {
      checks++; assert.equal(id, attemptId); assert.equal(req, requested); throw Error('409');
    },
    applyCheck: () => assert.fail('failed response cannot become a grade') });
  await send(requested);
  assert.equal(checks, 1); assert.equal(pending, requested); assert.ok(error); assert.equal(busy, false);
});

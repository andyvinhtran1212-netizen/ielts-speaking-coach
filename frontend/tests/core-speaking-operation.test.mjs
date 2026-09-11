import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createCoreOperationTransport } from '../lib/core-operation-intent.mjs';
import { createSpeakingOperationTransport } from '../lib/core-speaking-operation.mjs';
import { SpeakingSubmissionController } from '../public/js/speaking-submission-controller.mjs';

function harness(options = {}) {
  const rows = options.rows || new Map();
  const store = { getItem: key => rows.get(key) ?? null, setItem: (key, value) => rows.set(key, value), removeItem: key => rows.delete(key) };
  const request = createCoreOperationTransport({ enabled: () => true, getStorage: () => store });
  return { rows, upload: createSpeakingOperationTransport({ enabled: () => true, crypto: webcrypto, request, ...options }) };
}
function request(accountId = randomUUID(), content = 'synthetic recording') {
  const formData = new FormData();
  formData.append('question_id', 'synthetic-question');
  formData.append('audio_file', new Blob([content], { type: 'audio/webm' }), 'response.webm');
  return { accountId, path: '/sessions/synthetic-session/responses', formData };
}

test('same actual audio retries across helper recreation; new audio/new account never aliases it', async () => {
  const h = harness(), calls = [], first = request(), error = new Error('lost response');
  const send = headers => { calls.push(headers['X-Core-Operation-ID']); return Promise.reject(error); };
  await assert.rejects(h.upload(first, send), e => e === error);
  await assert.rejects(harness({ rows: h.rows }).upload(request(first.accountId), send), e => e === error);
  assert.equal(calls[0], calls[1]);
  assert.ok(!JSON.stringify([...h.rows]).includes('synthetic recording'));
  await assert.rejects(h.upload(request(first.accountId, 'a newly recorded answer'), send));
  await assert.rejects(h.upload(request(), send));
  assert.equal(new Set(calls.slice(1)).size, 3);
});

test('real submission controller preserves audio, multipart fields, serialization and receipt handling', async () => {
  const h = harness(), accountId = randomUUID(), calls = [];
  let lost = true;
  const controller = new SpeakingSubmissionController({
    upload: (path, formData) => h.upload({ accountId, path, formData }, headers => {
      calls.push({ path, formData, headers });
      if (lost) { lost = false; return Promise.reject(Error('offline')); }
      return Promise.resolve({ response_id: 'receipt-1' });
    }),
    getSession: async () => ({ responses: [] }),
  });
  const blob = new Blob(['recorded answer'], { type: 'audio/mp4' });
  const first = { sessionId: 'sid', questionId: 'qid', blob };
  await assert.rejects(controller.submit(first), error => error.code === 'ambiguous_commit');
  assert.equal((await controller.submit(first)).response_id, 'receipt-1');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].headers, calls[1].headers);
  assert.equal(calls[0].path, '/sessions/sid/responses');
  assert.equal(calls[0].formData.get('question_id'), 'qid');
  assert.equal(calls[0].formData.get('audio_file').name, 'response.m4a');
  assert.equal(await calls[0].formData.get('audio_file').text(), 'recorded answer');
  assert.equal(h.rows.size, 0, 'direct response receipt acknowledged');
});

test('pending uploads for different questions in the same session keep independent retry hints', async () => {
  const h = harness(), accountId = randomUUID(), calls = [];
  const first = request(accountId), second = request(accountId, 'second question answer');
  first.formData.set('question_id', 'question-1');
  second.formData.set('question_id', 'question-2');
  const lost = headers => { calls.push(headers['X-Core-Operation-ID']); throw Error('lost reply'); };
  await assert.rejects(h.upload(first, lost), /lost reply/);
  await assert.rejects(h.upload(second, lost), /lost reply/);
  const reloaded = harness({ rows: h.rows });
  await assert.rejects(reloaded.upload(first, lost), /lost reply/);
  await assert.rejects(reloaded.upload(second, lost), /lost reply/);
  assert.equal(calls[0], calls[2]);
  assert.equal(calls[1], calls[3]);
  assert.notEqual(calls[0], calls[1]);
  await reloaded.upload(second, () => ({ response_id: 'saved-second' }));
  await assert.rejects(reloaded.upload(first, lost), /lost reply/);
  assert.equal(calls[0], calls[4], 'acknowledging another question cannot erase this retry');
});

test('flag off bypasses blob reads and preserves synchronous transport invocation', () => {
  const h = harness({ enabled: () => false });
  const promise = Promise.resolve('original');
  let calls = 0;
  assert.equal(h.upload({ formData: { get: () => assert.fail() } }, headers => { calls++; assert.deepEqual(headers, {}); return promise; }), promise);
  assert.equal(calls, 1);
});

test('same question identifier across different sessions never shares an upload hint', async () => {
  const h = harness(), accountId = randomUUID(), calls = [];
  const first = request(accountId), second = { ...request(accountId), path: '/sessions/second-session/responses' };
  const send = headers => { calls.push(headers['X-Core-Operation-ID']); throw Error('lost reply'); };
  for (const input of [first, second, first, second]) await assert.rejects(h.upload(input, send), /lost reply/);
  assert.equal(calls[0], calls[2]);
  assert.equal(calls[1], calls[3]);
  assert.notEqual(calls[0], calls[1]);
  await h.upload(second, () => ({ response_id: 'second-session-receipt' }));
  await assert.rejects(h.upload(first, send), /lost reply/);
  assert.equal(calls[0], calls[4]);
});

test('unavailable or oversized audio observation sends original request once without a hint', async () => {
  for (const options of [{ crypto: null }, { enabled: () => { throw Error('config'); } }]) {
    let calls = 0;
    assert.equal(await harness(options).upload(request(), headers => { calls++; assert.deepEqual(headers, {}); return 'ok'; }), 'ok');
    assert.equal(calls, 1);
  }
  const fd = { get: name => name === 'question_id' ? 'q' : {
    size: 50 * 1024 * 1024 + 1, arrayBuffer: () => assert.fail('oversize observation must not read blob'),
  } };
  await harness().upload({ ...request(), formData: fd }, headers => { assert.deepEqual(headers, {}); return null; });
});

test('timed-out digest cannot send or write evidence after its fallback upload', async () => {
  let resolveHash;
  const h = harness({ timeoutMs: 1, crypto: { subtle: { digest: () => new Promise(resolve => { resolveHash = resolve; }) } } });
  let calls = 0;
  await h.upload(request(), headers => { calls++; assert.deepEqual(headers, {}); return 'ok'; });
  resolveHash(new ArrayBuffer(32));
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(calls, 1); assert.equal(h.rows.size, 0);
});

test('transport errors are never mistaken for hash errors or retried twice', async () => {
  for (const synchronous of [false, true]) {
    const error = new Error('original upload failure'); let calls = 0;
    await assert.rejects(harness().upload(request(), () => {
      calls++; if (synchronous) throw error; return Promise.reject(error);
    }), e => e === error);
    assert.equal(calls, 1);
  }
});

test('actual api.js keeps three-argument uploads compatible and forwards optional fourth-argument headers without JSON content-type', async () => {
  const source = readFileSync(new URL('../public/js/api.js', import.meta.url), 'utf8');
  const calls = [];
  const win = { location: { hostname: 'localhost', pathname: '/practice/session' }, crypto: { randomUUID },
    supabase: { createClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'synthetic-token' } } }) } }) } };
  runInNewContext(source, { window: win, fetch: async (path, options) => {
    calls.push({ path, options }); return { ok: true, status: 200, text: async () => '{"response_id":"r1"}' };
  }, console });
  win.initSupabase('https://example.invalid', 'synthetic-key');
  const fd = request().formData, signal = new AbortController().signal;
  await win.api.uploadWith('/sessions/s/responses', fd, { noRedirect: true, signal });
  await win.api.uploadWith('/sessions/s/responses', fd, { noRedirect: true, signal }, { 'X-Core-Operation-ID': 'synthetic-operation' });
  assert.equal(calls.length, 2);
  for (const { options } of calls) {
    assert.equal(options.method, 'POST'); assert.equal(options.body, fd); assert.equal(options.signal, signal);
    assert.equal(options.headers.Authorization, 'Bearer synthetic-token');
    assert.equal(options.headers['Content-Type'], undefined, 'browser owns multipart boundary');
    assert.ok(options.headers['X-Request-ID']);
  }
  assert.equal(calls[0].options.headers['X-Core-Operation-ID'], undefined);
  assert.equal(calls[1].options.headers['X-Core-Operation-ID'], 'synthetic-operation');
});

test('actual Next bridge completes with durable retry hints while shared practice adapter preserves legacy transport', async () => {
  const h = harness(), accountId = randomUUID(), sessionId = randomUUID(), calls = [];
  const source = readFileSync(new URL('../app/(authed-practice)/practice/session/practice-submission-bridge.tsx', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('bridge.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effect;
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect') effect = node.arguments[0].getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(ast); assert.ok(effect);
  const compiled = ts.transpileModule(`return (${effect})();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const request = createCoreOperationTransport({ enabled: () => true, getStorage: () => ({
    getItem: key => h.rows.get(key) ?? null, setItem: (key, value) => h.rows.set(key, value), removeItem: key => h.rows.delete(key),
  }) });
  let fail = true;
  const win = { api: { patchWith: async (...args) => {
    calls.push(args); if (fail) { fail = false; throw Error('lost complete'); }
    return { session_id: sessionId, status: 'completed' };
  } } };
  const mount = () => new Function('status', 'user', 'window', 'SpeakingSubmissionController', 'coreSpeakingUpload', 'coreOperationRequest', compiled)(
    'signed-in', { id: accountId }, win, SpeakingSubmissionController, h.upload, request,
  );
  let cleanup = mount();
  await assert.rejects(win.PracticeSubmission.complete(sessionId), /lost complete/);
  cleanup(); assert.equal(win.PracticeSubmission, undefined);
  cleanup = mount(); await win.PracticeSubmission.complete(sessionId);
  assert.deepEqual(calls[0], calls[1]); assert.ok(calls[0][2]['X-Core-Operation-ID']);
  const partA = randomUUID(), partB = randomUUID(), partCalls = [];
  const rejectComplete = async (...args) => { partCalls.push(args); throw Error('lost part completion'); };
  win.api.patchWith = rejectComplete;
  for (const id of [partA, partB, partA, partB]) await assert.rejects(win.PracticeSubmission.complete(id), /lost part completion/);
  assert.deepEqual(partCalls[0], partCalls[2]);
  assert.deepEqual(partCalls[1], partCalls[3]);
  assert.notEqual(partCalls[0][2]['X-Core-Operation-ID'], partCalls[1][2]['X-Core-Operation-ID']);
  win.api.patchWith = async () => ({ session_id: partB, status: 'completed' });
  await win.PracticeSubmission.complete(partB);
  win.api.patchWith = rejectComplete;
  await assert.rejects(win.PracticeSubmission.complete(partA), /lost part completion/);
  assert.deepEqual(partCalls[0], partCalls[4], 'another part acknowledgement cannot erase this completion hint');
  cleanup();

  const practice = readFileSync(new URL('../public/js/practice.js', import.meta.url), 'utf8');
  const practiceAst = ts.createSourceFile('practice.js', practice, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let adapter;
  const find = node => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === '_completeSpeakingSession') adapter = node.getText(practiceAst);
    ts.forEachChild(node, find);
  };
  find(practiceAst); assert.ok(adapter);
  const legacy = { patch: (...args) => { calls.push(args); return Promise.resolve('legacy'); } };
  const complete = new Function('window', '_getNativeSubmission', `${adapter}; return _completeSpeakingSession;`)({ api: legacy }, () => null);
  assert.equal(await complete(sessionId), 'legacy');
  assert.deepEqual(calls.at(-1), [`/sessions/${sessionId}/complete`, {}]);

  const attempted = [], failures = [];
  const failing = new Function('_getNativeSubmission', `${adapter}; return _completeSpeakingSession;`)(
    () => ({ complete: id => { attempted.push(id); throw Error(`sync failure ${id}`); } }),
  );
  await Promise.all(['part-1', 'part-2', 'part-3'].map(id => failing(id).catch(error => failures.push(error.message))));
  assert.deepEqual(attempted, ['part-1', 'part-2', 'part-3']);
  assert.deepEqual(failures, attempted.map(id => `sync failure ${id}`));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import { anonymousReadingScope, createCoreOperationTransport, coreOperationHeaders, clearCoreOperationIntents } from '../lib/core-operation-intent.mjs';

const HEADER = 'X-Core-Operation-ID';
const files = {
  reading: '../app/(authed-reading-player)/reading/exam/session/reading-exam-session.tsx',
  listening: '../app/(authed-listening-player)/listening/test/session/listening-test-session.tsx',
  writing: '../app/(authed-writing)/writing/dashboard/writing-behavior.tsx',
  dictation: '../app/(authed-listening-dictation)/listening/dictation/session/listening-dictation-session.tsx',
  auth: '../lib/auth/auth-provider.tsx',
  mock: '../app/(authed-mock-exam)/mock-exam/mock-exam-runner.tsx',
};
function actualHandler(file, name, scope) {
  scope = { anonymousReadingScope, ...scope };
  const source = readFileSync(new URL(files[file], import.meta.url), 'utf8');
  const ast = ts.createSourceFile('handler.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(ast);
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name && ts.isCallExpression(node.initializer)
        && node.initializer.expression.getText(ast) === 'useCallback') found = node.initializer.arguments[0].getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(found, `real ${file}.${name} callback`);
  const compiled = ts.transpileModule(`return (${found});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(scope), compiled)(...Object.values(scope));
}
function harness() {
  const rows = new Map();
  const storage = { getItem: key => rows.get(key) ?? null, setItem: (key, value) => rows.set(key, String(value)) };
  return { rows, request: createCoreOperationTransport({ getStorage: () => storage, enabled: () => true }),
    user: { id: randomUUID() }, attempt: { attempt_id: randomUUID() } };
}

for (const file of ['reading', 'listening']) {
  test(`actual ${file} save keeps keepalive/signal and dispatches synchronously, including reload retry`, async () => {
    const h = harness(), calls = [], controller = new AbortController();
    const scope = { user: h.user, attempt: h.attempt, params: {}, anonHeaders: () => ({}), coreOperationRequest: h.request,
      window: { api: { patchWith: (path, body, headers, options) => {
        calls.push({ path, body, headers, options });
        return calls.length === 1 ? Promise.reject(new Error('lost response'))
          : Promise.resolve({ attempt_id: h.attempt.attempt_id, q_num: body.q_num });
      } } } };
    let save = actualHandler(file, 'saveAnswer', scope);
    const first = save(3, 'Library', { keepalive: true, signal: controller.signal });
    assert.equal(calls.length, 1, 'real handler must call api before its first await');
    await assert.rejects(first, /lost response/);
    save = actualHandler(file, 'saveAnswer', { ...scope, coreOperationRequest: harnessTransport(h) });
    await save(3, 'Library', { keepalive: true, signal: controller.signal });
    assert.deepEqual(calls[0], calls[1]);
    assert.equal(calls[0].options.keepalive, true);
    assert.equal(calls[0].options.signal, controller.signal);
    assert.equal(calls[0].options.noRedirect, true);
    assert.ok(calls[0].headers[HEADER]);
    await save(3, 'Library', {});
    assert.notEqual(calls[2].headers[HEADER], calls[1].headers[HEADER]);
  });
}
function harnessTransport(h) {
  return createCoreOperationTransport({ enabled: () => true, getStorage: () => ({
    getItem: key => h.rows.get(key) ?? null, setItem: (key, value) => h.rows.set(key, String(value)),
  }) });
}

test('actual anonymous Reading keeps its capability/redirect policy and never substitutes account hints', async () => {
  const h = harness(); let headers;
  const save = actualHandler('reading', 'saveAnswer', {
    user: h.user, attempt: h.attempt, params: { share: 'share-test' }, anonHeaders: () => ({ 'X-Reading-Anon': 'test-capability' }),
    coreOperationRequest: h.request, window: { api: { patchWith: (_path, _body, value) => { headers = value; return null; } } },
  });
  await save(1, 'answer', {});
  assert.deepEqual(headers, { 'X-Reading-Anon': 'test-capability' });
  assert.equal(h.rows.size, 0);
});

test('actual anonymous Reading save reuses its capability-scoped hint after reload with a different signed-in account', async () => {
  const h = harness(), calls = [], capability = 'c'.repeat(32);
  const previous = globalThis.window;
  globalThis.window = { __AVER_RUNTIME_CONFIG__: { coreOperationCorrelationEnabled: true } };
  try {
    const scope = { user: h.user, attempt: h.attempt, params: { share: 'share-token' }, anonHeaders: () => ({ 'X-Reading-Anon': capability }),
      coreOperationRequest: h.request, window: { api: { patchWith: async (...args) => { calls.push(args); throw Error('offline'); } } } };
    await assert.rejects(actualHandler('reading', 'saveAnswer', scope)(2, 'answer', { keepalive: true }));
    await assert.rejects(actualHandler('reading', 'saveAnswer', { ...scope, user: { id: randomUUID() }, coreOperationRequest: harnessTransport(h) })(2, 'answer', { keepalive: true }));
    assert.deepEqual(calls[0], calls[1]);
    assert.equal(calls[0][2]['X-Reading-Anon'], capability);
    assert.ok(calls[0][2][HEADER]);
    assert.equal(calls[0][3].noRedirect, true);
    assert.ok(!JSON.stringify([...h.rows]).includes(capability));
  } finally { globalThis.window = previous; }
});

test('actual Listening submit changes hint when saved answer snapshot changes, although HTTP body stays empty', async () => {
  const h = harness(), calls = [], answersRef = { current: new Map([[1, 'A']]) };
  const scope = { user: h.user, attempt: h.attempt, phase: 'inprogress', params: {}, answersRef,
    coreOperationRequest: h.request, coordinatorRef: { current: { flush: async () => true } },
    setSubmitOpen() {}, setSubmitBlocked() {}, setPhase() {}, setError() {}, setResult() {}, audioRef: { current: null },
    window: { api: { postWith: async (path, body, headers) => { calls.push({ path, body, headers }); throw Error('lost response'); } } },
  };
  await actualHandler('listening', 'submit', scope)();
  await actualHandler('listening', 'submit', { ...scope, coreOperationRequest: harnessTransport(h) })();
  assert.equal(calls[0].headers[HEADER], calls[1].headers[HEADER]);
  answersRef.current.set(1, 'B');
  await actualHandler('listening', 'submit', scope)();
  assert.notEqual(calls[0].headers[HEADER], calls[2].headers[HEADER]);
  assert.deepEqual(calls.map(call => call.body), [{}, {}, {}]);
});

test('actual Listening submit does not record/send anything when answers have not flushed', async () => {
  const h = harness(); let blocked = '';
  await actualHandler('listening', 'submit', {
    attempt: h.attempt, phase: 'inprogress', setSubmitOpen() {}, setSubmitBlocked: value => { blocked = value; }, setPhase() {},
    coordinatorRef: { current: { flush: async () => false } }, coreOperationRequest: () => assert.fail('must not send'),
  })();
  assert.ok(blocked);
  assert.equal(h.rows.size, 0);
});

test('actual Writing draft uses the exact textarea snapshot and preserves retry across remount', async () => {
  const h = harness(), calls = [], textarea = { value: 'My exact essay text' };
  const scope = { $: id => id === 'modal-essay-textarea' ? textarea : null, coreOperationRequest: h.request,
    setTimeout() {}, alert() {},
    window: { api: { patchWith: async (path, body, headers) => {
      calls.push({ path, body, headers });
      if (calls.length === 1) throw new Error('offline');
      return { assignment_id: h.attempt.attempt_id };
    } } },
  };
  // These transport contracts run after the workspace has loaded, not while
  // the shared modal is still waiting for another assignment's admission.
  const ms = { assignmentId: h.attempt.attempt_id, accountId: h.user.id, workspaceReady: true, openGeneration: 1, dead: false };
  await actualHandler('writing', 'saveDraft', scope)(ms);
  await actualHandler('writing', 'saveDraft', { ...scope, coreOperationRequest: harnessTransport(h) })(ms);
  assert.deepEqual(calls[0], calls[1]);
  assert.deepEqual(calls[0].body, { draft_text: textarea.value });
  assert.ok(!JSON.stringify([...h.rows]).includes(textarea.value));
});

test('actual Dictation reconciliation forwards the existing durable request ID and original submission', async () => {
  const h = harness(), calls = [], requestId = randomUUID();
  const receipt = { accountId: h.user.id, requestId, submission: { client_request_id: requestId, sentences: [] } };
  const previous = globalThis.window;
  globalThis.window = { __AVER_RUNTIME_CONFIG__: { coreOperationCorrelationEnabled: true } };
  try {
    const reconcile = actualHandler('dictation', 'reconcile', {
      sectionRunRef: { current: 1 }, accountRef: { current: h.user.id }, setSaveState() {}, setPendingReceipt() {},
      coreOperationHeaders, confirmReceipt: async () => { throw Error('missing'); }, isMissingReceipt: () => true,
      confirmAttemptReport: (_payload, actual) => assert.equal(actual, receipt),
      window: { api: { postWith: async (...args) => { calls.push(args); return { ok: true }; } } },
    });
    await reconcile(receipt, {});
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1], receipt.submission);
    assert.deepEqual(calls[0][2], { [HEADER]: requestId });
  } finally { globalThis.window = previous; }
});

test('actual Writing submit forwards its existing receipt unchanged across lost reply and retry', async () => {
  const h = harness(), calls = [], requestId = randomUUID();
  const receipt = { essayText: 'Prepared essay from the existing submit receipt', requestId };
  const ms = { assignmentId: h.attempt.attempt_id, accountId: h.user.id, dead: false, workspaceReady: true, openGeneration: 1 };
  let removed = 0, closed = 0;
  const previous = globalThis.window;
  globalThis.window = { __AVER_RUNTIME_CONFIG__: { coreOperationCorrelationEnabled: true } };
  try {
    const submit = actualHandler('writing', 'submitFromModal', {
      $: id => id === 'modal-essay-textarea' ? { value: 'Unsaved new editor text' } : null,
      countWords: () => 300, showSubmissionNotice() {}, coreOperationHeaders,
      reconcileSubmission: async () => null, statusCode: () => 0, isDefinitiveSubmitRejection: () => false,
      closeModal: () => { closed++; ms.assignmentId = null; }, loadAssignments: async () => {}, loadEssays: async () => {},
      window: { WritingSubmitReceipt: { begin: () => receipt, normalizeAck: () => ({ isFlagged: false }), remove: () => { removed++; } },
        api: { postWith: async (...args) => {
          calls.push(args); if (calls.length === 1) throw Error('lost reply'); return { accepted: true };
        } } },
    });
    await submit(ms, true);
    assert.equal(removed, 0); assert.equal(closed, 0);
    await submit(ms, true);
    assert.deepEqual(calls[0], calls[1]);
    assert.deepEqual(calls[0][1], { essay_text: receipt.essayText, request_id: requestId });
    assert.deepEqual(calls[0][2], { [HEADER]: requestId });
    assert.equal(removed, 1); assert.equal(closed, 1);
  } finally { globalThis.window = previous; }
});

for (const file of ['reading', 'listening']) {
  test(`actual ${file} start preserves path/body/access headers and retries the unacknowledged intent`, async () => {
    const h = harness(), calls = [];
    const scope = { params: { testId: 'test-1', classItem: 'class-1' }, test: { test_id: 'test-1' }, user: h.user,
      resumeAvailable: false, setPhase() {}, setError() {}, coreOperationRequest: h.request,
      queryWithClassItem: (path, item) => `${path}?class_item=${item}`,
      withQuery: (path, entries) => path + '?' + new URLSearchParams(entries),
      READING_RENDERER_AFFINITY_PROTOCOL: { renderer_affinity_protocol: 'claim-v1' },
      passwordHeaders: () => ({ 'X-Reading-Password': 'test-only-password' }),
      window: { api: { postWith: async (...args) => { calls.push(args); throw Error('lost reply'); } } },
    };
    await actualHandler(file, 'startFresh', scope)();
    await actualHandler(file, 'startFresh', { ...scope, coreOperationRequest: harnessTransport(h) })();
    assert.deepEqual(calls[0], calls[1]);
    assert.ok(calls[0][0].endsWith('?class_item=class-1'));
    assert.deepEqual(calls[0][1], { renderer_affinity_protocol: 'claim-v1' });
    assert.ok(calls[0][2][HEADER]);
    if (file === 'reading') assert.equal(calls[0][2]['X-Reading-Password'], 'test-only-password');
    assert.ok(!JSON.stringify([...h.rows]).includes('test-only-password'));
    await actualHandler(file, 'startFresh', { ...scope, resumeAvailable: true })();
    assert.notEqual(calls[2][2][HEADER], calls[1][2][HEADER], 'explicitly replacing a resumed attempt is new intent');
  });
}

test('actual AuthProvider transitions clear account hints without erasing capability-owned hints', async () => {
  const rows = new Map();
  const store = { get length() { return rows.size; }, key: i => [...rows.keys()][i],
    getItem: key => rows.get(key) ?? null, setItem: (key, value) => rows.set(key, value), removeItem: key => rows.delete(key) };
  const userId = randomUUID(), otherId = randomUUID();
  const request = createCoreOperationTransport({ enabled: () => true, getStorage: () => store });
  for (const accountId of [userId, otherId]) await request({ accountId, method: 'POST', path: '/start', input: {} }, () => null);
  await request({ accountId: null, anonymousScope: 'a'.repeat(64), method: 'POST', path: '/share/start', input: {} }, () => null);
  const anonymousRow = [...rows].find(([key]) => key.startsWith('aver:core-operation-anon:'));
  assert.ok(anonymousRow);
  rows.set('unrelated', 'preserved');
  const states = [];
  const transition = actualHandler('auth', 'applySession', { clearCoreOperationIntents, window: { sessionStorage: store },
    setUser() {}, setStatus: value => states.push(value) });
  transition({ user: { id: userId } });
  assert.equal(rows.size, 3);
  assert.ok([...rows.keys()].some(key => key.includes(userId)));
  transition(null);
  assert.deepEqual([...rows], [anonymousRow, ['unrelated', 'preserved']]);
  assert.deepEqual(states, ['signed-in', 'signed-out']);
});

for (const section of ['reading', 'listening']) {
  test(`actual mock ${section} collection retries the same domain hint when parent receipt fails`, async () => {
    const h = harness(), calls = [];
    let parentFailures = 1;
    const sittingId = randomUUID();
    const scope = { user: h.user, coreOperationRequest: h.request,
      stateRef: { current: { sitting: { id: sittingId } } },
      flushEmbed: async value => assert.equal(value, section),
      loadState: async () => ({ sitting: { readingAttemptId: h.attempt.attempt_id, listeningAttemptId: h.attempt.attempt_id } }),
      window: { api: {
        postWith: async (...args) => { calls.push(['domain', ...args]); return { received: true, sealed: true }; },
        post: async (...args) => { calls.push(['parent', ...args]); if (parentFailures-- > 0) throw Error('parent lost'); return { received: true }; },
      } },
    };
    await assert.rejects(actualHandler('mock', 'doSubmit', scope)(section), /parent lost/);
    await actualHandler('mock', 'doSubmit', { ...scope, coreOperationRequest: harnessTransport(h) })(section);
    assert.deepEqual(calls.map(call => call[0]), ['domain', 'parent', 'domain', 'parent']);
    assert.deepEqual(calls[0], calls[2]);
    assert.ok(calls[0][3][HEADER]);
    assert.deepEqual(calls[0][2], section === 'reading' ? { answers: [] } : {});
    assert.equal(calls[1][1], `/api/mock-exams/sittings/${sittingId}/sections/${section}/submit`);
    assert.equal(calls[1].length, 3, 'parent route does not receive an invented core identity/header');
  });
}

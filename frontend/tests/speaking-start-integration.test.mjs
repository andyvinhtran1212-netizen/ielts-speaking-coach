import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createSpeakingStartController } from '../lib/speaking-start-intent.mjs';
import { coreOperationHeaders } from '../lib/core-operation-intent.mjs';

const source = readFileSync(new URL('../app/(authed-speaking)/speaking/speaking-behavior.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('behavior.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['getStarter', 'goToPractice', 'showStartError', 'startFromTopic', 'startFromCustomQuestions'];
const functions = names.map(name => {
  const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node, name); return node.getText(ast);
}).join('\n');
let fullHandler;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'on'
      && node.arguments[0]?.getText(ast) === "$('ft-start')") fullHandler = node.arguments[2].getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(fullHandler, 'execute the actual full-test listener, not a copied implementation');
const compiled = ts.transpileModule(`
  const $ = id => document.getElementById(id);
  const val = id => $(id)?.value ?? '';
  ${functions}
  return { startFromTopic, startFromCustomQuestions, getStarter,
    full: (st, api, randomTopic) => (${fullHandler}) };
`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

function harness() {
  const rows = new Map();
  const store = { getItem: key => rows.get(key) ?? null, setItem: (key, value) => rows.set(key, String(value)), removeItem: key => rows.delete(key) };
  const elements = new Map();
  const element = id => { if (!elements.has(id)) elements.set(id, { value: '', textContent: '', disabled: false,
    children: [], appendChild(child) { this.children.push(child); } }); return elements.get(id); };
  const account = { user: { id: randomUUID() }, access_token: 'test-only-token' };
  const window = { sessionStorage: store, location: { href: '' },
    getSupabase: () => ({ auth: { getSession: async () => ({ data: { session: account } }) } }) };
  const handlers = new Function('window', 'document', 'sessionStorage', 'createSpeakingStartController', 'admitCorePlayer', 'coreOperationHeaders', compiled)(
    window, { getElementById: element, createElement: () => element(Symbol()) }, store, createSpeakingStartController,
    (surface, params) => `/practice?session_id=${params.session_id}`,
    coreOperationHeaders,
  );
  return { handlers, window, element, rows, account, state: () => ({ dead: false, starter: null }) };
}

test('actual topic handler retries lost create acknowledgement across remount and pins account auth', async () => {
  const h = harness();
  const calls = [];
  const api = { postWith: async (path, body, headers, options) => {
    calls.push(body);
    assert.equal(headers.Authorization, 'Bearer test-only-token');
    assert.ok(options.signal instanceof AbortSignal);
    if (calls.length === 1) throw new Error('response lost');
    return { session_id: body.client_session_id };
  } };
  const opts = { topic: 'Library', mode: 'practice', part: 1, errorId: 'error', btn: h.element('button'), idleLabel: 'Start', api };
  await h.handlers.startFromTopic({ ...opts, st: h.state() });
  assert.equal(h.window.location.href, '');
  assert.match(h.element('error').textContent, /response lost/);
  assert.equal(opts.btn.disabled, false);
  assert.equal(h.rows.size, 1);
  await h.handlers.startFromTopic({ ...opts, st: h.state() });
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(h.window.location.href, `/practice?session_id=${calls[0].client_session_id}`);
  assert.equal(h.rows.size, 0);
});

test('actual recovery button discards only on explicit click and never automatically creates a new session', async () => {
  const h = harness();
  h.rows.set(`aver:speaking-start:v1:${h.account.user.id}:topic`, '{');
  let posts = 0;
  const api = { postWith: async (path, body) => { posts++; return { id: body.client_session_id }; } };
  const opts = { topic: 'Library', mode: 'practice', part: 1, errorId: 'error', btn: h.element('button'),
    idleLabel: 'Start', api, st: h.state() };
  await h.handlers.startFromTopic(opts);
  assert.equal(posts, 0);
  assert.match(h.element('error').textContent, /lịch sử/);
  const recovery = h.element('error').children[0];
  assert.equal(recovery.type, 'button');
  await recovery.onclick();
  assert.equal(h.rows.size, 0);
  assert.equal(posts, 0);
  await h.handlers.startFromTopic(opts);
  assert.equal(posts, 1);
  assert.ok(h.window.location.href);
});

test('actual recovery affordance remains usable after a storage removal failure', async () => {
  const h = harness();
  h.rows.set(`aver:speaking-start:v1:${h.account.user.id}:topic`, '{');
  const store = h.window.sessionStorage;
  const remove = store.removeItem;
  store.removeItem = () => { throw new Error('revoked'); };
  await h.handlers.startFromTopic({ topic: 'Library', mode: 'practice', part: 1, errorId: 'error',
    btn: h.element('button'), idleLabel: 'Start', api: { postWith: () => assert.fail('no post') }, st: h.state() });
  const button = h.element('error').children[0];
  await button.onclick();
  assert.equal(button.disabled, false);
  assert.equal(h.element('error').children.at(-1), button);
  store.removeItem = remove;
  await button.onclick();
  assert.equal(h.rows.size, 0);
});

test('actual custom handler retains cue-card part and does not regenerate after save response loss', async () => {
  const h = harness();
  h.element('input').value = 'Describe a library';
  let parses = 0, saves = 0;
  const calls = [];
  h.window.CueCardDetector = { parseCustomQuestionsByPart: async () => {
    parses++; return [{ type: 'cue_card', prompt: 'Describe a library', bullets: ['where'] }];
  } };
  const api = { postWith: async (path, body) => {
    calls.push({ path, body });
    if (path.endsWith('/custom')) { if (++saves === 1) throw new Error('save response lost'); return []; }
    assert.equal(body.part, 2); return { id: body.client_session_id };
  } };
  const opts = { textareaId: 'input', errorId: 'error', btn: h.element('button'), part: 1, mode: 'practice', idleLabel: 'Start', api };
  await h.handlers.startFromCustomQuestions({ ...opts, st: h.state() });
  assert.equal(h.window.location.href, '');
  await h.handlers.startFromCustomQuestions({ ...opts, st: h.state() });
  assert.equal(parses, 1);
  assert.deepEqual(calls.slice(0, 2), calls.slice(2));
  assert.ok(h.window.location.href);
});

test('actual full-test listener reuses all four random choices on retry and hands off Part 2', async () => {
  const h = harness();
  let draws = 0;
  const randomTopic = async part => `${part}-${++draws}`;
  const calls = [];
  const api = { postWith: async (path, body) => {
    calls.push(body); if (calls.length === 1) throw new Error('response lost'); return { id: body.client_session_id };
  } };
  await h.handlers.full(h.state(), api, randomTopic)({ currentTarget: h.element('button') });
  assert.equal(draws, 4);
  assert.equal(h.window.location.href, '');
  await h.handlers.full(h.state(), api, randomTopic)({ currentTarget: h.element('button') });
  assert.equal(draws, 4);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(h.rows.get('ielts_ft_p2topic'), '2-4');
  assert.ok(h.window.location.href);
});

test('actual handler cannot navigate or update detached DOM after unmount', async () => {
  const h = harness();
  const st = h.state();
  const api = { postWith: async (path, body) => {
    st.dead = true; st.starter.dispose(); return { id: body.client_session_id };
  } };
  await h.handlers.startFromTopic({ topic: 'Library', mode: 'practice', part: 1, errorId: 'error',
    btn: h.element('button'), idleLabel: 'Start', api, st });
  assert.equal(h.window.location.href, '');
  assert.equal(h.element('error').textContent, '');
  assert.equal(h.rows.size, 1);
});

test('actual api.js cannot replace the pinned account token during its own auth await', async () => {
  const h = harness();
  let switchNext = false;
  let account = h.account;
  const requests = [];
  h.window.supabase = { createClient: () => ({ auth: { getSession: async () => {
    if (switchNext) { switchNext = false; account = { user: { id: randomUUID() }, access_token: 'other-test-token' }; }
    return { data: { session: account } };
  } } }) };
  runInNewContext(readFileSync(new URL('../public/js/api.js', import.meta.url), 'utf8'), {
    window: h.window,
    fetch: async (url, options) => {
      requests.push(options);
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: JSON.parse(options.body).client_session_id }) };
    },
  });
  h.window.initSupabase('test-only-url', 'test-only-key');
  const api = { postWith: (...args) => { switchNext = true; return h.window.api.postWith(...args); } };
  await h.handlers.startFromTopic({ topic: 'Library', mode: 'practice', part: 1, errorId: 'error',
    btn: h.element('button'), idleLabel: 'Start', api, st: h.state() });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].headers.Authorization, 'Bearer test-only-token');
  assert.equal(JSON.parse(requests[0].body).renderer_affinity_protocol, 'claim-v1');
  assert.equal(h.window.location.href, '');
  assert.match(h.element('error').textContent, /đăng nhập đã thay đổi/);
  assert.equal(h.rows.size, 1);
});

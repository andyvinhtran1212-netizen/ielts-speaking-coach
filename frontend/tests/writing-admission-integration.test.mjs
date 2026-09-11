// Execute the actual TS modal entry + controller with an isolated DOM/API fixture.
// No browser, backend deployment or organic-traffic coverage is implied.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import * as admission from '../lib/writing-admission.mjs';

const source = readFileSync(new URL('../app/(authed-writing)/writing/dashboard/writing-behavior.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function harness(enabled) {
  const h = { account: randomUUID(), assignment: randomUUID(), command: randomUUID(),
    episode: randomUUID(), epoch: randomUUID(), rows: new Map(), calls: [], notices: [], renders: [], removed: [], refreshes: 0 };
  h.storage = { get length() { return h.rows.size; }, key: i => [...h.rows.keys()][i] ?? null,
    getItem: key => h.rows.get(key) ?? null, setItem: (key, value) => h.rows.set(key, value), removeItem: key => h.rows.delete(key) };
  h.ack = (phase = 'accepted', status = 'in_progress') => ({ assignment_id: h.assignment,
    started: phase === 'bound', command: { command_id: h.command, episode_id: h.episode, activity_epoch_id: h.epoch,
      phase, generation: 0, execute_before: '2026-09-10T12:02:00Z' },
    timer: { status: phase === 'bound' ? status : 'pending', is_timed: true, time_limit_minutes: 40,
      started_at: phase === 'bound' ? '2026-09-10T12:00:00Z' : null,
      expires_at: phase === 'bound' ? '2026-09-10T12:40:00Z' : null,
      time_remaining_seconds: phase === 'bound' ? 2400 : null, is_expired: false, auto_submitted: false } });
  h.respond = async (method, path) => {
    if (path.endsWith('/renderer-affinity')) return { renderer_affinity: 'next' };
    if (path.includes('/admission-intents/')) return { found: false, admission: null };
    if (path.endsWith('/entry')) {
      const { command, ...entry } = h.ack();
      return { ...entry, kind: 'eligible' };
    }
    if (path.endsWith('/admissions')) return h.ack();
    if (path.includes('/admissions/')) return h.ack('bound');
    if (path.endsWith('/start')) return { started: true, timer: h.ack('bound').timer };
    return { assignment: { id: h.assignment }, draft: { draft_text: 'kept draft' } };
  };
  const send = async (method, path, body, headers, opts) => { h.calls.push({ method, path, body, headers, opts }); return h.respond(method, path); };
  h.api = {
    post: (path, body) => send('POST', path, body), get: path => send('GET', path),
    postWith: (path, body, headers, opts) => send('POST', path, body, headers, opts),
    patchWith: (path, body, headers, opts) => send('PATCH', path, body, headers, opts),
    getWith: (path, headers, opts) => send('GET', path, null, headers, opts),
  };
  h.window = { api: h.api, sessionStorage: h.storage, __AVER_RUNTIME_CONFIG__: { writingAdmissionEnabled: enabled },
    location: { href: 'http://localhost:3000/writing/dashboard', replace: () => assert.fail('unexpected renderer redirect') },
    history: { replaceState: (state, title, url) => { h.window.location.href = String(url); } },
    getSupabase: () => ({ auth: { getSession: async () => ({ data: { session: { user: { id: h.account }, access_token: 'fixture-token' } } }) } }),
    WritingSubmitReceipt: { read: () => null, remove: (...args) => h.removed.push(args) } };
  const exports = {};
  h.nodes = {};
  h.submittedText = [];
  vm.runInNewContext(compiled + `
    exports.renderWorkspace = renderModal;
    exports.saveDraft = saveDraft;
    showTimerToast = () => {};
    submitFromModal = async () => fixture.submittedText.push(fixture.nodes['modal-essay-textarea']?.value);
    renderModal = (data, ms, timer) => fixture.renders.push({ data, timer });
    updateModalWordCount = () => {};
    showSubmissionNotice = (kind, message) => fixture.notices.push({ kind, message });
    loadAssignments = async () => { fixture.refreshes++; };
    loadEssays = async () => { fixture.refreshes++; };
    exports.entry = openSubmitModal;
    exports.modal = modalState;
    buildAssignmentCardHtml = () => '';
    exports.renderCards = renderAssignments;
  `, { exports, require: path => path === '@/lib/writing-admission.mjs' ? admission
      : path === '@/lib/core-operation-intent.mjs' ? { coreOperationRequest: (input, send) => send({}) } : {},
    window: h.window, document: { activeElement: null, getElementById: id => id === 'assignments-list' ? h.list ?? null : h.nodes[id] ?? null }, HTMLElement: class {},
    URL,
    AbortSignal, AbortController, setTimeout, clearTimeout, clearInterval, console,
    alert: () => assert.fail('admission errors must use inline notice, not alert'), fixture: h });
  exports.modal.accountId = h.account;
  h.open = (allow = true) => exports.entry(h.assignment, h.window, h.api, allow);
  h.modal = exports.modal;
  h.save = () => exports.saveDraft(h.modal);
  h.renderWorkspace = (data, timer) => exports.renderWorkspace(data, h.modal, timer);
  h.renderCards = () => exports.renderCards([{ id: h.assignment }]);
  return h;
}

test('actual default-OFF modal preserves claim → legacy start → detail', async () => {
  const h = harness(false); await h.open();
  assert.ok(h.calls[0].path.endsWith('/renderer-affinity'));
  assert.ok(h.calls[1].path.endsWith('/start'));
  assert.equal(h.calls.length, 3); assert.equal(h.renders.length, 1); assert.equal(h.rows.size, 0);
});

test('actual ON modal claims, prepares, executes and renders canonical timer without /start', async () => {
  const h = harness(true); await h.open();
  assert.ok(h.calls[0].path.endsWith('/renderer-affinity'));
  assert.ok(h.calls[1].path.endsWith('/entry'));
  assert.ok(h.calls[2].path.endsWith('/admissions')); assert.ok(h.calls[3].path.endsWith('/execute'));
  assert.equal(h.calls.some(c => c.path.endsWith('/start')), false);
  assert.equal(h.renders.length, 1); assert.equal(h.renders[0].timer.started_at, '2026-09-10T12:00:00Z');
  for (const call of h.calls.filter(c => c.path.includes('/admissions'))) {
    assert.equal(call.headers.Authorization, 'Bearer fixture-token');
    assert.equal(call.opts.noRedirect, true); assert.ok(call.opts.signal);
  }
});

test('actual admission 409 neither deletes submission receipt nor claims essay was submitted', async () => {
  const h = harness(true), original = h.respond;
  h.respond = async (method, path) => { if (path.endsWith('/admissions')) throw Object.assign(Error('private SQL'), { status: 409 }); return original(method, path); };
  await h.open();
  assert.equal(h.removed.length, 0); assert.equal(h.refreshes, 0); assert.equal(h.renders.length, 0);
  assert.equal(h.notices[0].kind, 'warning'); assert.ok(!h.notices[0].message.includes('private SQL'));
  assert.equal(h.calls.some(c => c.path.endsWith('/start')), false);
});

test('actual bound readback after submission refreshes lists and never reopens editor', async () => {
  const h = harness(true), original = h.respond;
  h.respond = async (method, path) => path.endsWith('/admissions') ? h.ack('bound', 'submitted') : original(method, path);
  await h.open();
  assert.equal(h.renders.length, 0); assert.equal(h.refreshes, 2); assert.equal(h.notices[0].kind, 'success');
  assert.equal(h.calls.some(c => c.path.endsWith('/execute') || c.path.endsWith('/start')), false);
});

test('actual URL load without saved intent asks for explicit action and sends no admission', async () => {
  const h = harness(true); await h.open(false);
  assert.equal(h.rows.size, 0); assert.equal(h.calls.length, 2);
  assert.ok(h.calls[1].method === 'GET' && h.calls[1].path.endsWith('/entry'));
  assert.match(h.notices[0].message, /Bấm Bắt đầu/);
});

test('actual entry keeps pending intent when the public flag is rolled back', async () => {
  const h = harness(true), original = h.respond;
  h.respond = async (method, path) => { if (path.endsWith('/execute')) throw Error('lost ACK'); return original(method, path); };
  await h.open();
  h.window.__AVER_RUNTIME_CONFIG__.writingAdmissionEnabled = false;
  h.respond = original;
  await h.open(false);
  assert.ok(h.calls.some(c => c.method === 'GET' && c.path.includes('/admissions/')));
  assert.equal(h.calls.some(c => c.path.endsWith('/start')), false); assert.equal(h.renders.length, 1);
});

test('strict or pending admission cannot redirect into a legacy auto-start renderer', async () => {
  const h = harness(true);
  h.respond = async () => ({ renderer_affinity: 'legacy' });
  await h.open();
  assert.equal(h.notices[0].kind, 'warning'); assert.equal(h.calls.length, 1);
  assert.equal(h.renders.length, 0); assert.equal(h.rows.size, 0);
});

test('actual card click retains assignment URL so a lost ACK can recover after reload', async () => {
  const h = harness(true), original = h.respond;
  h.respond = async (method, path) => { if (path.endsWith('/execute')) throw Error('lost ACK'); return original(method, path); };
  const button = { closest: () => ({ getAttribute: name => name === 'data-assignment-id' ? h.assignment : 'next' }),
    addEventListener: (name, callback) => { h.click = callback; } };
  h.list = { innerHTML: '', querySelectorAll: () => [button] };
  h.renderCards(); h.click();
  assert.equal(new URL(h.window.location.href).searchParams.get('assignment_id'), h.assignment);
  for (let i = 0; i < 20 && !h.notices.length; i++) await new Promise(setImmediate);
  assert.equal(h.notices.length, 1); assert.equal(h.rows.size, 1);
  h.respond = original;
  await h.open(false);
  assert.equal(h.calls.at(-2).method, 'GET'); assert.ok(h.calls.at(-2).path.includes('/admissions/'));
  assert.equal(h.renders.length, 1);
});

test('loading a different assignment disables saves and clears stale displayed text only', async () => {
  const h = harness(true);
  h.nodes['modal-essay-textarea'] = { value: 'previous assignment text', dataset: {}, focus() {} };
  h.modal.assignmentId = h.assignment;
  h.modal.workspaceReady = false;
  await h.save();
  assert.equal(h.calls.length, 0);
  await h.open(false);
  assert.equal(h.nodes['modal-essay-textarea'].value, '');
  assert.equal(h.removed.length, 0);
  assert.equal(h.calls.some(call => call.path.endsWith('/draft')), false);
});

for (const withReceipt of [false, true]) {
  test('expired timer uses populated ' + (withReceipt ? 'pending receipt' : 'server draft') + ' before auto-submit', () => {
    const h = harness(true);
    h.nodes['modal-essay-textarea'] = { value: 'stale other assignment', dataset: {} };
    h.modal.assignmentId = h.assignment;
    if (withReceipt) h.window.WritingSubmitReceipt.read = () => ({ essayText: 'pending exact essay' });
    h.renderWorkspace({ assignment: { id: h.assignment, writing_prompts: { task_type: 'task2' } },
      draft: { draft_text: 'canonical saved draft' } }, { is_timed: true, time_limit_minutes: 40, is_expired: true });
    assert.equal(h.modal.workspaceReady, true);
    assert.deepEqual(h.submittedText, [withReceipt ? 'pending exact essay' : 'canonical saved draft']);
  });
}

test('late previous-workspace save failure cannot auto-submit the newly opened assignment', async () => {
  const h = harness(true);
  h.modal.assignmentId = h.assignment; h.modal.workspaceReady = true;
  h.nodes['modal-essay-textarea'] = { value: 'original draft', dataset: {} };
  let reject;
  h.respond = () => new Promise((resolve, fail) => { reject = fail; });
  const saving = h.save();
  assert.equal(h.calls[0].body.draft_text, 'original draft');
  h.modal.openGeneration++;
  h.modal.assignmentId = randomUUID();
  h.nodes['modal-essay-textarea'].value = 'new assignment text';
  reject(Error('Hết giờ'));
  await saving;
  assert.deepEqual(h.submittedText, []);
  assert.equal(h.calls.length, 1);
});

// ADMINAAL2-0032 T010 / FR-013 — the shared transport (public/js/api.js) sends
// a 403 `mfa_required` to /admin/mfa?next=<path+search> and announces an
// inactive staff 403. Runs the real api.js in a VM with a controlled fetch.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { ACCOUNT_INACTIVE_EVENT, INACTIVE_DETAIL, adminMfaUrl } from '../lib/admin-mfa-model.mjs';

const source = readFileSync(new URL('../public/js/api.js', import.meta.url), 'utf8');
const MFA_DETAIL = { code: 'mfa_required', next_step: 'challenge', message: 'Cần xác thực 2 bước để dùng quyền admin.' };

function load({ pathname = '/admin/users', search = '?tab=codes', status = 403, detail = MFA_DETAIL } = {}) {
  const nav = { replaced: [], href: [], events: [] };
  const window = {
    location: {
      hostname: 'mfa-fixture.invalid', pathname, search,
      replace(value) { nav.replaced.push(value); },
      set href(value) { nav.href.push(value); },
    },
    __AVER_RUNTIME_CONFIG__: { apiBase: 'https://mfa-fixture.invalid' },
    __AVER_SUPABASE_CLIENT__: { auth: { getSession: async () => ({ data: { session: { access_token: 'fixture-token' } } }) } },
    dispatchEvent(event) { nav.events.push(event.type); return true; },
  };
  const fetch = async () => new Response(JSON.stringify({ detail }), { status, headers: { 'content-type': 'application/json' } });
  vm.runInNewContext(source, { window, fetch, console, CustomEvent: globalThis.CustomEvent });
  return { api: window.api, nav };
}

test('403 mfa_required navigates to /admin/mfa with the current path + search and still rejects', async () => {
  const { api, nav } = load();
  await assert.rejects(api.get('/admin/users'), (error) => {
    assert.equal(error.status, 403);
    assert.deepEqual({ ...error.detail }, MFA_DETAIL);
    assert.equal(error.message, MFA_DETAIL.message);
    return true;
  });
  assert.deepEqual(nav.replaced, [adminMfaUrl('/admin/users', '?tab=codes')]);
  assert.deepEqual(nav.replaced, ['/admin/mfa?next=%2Fadmin%2Fusers%3Ftab%3Dcodes']);
  assert.deepEqual(nav.href, []);
});

test('mutations navigate too (any admin call after load)', async () => {
  const { api, nav } = load({ pathname: '/admin/classes/c1', search: '' });
  await assert.rejects(api.patch('/admin/users/u1/role', { role: 'user' }), (error) => error.status === 403);
  assert.deepEqual(nav.replaced, ['/admin/mfa?next=%2Fadmin%2Fclasses%2Fc1']);
});

test('/admin/mfa itself never navigates (no loop)', async () => {
  const { api, nav } = load({ pathname: '/admin/mfa', search: '?next=%2Fadmin' });
  await assert.rejects(api.get('/admin/mfa/status'), (error) => error.status === 403);
  assert.deepEqual(nav.replaced, []);
});

test('noRedirect callers keep the error and stay on the page', async () => {
  const { api, nav } = load();
  await assert.rejects(api.getWith('/admin/users', undefined, { noRedirect: true }), (error) => error.status === 403);
  assert.deepEqual(nav.replaced, []);
});

test('other 403s are unchanged: no navigation, no event', async () => {
  const { api, nav } = load({ detail: 'Admin only' });
  await assert.rejects(api.get('/admin/users'), (error) => error.status === 403 && error.detail === 'Admin only');
  const other = load({ detail: { code: 'last_admin' } });
  await assert.rejects(other.api.get('/admin/users'), (error) => error.status === 403);
  assert.deepEqual([...nav.replaced, ...nav.events, ...other.nav.replaced, ...other.nav.events], []);
});

test('an inactive staff 403 announces the denied state and rejects', async () => {
  const { api, nav } = load({ detail: INACTIVE_DETAIL });
  await assert.rejects(api.get('/admin/users'), (error) => error.status === 403 && error.detail === INACTIVE_DETAIL);
  assert.deepEqual(nav.events, [ACCOUNT_INACTIVE_EVENT]);
  assert.deepEqual(nav.replaced, []);
});

test('api.js mirrors the model constants it cannot import', () => {
  assert.ok(source.includes(`'${ACCOUNT_INACTIVE_EVENT}'`));
  assert.ok(source.includes(`'${INACTIVE_DETAIL}'`));
});

// ── Amendment 1 (FR-020): 403 step_up_required → TOTP prompt → one resend ──

const STEP_UP_DETAIL = {
  code: 'step_up_required', next_step: 'challenge', max_age_seconds: 900,
  message: 'Thao tác này cần nhập lại mã xác thực 2 bước.',
};
const STEP_UP_EVENT = 'aver:admin-step-up-required';

/** api.js with a scripted fetch and a page listener `onStepUp(event)`. */
function loadStepUp({ responses, onStepUp = null }) {
  const sent = [];
  const prompts = [];
  let token = 'aal2-old';
  const window = {
    location: { hostname: 'mfa-fixture.invalid', pathname: '/admin/users', search: '', replace() {}, set href(_v) {} },
    __AVER_RUNTIME_CONFIG__: { apiBase: 'https://mfa-fixture.invalid' },
    __AVER_SUPABASE_CLIENT__: { auth: { getSession: async () => ({ data: { session: { access_token: token } } }) } },
    dispatchEvent(event) {
      if (event.type !== STEP_UP_EVENT) return true;
      prompts.push(event.detail.maxAgeSeconds);
      if (onStepUp) onStepUp(event, { renewToken: () => { token = 'aal2-fresh'; } });
      return !event.defaultPrevented;
    },
  };
  const fetch = async (url, init) => {
    sent.push({ url, method: init.method, body: init.body, auth: init.headers.Authorization });
    const next = responses.shift();
    assert.ok(next, `unexpected request ${url}`);
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { 'content-type': 'application/json' } });
  };
  vm.runInNewContext(source, { window, fetch, console, CustomEvent: globalThis.CustomEvent, setTimeout });
  return { api: window.api, sent, prompts };
}

const refused = () => ({ status: 403, body: { detail: STEP_UP_DETAIL } });
const verifyThen = (ok) => (event, { renewToken }) => {
  event.preventDefault();
  queueMicrotask(() => { if (ok) renewToken(); event.detail.resolve(ok); });
};

test('step_up_required: after a verified code the SAME request is resent once with the new token', async () => {
  const { api, sent, prompts } = loadStepUp({
    responses: [refused(), { status: 200, body: { ok: true, role: 'student' } }],
    onStepUp: verifyThen(true),
  });
  assert.deepEqual({ ...(await api.patch('/admin/users/u1/role', { role: 'student' })) }, { ok: true, role: 'student' });
  assert.deepEqual(prompts, [900]);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent.map((s) => [s.method, s.url, s.body]), [
    ['PATCH', 'https://mfa-fixture.invalid/admin/users/u1/role', '{"role":"student"}'],
    ['PATCH', 'https://mfa-fixture.invalid/admin/users/u1/role', '{"role":"student"}'],
  ]);
  assert.deepEqual(sent.map((s) => s.auth), ['Bearer aal2-old', 'Bearer aal2-fresh']);
});

test('step_up_required: a second refusal after the resend is thrown, never sent a third time', async () => {
  const { api, sent, prompts } = loadStepUp({ responses: [refused(), refused()], onStepUp: verifyThen(true) });
  await assert.rejects(api.post('/admin/users/u1/revoke-sessions', {}), (error) => {
    assert.equal(error.status, 403);
    assert.equal(error.detail.code, 'step_up_required');
    assert.equal(error.message, STEP_UP_DETAIL.message);
    return true;
  });
  assert.equal(sent.length, 2);
  assert.deepEqual(prompts, [900]);
});

test('step_up_required: a closed prompt rejects without a resend', async () => {
  const { api, sent } = loadStepUp({ responses: [refused()], onStepUp: verifyThen(false) });
  await assert.rejects(api.patch('/admin/users/u1/active', { is_active: false, reason: 'abc' }),
    (error) => error.status === 403 && error.detail.code === 'step_up_required');
  assert.equal(sent.length, 1);
});

test('step_up_required with no page to ask (unclaimed event) rejects at once', async () => {
  const { api, sent, prompts } = loadStepUp({ responses: [refused()] });
  await assert.rejects(api.patch('/admin/users/u1/role', { role: 'student' }), (error) => error.status === 403);
  assert.equal(sent.length, 1);
  assert.deepEqual(prompts, [900]);
});

test('noRedirect and keepalive callers get the refusal without a prompt', async () => {
  const first = loadStepUp({ responses: [refused()], onStepUp: verifyThen(true) });
  await assert.rejects(first.api.patchWith('/admin/users/u1/role', { role: 'student' }, undefined, { noRedirect: true }),
    (error) => error.status === 403);
  assert.deepEqual([first.sent.length, first.prompts.length], [1, 0]);
  const second = loadStepUp({ responses: [refused()], onStepUp: verifyThen(true) });
  await assert.rejects(second.api.patchWith('/admin/users/u1/role', { role: 'student' }, undefined, { keepalive: true }),
    (error) => error.status === 403);
  assert.deepEqual([second.sent.length, second.prompts.length], [1, 0]);
});

test('concurrent refusals share one prompt and each request is resent once', async () => {
  let resolveLater;
  const { api, sent, prompts } = loadStepUp({
    responses: [refused(), refused(), { status: 200, body: { ok: 1 } }, { status: 200, body: { ok: 2 } }],
    onStepUp: (event, { renewToken }) => {
      event.preventDefault();
      resolveLater = () => { renewToken(); event.detail.resolve(true); };
    },
  });
  const a = api.patch('/admin/users/u1/role', { role: 'student' });
  const b = api.patch('/admin/users/u2/role', { role: 'student' });
  while (!resolveLater || sent.length < 2) await new Promise((r) => setTimeout(r, 1));
  resolveLater();
  const results = await Promise.all([a, b]);
  assert.deepEqual(results.map((r) => r.ok).sort(), [1, 2]);
  assert.deepEqual(prompts, [900]);
  assert.equal(sent.length, 4);
});

test('api.js mirrors the gate step-up event name', () => {
  const gate = readFileSync(new URL('../components/admin-access-gate.tsx', import.meta.url), 'utf8');
  assert.ok(source.includes(`'${STEP_UP_EVENT}'`));
  assert.ok(gate.includes(`'${STEP_UP_EVENT}'`));
});

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

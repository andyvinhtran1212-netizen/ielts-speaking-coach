// ACCOUNTDATA-0100 FR-003 (ui-states.md): a 403 `account_deletion_pending`
// from any learner route sends the page to /account, where the notice with
// "Huỷ yêu cầu xoá" lives. Runs the real api.js in a VM.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/js/api.js', import.meta.url), 'utf8');
const PENDING = { error_code: 'account_deletion_pending', message: 'Tài khoản của bạn đang chờ xoá.' };

function load({ pathname = '/writing', detail = PENDING, status = 403 } = {}) {
  const nav = { replaced: [], href: [], events: [] };
  const window = {
    location: {
      hostname: 'deletion-fixture.invalid', pathname, search: '',
      replace(value) { nav.replaced.push(value); },
      set href(value) { nav.href.push(value); },
    },
    __AVER_RUNTIME_CONFIG__: { apiBase: 'https://deletion-fixture.invalid' },
    __AVER_SUPABASE_CLIENT__: { auth: { getSession: async () => ({ data: { session: { access_token: 'fixture-token' } } }) } },
    dispatchEvent(event) { nav.events.push(event.type); return true; },
  };
  const fetch = async () => new Response(JSON.stringify({ detail }), { status, headers: { 'content-type': 'application/json' } });
  vm.runInNewContext(source, { window, fetch, console, CustomEvent: globalThis.CustomEvent });
  return { api: window.api, nav };
}

test('a pending-deletion 403 goes to /account once per page and still throws with the detail', async () => {
  const { api, nav } = load();
  await assert.rejects(api.get('/api/me/courses'), (error) => error.status === 403 && error.detail.error_code === 'account_deletion_pending');
  await assert.rejects(api.get('/api/me/credits'));
  assert.deepEqual(nav.replaced, ['/account']);
  assert.deepEqual(nav.href, []);
});

test('on /account itself nothing moves (the page reads the request first)', async () => {
  const { api, nav } = load({ pathname: '/account' });
  await assert.rejects(api.get('/api/me/courses'));
  assert.deepEqual([...nav.replaced, ...nav.href], []);
});

test('noRedirect callers and every other 403 keep their old behaviour', async () => {
  {
    const { api, nav } = load();
    await assert.rejects(api.getWith('/api/me/courses', undefined, { noRedirect: true }));
    assert.deepEqual([...nav.replaced, ...nav.href], []);
  }
  for (const detail of [{ error_code: 'staff_account_not_self_deletable' }, 'Forbidden', { code: 'other' }]) {
    const { api, nav } = load({ detail });
    await assert.rejects(api.get('/api/me/courses'));
    assert.deepEqual([...nav.replaced, ...nav.href], []);
  }
});

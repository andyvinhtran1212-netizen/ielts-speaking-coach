// ENROLL-0060 G05-T20 (FR-052): the shared transport announces a 401
// `session_displaced` instead of bouncing to /login; other 401s are unchanged.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { DISPLACED_LOGIN_PATH, SESSION_DISPLACED_EVENT } from '../lib/auth/session-claim.mjs';

const source = readFileSync(new URL('../public/js/api.js', import.meta.url), 'utf8');
const DISPLACED = { error_code: 'session_displaced', displaced_at: '2026-11-23T02:05:00Z' };

function load({ detail = DISPLACED, claim = false, raw = null } = {}) {
  const nav = { replaced: [], href: [], events: [] };
  const window = {
    location: {
      hostname: 'displaced-fixture.invalid', pathname: '/writing', search: '',
      replace(value) { nav.replaced.push(value); },
      set href(value) { nav.href.push(value); },
    },
    __AVER_RUNTIME_CONFIG__: { apiBase: 'https://displaced-fixture.invalid' },
    __AVER_SUPABASE_CLIENT__: { auth: { getSession: async () => ({ data: { session: { access_token: 'fixture-token' } } }) } },
    dispatchEvent(event) {
      nav.events.push({ type: event.type, cancelable: event.cancelable, detail: event.detail });
      if (claim) event.preventDefault();
      return !event.defaultPrevented;
    },
  };
  const fetch = async () => (raw !== null
    ? new Response(raw, { status: 401, headers: { 'content-type': 'text/html' } })
    : new Response(JSON.stringify({ detail }), { status: 401, headers: { 'content-type': 'application/json' } }));
  vm.runInNewContext(source, { window, fetch, console, CustomEvent: globalThis.CustomEvent });
  return { api: window.api, nav };
}

test('claimed: one cancelable event with displaced_at, no navigation, the call resolves null', async () => {
  const { api, nav } = load({ claim: true });
  assert.equal(await api.get('/api/me/courses'), null);
  assert.equal(await api.get('/api/me/credits'), null);
  assert.equal(nav.events.length, 1);
  assert.equal(nav.events[0].type, SESSION_DISPLACED_EVENT);
  assert.equal(nav.events[0].cancelable, true);
  assert.equal(nav.events[0].detail.displacedAt, DISPLACED.displaced_at);
  assert.deepEqual([...nav.replaced, ...nav.href], []);
});

test('unclaimed (no AuthProvider on the page): straight to the 8c notice', async () => {
  const { api, nav } = load();
  await api.get('/api/me/courses');
  assert.deepEqual(nav.replaced, [DISPLACED_LOGIN_PATH]);
  assert.deepEqual(nav.href, []);
});

test('any other 401 keeps the old bounce to /login, no event', async () => {
  for (const detail of ['Not authenticated', { error_code: 'token_expired' }, null]) {
    const { api, nav } = load({ detail });
    await api.get('/api/me/courses');
    assert.deepEqual(nav.href, ['/login']);
    assert.deepEqual([...nav.replaced, ...nav.events], []);
  }
});

test('a 401 whose body is not JSON (a proxy page, or empty) keeps the old bounce', async () => {
  for (const raw of ['<html><body>401 Unauthorized</body></html>', '']) {
    const { api, nav } = load({ raw });
    await api.get('/api/me/courses');
    assert.deepEqual(nav.href, ['/login']);
    assert.deepEqual([...nav.replaced, ...nav.events], []);
  }
});

test('api.js mirrors the model constants it cannot import', () => {
  assert.ok(source.includes(`'${SESSION_DISPLACED_EVENT}'`));
  assert.ok(source.includes(`'${DISPLACED_LOGIN_PATH}'`));
});

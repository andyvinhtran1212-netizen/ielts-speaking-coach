// ENROLL-0060 FR-060 (G05-T22) — window.api.deleteWith sends a DELETE with a
// JSON body (the mail-link unsubscribe token travels in the body, not the URL).
// Runs the real public/js/api.js in a VM with a recording fetch.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/js/api.js', import.meta.url), 'utf8');

function load(status = 200, payload = { ok: true }) {
  const sent = [];
  const nav = [];
  const window = {
    location: { hostname: 'delete-fixture.invalid', pathname: '/courses/ielts-7', search: '', set href(v) { nav.push(v); } },
    __AVER_RUNTIME_CONFIG__: { apiBase: 'https://delete-fixture.invalid' },
    __AVER_SUPABASE_CLIENT__: { auth: { getSession: async () => ({ data: { session: null } }) } },
    dispatchEvent() { return true; },
  };
  const fetch = async (url, init) => {
    sent.push({ url, method: init.method, body: init.body, contentType: init.headers['Content-Type'] });
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
  };
  vm.runInNewContext(source, { window, fetch, console, CustomEvent: globalThis.CustomEvent });
  return { api: window.api, sent, nav };
}

test('deleteWith sends DELETE with the JSON body and returns the parsed answer', async () => {
  const { api, sent } = load();
  assert.deepEqual({ ...(await api.deleteWith('/api/courses/ielts-7/open-alerts', { unsubscribe_token: 'abc' })) }, { ok: true });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://delete-fixture.invalid/api/courses/ielts-7/open-alerts');
  assert.equal(sent[0].method, 'DELETE');
  assert.equal(sent[0].body, JSON.stringify({ unsubscribe_token: 'abc' }));
  assert.equal(sent[0].contentType, 'application/json');
});

test('deleteWith with noRedirect rejects a 401 instead of bouncing to /login', async () => {
  const { api, nav } = load(401, { detail: { error_code: 'login_required', message: 'x' } });
  await assert.rejects(api.deleteWith('/api/courses/ielts-7/open-alerts', {}, undefined, { noRedirect: true }), (e) => e.status === 401);
  assert.deepEqual(nav, []);
});

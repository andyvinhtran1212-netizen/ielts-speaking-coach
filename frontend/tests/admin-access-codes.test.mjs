/**
 * frontend/tests/admin-access-codes.test.mjs
 *
 * LEGACYJS-0075 W3a: the legacy controller `public/js/admin-access-codes.js`
 * and its retired page are gone; `/admin/access-codes` redirects to
 * `/admin/users?tab=codes`, owned by the Next panel below. The page-shape pins
 * moved to `admin-users-next-behavior.test.mjs`; this file keeps the code
 * lifecycle invariants the legacy pins carried, on the Next owner, and the
 * shared-transport step-up contract (Amendment 2).
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...rel) => readFileSync(join(__dirname, '..', ...rel), 'utf8');

const CODES = read('app', '(authed-admin-users)', 'admin', 'users', 'admin-access-codes-panel.tsx');

describe('access codes — legacy controller retired (LEGACYJS-0075 W3a)', () => {
  it('the legacy controller and helper module are deleted', () => {
    assert.equal(existsSync(join(__dirname, '..', 'public', 'js', 'admin-access-codes.js')), false);
    assert.equal(existsSync(join(__dirname, '..', 'public', 'js', 'admin-codes-util.js')), false);
  });
});

describe('access codes — lifecycle on the Next owner', () => {
  it('editing a code PATCHes permissions + session_limit only, never redemption fields', () => {
    assert.match(CODES, /window\.api\.patch\(`\/admin\/access-codes\/\$\{encodeURIComponent\(edit\.code\.id\)\}`, \{\s*permissions: edit\.permissions,\s*session_limit: validation\.sessionLimit,?\s*\}\)/);
    assert.doesNotMatch(CODES, /used_by\s*:|used_at\s*:|is_used\s*:/);
  });
  it('removing a user names that user and states that activation history is kept', () => {
    assert.match(CODES, /Gỡ \$\{user\.email \|\| user\.name \|\| 'người dùng này'\} khỏi mã/);
    assert.match(CODES, /lịch sử kích hoạt vẫn được giữ/);
    assert.match(CODES, /window\.api\.delete\(`\/admin\/access-codes\/\$\{encodeURIComponent\(code\.id\)\}\/users\/\$\{encodeURIComponent\(user\.user_id\)\}`\)/);
  });
  it('revoking a code toasts and refetches in place, never a full page reload', () => {
    assert.match(CODES, /'Đã thu hồi mã\.'/);
    assert.match(CODES, /await action\(\);[\s\S]+await loadCodes\(true\)/);
    assert.doesNotMatch(CODES, /location\.reload|window\.location\s*=/);
  });
});


// ── ADMINAAL2-0032 Amendment 2 (FR-020 option c, spec.md AC14) ──────────────
// A role-granting code goes through the shared transport (public/js/api.js)
// against a stateful fixture backend. A stale-TOTP refusal prompts once and
// resends once; a cool-off refusal waits (no prompt, no resend). The list
// read right after the action and after a reload (a fresh transport) both
// match the persisted fixture state: no code is created by a refusal.

import vm from 'node:vm';

const API_SOURCE = read('public', 'js', 'api.js');
const STEP_UP_EVENT = 'aver:admin-step-up-required';
const STALE = { code: 'step_up_required', next_step: 'challenge', max_age_seconds: 900,
  message: 'Thao tác này cần nhập lại mã xác thực 2 bước.' };
const COOLOFF = { ...STALE, reason: 'new_factor_cooloff',
  message: 'Phương thức xác thực 2 bước vừa được thêm hoặc thay đổi. Vui lòng chờ đủ 24 giờ kể từ lúc đó rồi thực hiện lại thao tác này.' };

/** Persisted fixture state shared by every "page load". */
function fixtureBackend({ cooloff }) {
  const state = { codes: [{ id: 'c-0', code: 'OLD0-OLD0-OLD0', grants_role: null }], posts: [] };
  return {
    state,
    async handle(url, init) {
      const path = new URL(url).pathname;
      const auth = init.headers.Authorization;
      const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      if (init.method === 'GET' && path === '/admin/access-codes') return json(200, { codes: state.codes });
      if (init.method === 'POST' && path === '/admin/access-codes/generate') {
        state.posts.push(auth);
        const body = JSON.parse(init.body);
        const granting = ((body.grants_role || '').trim().toLowerCase() || null) !== null;
        if (granting && cooloff) return json(403, { detail: COOLOFF });
        if (granting && auth !== 'Bearer aal2-fresh') return json(403, { detail: STALE });
        const code = { id: `c-${state.codes.length}`, code: `NEW${state.codes.length}-AAAA-BBBB`, grants_role: body.grants_role ?? null };
        state.codes.push(code);
        return json(200, { created: 1, codes: [code.code] });
      }
      throw new Error(`unexpected ${init.method} ${path}`);
    },
  };
}

/** One page load: a fresh api.js over the shared backend. */
function pageLoad(backend, { verify = true } = {}) {
  let token = 'aal2-old';
  const prompts = [];
  const window = {
    location: { hostname: 'codes-fixture.invalid', pathname: '/admin/users', search: '?tab=codes', replace() {}, set href(_v) {} },
    __AVER_RUNTIME_CONFIG__: { apiBase: 'https://codes-fixture.invalid' },
    __AVER_SUPABASE_CLIENT__: { auth: { getSession: async () => ({ data: { session: { access_token: token } } }) } },
    dispatchEvent(event) {
      if (event.type !== STEP_UP_EVENT) return true;
      prompts.push(event.detail.maxAgeSeconds);
      event.preventDefault();
      queueMicrotask(() => { if (verify) token = 'aal2-fresh'; event.detail.resolve(verify); });
      return false;
    },
  };
  vm.runInNewContext(API_SOURCE, { window, fetch: (u, i) => backend.handle(u, i), console, CustomEvent: globalThis.CustomEvent, setTimeout });
  return { api: window.api, prompts };
}

const ROLE_CODE = { count: 1, grants_role: 'instructor', intended_email: 'gv@example.test' };
// Spread: the response arrays belong to the VM realm.
const listCodes = async (api) => [...(await api.get('/admin/access-codes')).codes].map((c) => c.code);

describe('Amendment 2 — role-granting code generation through the shared transport', () => {
  it('stale TOTP: prompts once, resends once, and the immediate and reloaded lists show the code', async () => {
    const backend = fixtureBackend({ cooloff: false });
    const page = pageLoad(backend);
    const out = await page.api.post('/admin/access-codes/generate', ROLE_CODE);
    assert.equal(out.created, 1);
    assert.deepEqual(page.prompts, [900]);
    assert.deepEqual(backend.state.posts, ['Bearer aal2-old', 'Bearer aal2-fresh']);
    const immediate = await listCodes(page.api);
    assert.deepEqual(immediate, ['OLD0-OLD0-OLD0', out.codes[0]]);
    assert.deepEqual(await listCodes(pageLoad(backend).api), immediate);
  });

  it('closed prompt: refused, sent once, no code before or after reload', async () => {
    const backend = fixtureBackend({ cooloff: false });
    const page = pageLoad(backend, { verify: false });
    await assert.rejects(page.api.post('/admin/access-codes/generate', ROLE_CODE),
      (error) => error.status === 403 && error.detail.code === 'step_up_required');
    assert.equal(backend.state.posts.length, 1);
    assert.deepEqual(await listCodes(page.api), ['OLD0-OLD0-OLD0']);
    assert.deepEqual(await listCodes(pageLoad(backend).api), ['OLD0-OLD0-OLD0']);
  });

  it('cool-off: the wait message, no prompt, no resend, no code before or after reload', async () => {
    const backend = fixtureBackend({ cooloff: true });
    const page = pageLoad(backend);
    await assert.rejects(page.api.post('/admin/access-codes/generate', ROLE_CODE), (error) => {
      assert.equal(error.status, 403);
      assert.equal(error.detail.reason, 'new_factor_cooloff');
      assert.equal(error.message, COOLOFF.message);
      return true;
    });
    assert.deepEqual(page.prompts, []);
    assert.equal(backend.state.posts.length, 1);
    assert.deepEqual(await listCodes(page.api), ['OLD0-OLD0-OLD0']);
    assert.deepEqual(await listCodes(pageLoad(backend).api), ['OLD0-OLD0-OLD0']);
  });

  it('ordinary code (no grants_role): created at once, no prompt', async () => {
    const backend = fixtureBackend({ cooloff: true });
    const page = pageLoad(backend);
    const out = await page.api.post('/admin/access-codes/generate', { count: 1, permissions: ['all'] });
    assert.equal(out.created, 1);
    assert.deepEqual(page.prompts, []);
    assert.deepEqual(await listCodes(pageLoad(backend).api), ['OLD0-OLD0-OLD0', out.codes[0]]);
  });
});

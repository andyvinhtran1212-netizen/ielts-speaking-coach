import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/js/api.js', import.meta.url), 'utf8');

function setup(fetch) {
  const effects = [];
  const window = {
    location: {
      hostname: 'attention-fixture.invalid',
      pathname: '/admin',
      set href(path) { effects.push(path); },
      replace(path) { effects.push(path); },
    },
    __AVER_SUPABASE_CLIENT__: {
      auth: { getSession: async () => ({ data: { session: null } }) },
    },
    dispatchEvent(event) { effects.push(event.type); return true; },
  };
  vm.runInNewContext(source, { window, fetch, console, CustomEvent });
  return { api: window.api, effects };
}

for (const cancelled of [false, true]) {
  test(`401 ${cancelled ? 'ignores a cancelled read' : 'redirects an active read'}`, async () => {
    const controller = new AbortController();
    const { api, effects } = setup(async (_url, options) => {
      assert.equal(options.signal, controller.signal);
      if (cancelled) controller.abort();
      return new Response('{}', { status: 401 });
    });
    const request = api.getWith('/admin/attention', undefined, { signal: controller.signal });
    if (cancelled) await assert.rejects(request, { status: 401 });
    else assert.equal(await request, null);
    assert.deepEqual(effects, cancelled ? [] : ['/login']);
  });

  for (const [detail, expected] of [
    [{ code: 'mfa_required' }, '/admin/mfa?next=%2Fadmin'],
    ['Tài khoản chưa được kích hoạt', 'aver:account-inactive'],
  ]) {
    test(`403 ${cancelled ? 'ignores a cancelled read' : 'keeps the active effect'} for ${expected}`, async () => {
      const controller = new AbortController();
      // Here fetch already returned headers. The session changes while the body is read.
      const { api, effects } = setup(async () => ({
        ok: false,
        status: 403,
        json: async () => {
          if (cancelled) controller.abort();
          return { detail };
        },
      }));
      await assert.rejects(api.getWith('/admin/attention', undefined, { signal: controller.signal }), { status: 403 });
      assert.deepEqual(effects, cancelled ? [] : [expected]);
    });
  }
}

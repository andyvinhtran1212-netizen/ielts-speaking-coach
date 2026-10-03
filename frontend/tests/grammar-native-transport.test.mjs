// Exact existing API transport + typed bridge, controlled fetch promises only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { quizPlayerApi } from '../lib/quiz-player-api.ts';
const source = readFileSync(new URL('../public/js/api.js', import.meta.url), 'utf8');
const methods = {
  banks: (api) => api.banks('?skill_area=grammar'), bank: (api) => api.bank('owned-bank'),
  resume: (api) => api.resume('owned-bank'), start: (api) => api.start({ bank_id: 'owned-bank', kind: 'run' }),
  progress: (api) => api.progress('owned-session', { attempts: [], word_stats: [] }),
  end: (api) => api.end('owned-session', { attempts: [], ended_by: 'paused' }), reset: (api) => api.reset('owned-bank'),
};
for (const [method, call] of Object.entries(methods)) for (const transition of ['active', 'aborted', 'query-render-before-cleanup', 'account-render-before-cleanup', 'ABA-new-epoch']) {
  test(`${method}: fulfilled 401 navigation belongs only to current ${transition} scope`, async () => {
    const previousWindow = globalThis.window, controller = new AbortController();
    const old = { epoch: 1, account: 'a', query: 'A' };
    let current = old, renderAccount = 'a', renderQuery = 'A', release, fetched = false, redirects = 0;
    const window = {
      location: { hostname: 'quiz-fixture.invalid', pathname: '/quiz', set href(value) { assert.equal(value, '/login'); redirects++; } },
      __AVER_RUNTIME_CONFIG__: { apiBase: 'https://quiz-fixture.invalid' },
      __AVER_SUPABASE_CLIENT__: { auth: { getSession: async () => ({ data: { session: { access_token: 'fixture-token' } } }) } },
    };
    const fetch = (_url, options) => { assert.equal(options.signal, controller.signal); fetched = true; return new Promise((resolve) => { release = resolve; }); };
    vm.runInNewContext(source, { window, fetch, console }); globalThis.window = window;
    try {
      const bridge = quizPlayerApi(controller.signal, () => current === old && renderAccount === old.account && renderQuery === old.query);
      const pending = call(bridge);
      pending.catch(() => {});
      const deadline = Date.now() + 5_000;
      while (!fetched) { if (Date.now() >= deadline) throw new Error('Shared transport did not reach its controlled fetch boundary'); await new Promise((resolve) => setImmediate(resolve)); }
      release(new Response('{"detail":"fixture unauthorized"}', { status: 401, headers: { 'content-type': 'application/json' } }));
      if (transition === 'aborted') controller.abort();
      if (transition === 'query-render-before-cleanup') renderQuery = 'B';
      if (transition === 'account-render-before-cleanup') renderAccount = 'b';
      if (transition === 'ABA-new-epoch') current = { ...old, epoch: 3 };
      await assert.rejects(pending, (error) => error.status === 401);
      assert.equal(redirects, transition === 'active' ? 1 : 0);
      if (transition.includes('before-cleanup') || transition.includes('epoch')) assert.equal(controller.signal.aborted, false);
    } finally { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; }
  });
}
test('shared default callers still redirect active401 without this bridge opt-in', async () => {
  let redirects = 0;
  const window = { location: { hostname: 'quiz-fixture.invalid', pathname: '/quiz', set href(value) { assert.equal(value, '/login'); redirects++; } }, __AVER_SUPABASE_CLIENT__: { auth: { getSession: async () => ({ data: { session: null } }) } } };
  vm.runInNewContext(source, { window, fetch: async () => new Response('{}', { status: 401 }), console });
  assert.equal(await window.api.get('/api/legacy'), null); assert.equal(redirects, 1);
});

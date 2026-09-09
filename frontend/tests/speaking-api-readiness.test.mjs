import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { isSpeakingApiReady } from '../lib/speaking-api-readiness.mjs';
import { whenGlobalReady } from '../lib/when-global-ready.mjs';

test('API methods alone do not allow protected Speaking requests', () => {
  assert.equal(isSpeakingApiReady(undefined), false);
  assert.equal(isSpeakingApiReady({ api: { get() {} } }), false);
  assert.equal(isSpeakingApiReady({ api: { get() {} }, getSupabase: () => null }), false);
  assert.equal(isSpeakingApiReady({ api: { get() {} }, getSupabase: () => ({ auth: {} }) }), false);
});

test('client readiness does not itself read or trust an auth token', () => {
  let sessionReads = 0;
  const client = { auth: { getSession() { sessionReads++; } } };
  assert.equal(isSpeakingApiReady({ getSupabase: () => client }), false);
  assert.equal(isSpeakingApiReady({ api: { get() {} }, getSupabase: () => client }), true);
  assert.equal(sessionReads, 0, 'the actual API request, not the readiness probe, owns session lookup');
});

test('a delayed shared client blocks the protected request until initialization', async () => {
  let client = null;
  let elapsed = 0;
  const requests = [];
  const browser = {
    api: { get() { requests.push({ clientReady: Boolean(client) }); } },
    getSupabase: () => client,
  };
  const ready = await whenGlobalReady(() => isSpeakingApiReady(browser), 'Speaking auth runtime', {
    now: () => elapsed,
    sleep: async ms => {
      assert.equal(requests.length, 0, 'no protected request during the bootstrap gap');
      elapsed += ms;
      if (elapsed >= 750) client = { auth: { getSession() {} } };
    },
    report: message => assert.fail(message),
  });
  assert.equal(ready, true);
  assert.ok(elapsed >= 750);
  browser.api.get();
  assert.deepEqual(requests, [{ clientReady: true }]);
});

test('missing auth initialization times out visibly without enabling requests', async () => {
  let elapsed = 0;
  let reports = 0;
  const browser = { api: { get() { assert.fail('must not issue request'); } }, getSupabase: () => null };
  const ready = await whenGlobalReady(() => isSpeakingApiReady(browser), 'Speaking auth runtime', {
    timeoutMs: 100,
    now: () => elapsed,
    sleep: async ms => { elapsed += ms; },
    report: () => { reports++; },
  });
  assert.equal(ready, false);
  assert.equal(reports, 1);
});

test('Speaking uses the tested predicate without delaying synchronous controls', () => {
  const source = readFileSync(new URL('../app/(authed-speaking)/speaking/speaking-behavior.tsx', import.meta.url), 'utf8');
  assert.match(source, /import \{ isSpeakingApiReady \} from '@\/lib\/speaking-api-readiness\.mjs'/);
  assert.match(source, /whenGlobalReady\(\s*\(\) => isSpeakingApiReady\(window\)/);
  const binding = source.indexOf("on($('prac-topic-start'), 'click'");
  const validation = source.indexOf('Vui lòng chọn hoặc nhập chủ đề.', binding);
  const requestWait = source.indexOf('await resolveRuntimeApi()', binding);
  assert.ok(binding >= 0 && validation > binding && requestWait > validation);
});

test('the actual component resolver shares pending work and recovers after timeout', async () => {
  const source = readFileSync(new URL('../app/(authed-speaking)/speaking/speaking-behavior.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('const resolveRuntimeApi = () => {');
  const end = source.indexOf('\n    };', start);
  assert.ok(start >= 0 && end > start);
  const resolver = source.slice(start, end + '\n    };'.length);
  // Execute the resolver from the component, not a reimplementation of it.
  const compiled = ts.transpileModule(`
    let runtimeApi: any | null = null;
    let runtimeApiPromise: Promise<any | null> | null = null;
    const st = { dead: false };
    ${resolver}
    return resolveRuntimeApi;
  `, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  let finish;
  let waits = 0;
  const runtime = { api: { get() {} }, getSupabase: () => ({ auth: { getSession() {} } }) };
  const wait = () => { waits++; return new Promise(resolve => { finish = resolve; }); };
  const resolve = new Function('window', 'whenGlobalReady', 'isSpeakingApiReady', compiled)(runtime, wait, isSpeakingApiReady);
  const first = resolve();
  assert.equal(resolve(), first, 'concurrent users share one readiness attempt');
  assert.equal(waits, 1);
  finish(false);
  assert.equal(await first, null);
  const retry = resolve();
  assert.notEqual(retry, first);
  assert.equal(waits, 2);
  finish(true);
  assert.equal(await retry, runtime.api);
  assert.equal(await resolve(), runtime.api);
  assert.equal(waits, 2, 'successful runtime is reused');
});

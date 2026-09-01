import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../public/js/legacy-retirement-beacon.js', import.meta.url), 'utf8');

async function execute({
  hostname = 'www.averlearning.com',
  pathname = '/pages/example.html',
  readyState = 'complete',
  runtimeConfig = undefined,
  apiBase = undefined,
  pageViewSent = false,
} = {}) {
  const requests = [];
  let domReadyHandler = null;
  const window = {
    aver: pageViewSent ? { _pageViewSent: true } : {},
    location: { hostname, pathname, search: '?secret=must-not-leak' },
    __AVER_RUNTIME_CONFIG__: runtimeConfig,
    api: apiBase ? { base: apiBase } : undefined,
    fetch(url, options) {
      requests.push({ url, options });
      return Promise.resolve({ ok: true });
    },
  };
  const document = {
    readyState,
    addEventListener(name, handler, options) {
      if (name === 'DOMContentLoaded') domReadyHandler = { handler, options };
    },
  };
  vm.runInNewContext(SOURCE, { window, document });
  return {
    requests,
    window,
    domReadyHandler,
    fireDomReady: () => domReadyHandler?.handler(),
  };
}

test('sends one privacy-bounded dedicated retirement event through the configured environment', async () => {
  const result = await execute({
    hostname: 'staging.averlearning.com',
    pathname: '/pages/practice.html',
    runtimeConfig: {
      apiBase: 'https://ielts-speaking-coach-staging.up.railway.app',
      environment: 'staging',
      release: 'a'.repeat(40),
    },
  });
  assert.equal(result.requests.length, 1);
  const request = result.requests[0];
  assert.equal(request.url, 'https://ielts-speaking-coach-staging.up.railway.app/api/analytics/events');
  assert.equal(request.options.keepalive, true);
  assert.equal(request.options.credentials, 'omit');
  const body = JSON.parse(request.options.body);
  assert.deepEqual(body, {
    event_name: 'legacy_retirement_page_view',
    event_data: {
      path: '/pages/practice.html',
      implementation: 'legacy',
      release: 'a'.repeat(40),
      environment: 'staging',
      telemetry_scope: 'gate-f-legacy-retirement',
      beacon_version: 1,
    },
  });
  assert.doesNotMatch(request.options.body, /secret|referrer|search/i);
});

test('records retirement independently without changing the canonical page_view marker', async () => {
  const result = await execute({
    pageViewSent: true,
    runtimeConfig: { apiBase: 'https://api.example.test' },
  });
  assert.equal(result.requests.length, 1);
  assert.equal(result.window.aver._pageViewSent, true);
});

test('retries once at DOMContentLoaded when a later deferred config supplies the API base', async () => {
  const result = await execute({ readyState: 'interactive' });
  assert.equal(result.requests.length, 0);
  assert.equal(result.domReadyHandler.options.once, true);
  result.window.__AVER_RUNTIME_CONFIG__ = { apiBase: 'https://api.example.test' };
  result.fireDomReady();
  assert.equal(result.requests.length, 1);
});

test('uses api.js as a local fallback but never guesses a backend from hostname', async () => {
  const apiConfigured = await execute({
    hostname: 'localhost',
    apiBase: 'http://localhost:8000',
  });
  assert.equal(apiConfigured.requests[0].url, 'http://localhost:8000/api/analytics/events');
  const unconfigured = await execute({ hostname: 'www.averlearning.com' });
  assert.equal(unconfigured.requests.length, 0);
  assert.equal(unconfigured.window.aver._pageViewSent, undefined);
});

test('duplicate script evaluation remains exactly-once', async () => {
  const requests = [];
  const window = {
    aver: {},
    location: { hostname: 'www.averlearning.com', pathname: '/legacy.html' },
    fetch(url, options) {
      requests.push({ url, options });
      return Promise.resolve({ ok: true });
    },
    __AVER_RUNTIME_CONFIG__: { apiBase: 'https://api.example.test' },
  };
  const context = vm.createContext({ window, document: { readyState: 'complete' } });
  vm.runInContext(SOURCE, context);
  vm.runInContext(SOURCE, context);
  assert.equal(requests.length, 1);
});

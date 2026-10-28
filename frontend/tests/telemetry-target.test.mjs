/**
 * telemetry-target.test.mjs — Q-89.
 *
 * Local, dev and test builds must never send analytics (page_view) or Web
 * Vitals beacons to the PRODUCTION API. A local perf run did: the build was
 * unconfigured (runtime-config apiBase=null), it was served on
 * staging.localhost, and api.js's hostname fallback resolved that to the
 * production Railway URL. Production and staging builds keep sending.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PRODUCTION_API_HOST,
  PRODUCTION_SITE_HOSTS,
  allowsTelemetryTarget,
} from '../lib/telemetry-target.mjs';
import {
  PRODUCTION_ORIGIN_MARKERS,
  PROD,
  STAGING,
  resolveRuntimeOrigins,
} from '../tooling/runtime-origins.mjs';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (rel) => readFileSync(path.join(FRONTEND, rel), 'utf8');
const BEACON = read('public/js/analytics-beacon.js');

// Same fallback as public/js/api.js `_API_BASE` (and lib/backend.ts for loopback).
function browserApiBase(rc, hostname) {
  return rc.apiBase
    || (hostname === 'localhost' || hostname === '127.0.0.1'
      ? 'http://localhost:8000'
      : PROD.apiBase);
}

// Builds a browser can be served from, with the runtime-config each one ships.
const BUILDS = {
  production: { env: { VERCEL_ENV: 'production' }, hostname: 'www.averlearning.com' },
  productionApex: { env: { VERCEL_ENV: 'production' }, hostname: 'averlearning.com' },
  staging: { env: { VERCEL_ENV: 'preview' }, hostname: 'staging.averlearning.com' },
  vercelDevelopment: { env: { VERCEL_ENV: 'development' }, hostname: 'localhost' },
  localOnLoopback: { env: {}, hostname: 'localhost' },
  localPerfProxy: { env: {}, hostname: 'staging.localhost' },
  localLanIp: { env: {}, hostname: '192.168.1.20' },
  localExplicitProdApi: { env: { AVER_API_BASE: PROD.apiBase }, hostname: 'staging.localhost' },
  testFixture: { env: { AVER_ENVIRONMENT: 'test', AVER_API_BASE: 'http://127.0.0.1:3999' }, hostname: 'localhost' },
  testWithProdApi: { env: { AVER_ENVIRONMENT: 'test', AVER_API_BASE: PROD.apiBase }, hostname: 'localhost' },
};

function runtimeConfig(name) {
  return { ...resolveRuntimeOrigins(BUILDS[name].env), release: 'sha-test' };
}

/** Runs analytics-beacon.js against the api.js base this build/page would get. */
function pageViews(name) {
  const rc = runtimeConfig(name);
  const { hostname } = BUILDS[name];
  const posts = [];
  const location = { pathname: '/grammar', hostname };
  const window = {
    __AVER_RUNTIME_CONFIG__: rc,
    api: {
      base: browserApiBase(rc, hostname),
      post: (url, body) => { posts.push({ url, body }); return Promise.resolve({}); },
    },
    location,
    innerWidth: 390,
  };
  const document = { readyState: 'complete', referrer: '', addEventListener() {} };
  window.document = document;
  vm.runInContext(BEACON, vm.createContext({ window, document, location, Object, JSON, Math, Date }));
  return { posts, base: window.api.base };
}

test('the shared rule names the same production API as the build guard', () => {
  assert.ok(PRODUCTION_ORIGIN_MARKERS.includes(PRODUCTION_API_HOST));
  assert.ok(PROD.apiBase.includes(PRODUCTION_API_HOST));
  assert.ok(!STAGING.apiBase.includes(PRODUCTION_API_HOST));
  // analytics-beacon.js is a classic script and carries its own copy.
  assert.match(BEACON, new RegExp(`PRODUCTION_API_HOST = '${PRODUCTION_API_HOST.replace(/\./g, '\\.')}'`));
  for (const host of PRODUCTION_SITE_HOSTS) assert.ok(BEACON.includes(`'${host}'`), host);
});

test('allowsTelemetryTarget: production API only for a production build or the production site', () => {
  const prod = PROD.apiBase;
  assert.equal(allowsTelemetryTarget(prod, { environment: 'production', hostname: 'localhost' }), true);
  assert.equal(allowsTelemetryTarget(prod, { hostname: 'www.averlearning.com' }), true);
  assert.equal(allowsTelemetryTarget(prod, { hostname: 'AverLearning.com' }), true);
  assert.equal(allowsTelemetryTarget(prod, { environment: null, hostname: 'staging.localhost' }), false);
  assert.equal(allowsTelemetryTarget(prod, { environment: 'test', hostname: 'localhost' }), false);
  assert.equal(allowsTelemetryTarget(prod, { environment: 'staging', hostname: 'staging.averlearning.com' }), false);
  assert.equal(allowsTelemetryTarget(prod), false);
  // Non-production targets are untouched.
  assert.equal(allowsTelemetryTarget(STAGING.apiBase, { environment: 'staging' }), true);
  assert.equal(allowsTelemetryTarget('http://localhost:8000', {}), true);
  assert.equal(allowsTelemetryTarget(null, { environment: 'production' }), false);
});

test('page_view: production and staging builds still send to their own API', () => {
  for (const [name, api] of [
    ['production', PROD.apiBase],
    ['productionApex', PROD.apiBase],
    ['staging', STAGING.apiBase],
    ['vercelDevelopment', STAGING.apiBase],
  ]) {
    const { posts, base } = pageViews(name);
    assert.equal(base, api, name);
    assert.equal(posts.length, 1, `${name} must keep its page_view`);
    assert.equal(posts[0].url, '/api/analytics/events');
    assert.equal(posts[0].body.event_name, 'page_view');
  }
});

test('page_view: local, dev and test builds never post to the production API', () => {
  for (const name of ['localPerfProxy', 'localLanIp', 'localExplicitProdApi', 'testWithProdApi']) {
    const { posts, base } = pageViews(name);
    assert.equal(base, PROD.apiBase, `${name}: precondition — api.js resolves to production`);
    assert.equal(posts.length, 0, `${name} sent a page_view to production analytics`);
  }
  // Their non-production targets are unchanged.
  for (const name of ['localOnLoopback', 'testFixture']) {
    const { posts, base } = pageViews(name);
    assert.ok(!base.includes(PRODUCTION_API_HOST), name);
    assert.equal(posts.length, 1, `${name} keeps its local page_view`);
  }
});

test('Web Vitals: the root layout gates the server API base with the same rule', () => {
  const layout = read('app/layout.tsx');
  assert.match(layout, /import \{ allowsTelemetryTarget \} from '@\/lib\/telemetry-target\.mjs'/);
  assert.match(layout,
    /VITALS_API_BASE = allowsTelemetryTarget\(API_BASE, \{ environment: process\.env\.VERCEL_ENV \}\)/);
  assert.match(layout, /<NextWebVitals apiBase=\{VITALS_API_BASE\}/);
  assert.doesNotMatch(layout, /<NextWebVitals apiBase=\{API_BASE\}/);

  const collector = read('components/next-web-vitals.tsx');
  assert.match(collector, /apiBase: string \| null;/);
  assert.match(collector, /const report = useCallback\(\(metric: WebVitalMetric\) => \{\n\s+if \(!apiBase\) return;/);

  // lib/backend.ts: production server → production API (kept), any server
  // pointed at production without VERCEL_ENV=production → no vitals.
  const vitalsBase = (apiBase, vercelEnv) =>
    allowsTelemetryTarget(apiBase, { environment: vercelEnv }) ? apiBase : null;
  assert.equal(vitalsBase(PROD.apiBase, 'production'), PROD.apiBase);
  assert.equal(vitalsBase(STAGING.apiBase, 'preview'), STAGING.apiBase);
  assert.equal(vitalsBase('http://localhost:8000', undefined), 'http://localhost:8000');
  assert.equal(vitalsBase(PROD.apiBase, undefined), null);
  assert.equal(vitalsBase(PROD.apiBase, 'development'), null);
});

test('landing page_view uses the same rule before posting', () => {
  const landing = read('app/(marketing)/landing-behavior.tsx');
  const guard = landing.indexOf('if (!allowsTelemetryTarget(apiBase, {');
  const post = landing.indexOf("fetch(apiBase + '/api/analytics/events'");
  assert.ok(guard !== -1 && post !== -1 && guard < post, 'guard must precede the page_view fetch');
  assert.match(landing.slice(guard, post), /environment: rc\?\.environment,\s+hostname: location\.hostname,/);
});

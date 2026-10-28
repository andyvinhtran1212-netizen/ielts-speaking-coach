// C-04 — the landing stats fallback resolves the staging site to the staging
// API (it used to resolve null, leaving both stat tiles on '—' whenever
// runtime-config.js failed), keeps production on production, and stays
// fail-closed for every unknown host.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fallbackApiBase, LANDING_FALLBACK_API_BASES } from '../lib/landing-api-base.mjs';
import { PROD, STAGING } from '../tooling/runtime-origins.mjs';
import { PRODUCTION_API_HOST } from '../lib/telemetry-target.mjs';

test('staging site falls back to the staging API, never production', () => {
  assert.equal(fallbackApiBase('staging.averlearning.com'), STAGING.apiBase);
  assert.equal(fallbackApiBase('STAGING.averlearning.com'), STAGING.apiBase);
  assert.ok(!fallbackApiBase('staging.averlearning.com').includes(PRODUCTION_API_HOST));
});

test('production site hosts fall back to the production API', () => {
  assert.equal(fallbackApiBase('averlearning.com'), PROD.apiBase);
  assert.equal(fallbackApiBase('www.averlearning.com'), PROD.apiBase);
});

test('loopback hosts fall back to the local backend', () => {
  assert.equal(fallbackApiBase('localhost'), 'http://localhost:8000');
  assert.equal(fallbackApiBase('127.0.0.1'), 'http://localhost:8000');
});

test('unknown hosts (random previews, proxies, LAN, look-alikes) stay null', () => {
  for (const host of [
    'ielts-speaking-coach-git-feature-x.vercel.app',
    'staging.localhost',
    '192.168.1.20',
    'evil-averlearning.com',
    'staging.averlearning.com.evil.test',
    'hasOwnProperty',
    '__proto__',
    '',
    undefined,
    null,
  ]) {
    assert.equal(fallbackApiBase(host), null, `${String(host)} must not resolve an API`);
  }
});

test('fallback API origins stay in step with the runtime-config origins', () => {
  const allowed = new Set([PROD.apiBase, STAGING.apiBase, 'http://localhost:8000']);
  for (const [host, apiBase] of Object.entries(LANDING_FALLBACK_API_BASES)) {
    assert.ok(allowed.has(apiBase), `${host} → ${apiBase} is not a known runtime origin`);
  }
});

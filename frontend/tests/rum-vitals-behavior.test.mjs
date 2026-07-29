/**
 * frontend/tests/rum-vitals-behavior.test.mjs — AUDIT F2 (2026-07-14).
 *
 * Behavioral test for the field Web Vitals collector: loads rum-vitals.js
 * in a vm sandbox (same technique as error-reporter-dispatch), feeds it
 * synthetic PerformanceObserver entries, fires pagehide, and asserts the
 * ONE keepalive POST it must produce — payload shape included. Source-pin
 * tests live in adr-012-telemetry.test.mjs; this file proves the runtime
 * path actually wires observer → aggregate → beacon.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(__dirname, '..', 'js', 'rum-vitals.js'), 'utf8');

function setupSandbox({ next = true, runtimeConfig = {}, userAgent = 'UA/1.0 test' } = {}) {
  const fetchCalls = [];
  const observers = {};        // entry type → callback
  const winListeners = {};
  const docListeners = {};

  class FakePO {
    constructor(cb) { this._cb = cb; }
    observe(opts) { observers[opts.type] = this._cb; }
  }
  FakePO.supportedEntryTypes = [
    'largest-contentful-paint', 'layout-shift', 'event',
  ];

  const window = {
    PerformanceObserver: FakePO,
    __AVER_RUNTIME_CONFIG__: runtimeConfig,
    location: { pathname: '/', hostname: 'averlearning.com' },
    fetch: (url, opts) => {
      fetchCalls.push({ url, opts });
      return Promise.resolve({ ok: true });
    },
    addEventListener: (name, fn) => { (winListeners[name] ||= []).push(fn); },
  };
  // DEBT-2026-07-29-M — a UA-less window must still beacon (older automation
  // contexts have no navigator); `userAgent: null` exercises that path.
  if (userAgent !== null) window.navigator = { userAgent };
  if (next) window.__next_f = [];
  const document = {
    visibilityState: 'visible',
    addEventListener: (name, fn) => { (docListeners[name] ||= []).push(fn); },
  };
  window.document = document;

  const ctx = vm.createContext({ window, document, Object, JSON, Math });
  vm.runInContext(SOURCE, ctx);

  const emit = (type, entries) => {
    if (observers[type]) observers[type]({ getEntries: () => entries });
  };
  const firePagehide = () => (winListeners.pagehide || []).forEach((fn) => fn());
  const fireHidden = () => {
    document.visibilityState = 'hidden';
    (docListeners.visibilitychange || []).forEach((fn) => fn());
  };
  return { window, fetchCalls, emit, firePagehide, fireHidden };
}

test('aggregates LCP (last wins) + CLS (sum, no recent-input) + INP (max interaction) into ONE tagged keepalive POST', () => {
  const sb = setupSandbox({ runtimeConfig: { release: 'abc123', apiBase: 'https://api.example' } });
  sb.emit('largest-contentful-paint', [{ startTime: 800 }, { startTime: 1234.6 }]);
  sb.emit('layout-shift', [
    { value: 0.05, hadRecentInput: false },
    { value: 0.9, hadRecentInput: true },   // user-caused — must be excluded
    { value: 0.013, hadRecentInput: false },
  ]);
  sb.emit('event', [
    { interactionId: 7, duration: 120 },
    { interactionId: 0, duration: 900 },    // no interactionId — not an interaction
    { interactionId: 9, duration: 250 },
  ]);
  sb.firePagehide();

  assert.equal(sb.fetchCalls.length, 1, 'exactly one beacon per page');
  const call = sb.fetchCalls[0];
  assert.equal(call.url, 'https://api.example/api/analytics/events',
    'runtime-config apiBase must win (staging vitals must not hit prod)');
  assert.equal(call.opts.keepalive, true, 'must survive page unload');
  const body = JSON.parse(call.opts.body);
  assert.equal(body.event_name, 'web_vitals');
  assert.equal(body.event_data.lcp, 1235, 'last LCP entry, rounded');
  assert.equal(body.event_data.cls, 0.063, 'sum of non-input shifts only');
  assert.equal(body.event_data.inp, 250, 'max duration among real interactions');
  assert.equal(body.event_data.implementation, 'next');
  assert.equal(body.event_data.release, 'abc123');
  assert.equal(body.event_data.path, '/');

  // Second hide must NOT double-send.
  sb.fireHidden();
  assert.equal(sb.fetchCalls.length, 1, 'send-once contract');
});

// DEBT-2026-07-29-M — pilot 2 opened with LCP p75 12624ms over n=4 and no way
// to tell a real weak-network phone from an automated browser. error_logs has
// carried the UA all along; the vitals stream must be comparable to it.
test('beacon carries the user-agent, capped at 300 chars', () => {
  const long = 'Mozilla/5.0 ' + 'x'.repeat(500);
  const sb = setupSandbox({ runtimeConfig: { apiBase: 'https://api.example' }, userAgent: long });
  sb.emit('largest-contentful-paint', [{ startTime: 900 }]);
  sb.firePagehide();
  const body = JSON.parse(sb.fetchCalls[0].opts.body);
  assert.equal(body.event_data.ua.length, 300, 'capped — attribution, not forensics');
  assert.ok(body.event_data.ua.startsWith('Mozilla/5.0 '));
});

test('no navigator → ua null, beacon still sent (never break the page)', () => {
  const sb = setupSandbox({ runtimeConfig: { apiBase: 'https://api.example' }, userAgent: null });
  sb.emit('largest-contentful-paint', [{ startTime: 900 }]);
  sb.firePagehide();
  assert.equal(sb.fetchCalls.length, 1);
  const body = JSON.parse(sb.fetchCalls[0].opts.body);
  assert.equal(body.event_data.ua, null);
  assert.equal(body.event_data.lcp, 900);
});

test('legacy page (no __next_f) tags implementation=legacy — the baseline side of the trigger', () => {
  const sb = setupSandbox({ next: false, runtimeConfig: { apiBase: 'https://api.example' } });
  sb.emit('largest-contentful-paint', [{ startTime: 1000 }]);
  sb.fireHidden();
  const body = JSON.parse(sb.fetchCalls[0].opts.body);
  assert.equal(body.event_data.implementation, 'legacy');
});

test('nothing measured → no beacon (empty samples must not dilute p75)', () => {
  const sb = setupSandbox();
  sb.firePagehide();
  sb.fireHidden();
  assert.equal(sb.fetchCalls.length, 0);
});

test('no PerformanceObserver → loads without throwing and sends nothing', () => {
  const fetchCalls = [];
  const window = {
    location: { pathname: '/', hostname: 'averlearning.com' },
    fetch: (u, o) => { fetchCalls.push({ u, o }); return Promise.resolve({ ok: true }); },
    addEventListener: () => {},
  };
  window.document = { visibilityState: 'visible', addEventListener: () => {} };
  const ctx = vm.createContext({ window, document: window.document, Object, JSON, Math });
  vm.runInContext(SOURCE, ctx);   // must not throw
  assert.equal(fetchCalls.length, 0);
});

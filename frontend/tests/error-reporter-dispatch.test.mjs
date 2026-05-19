/**
 * frontend/tests/error-reporter-dispatch.test.mjs — Sprint 12.3.1 hotfix.
 *
 * Sentinel for Falsification #82: the Sprint 12.3 reporter attached
 * listeners but Tester01 dogfood (2026-05-19) confirmed `throw new
 * Error("test")` produced ZERO POSTs to /api/error-logs. Root cause was
 * a Promise chain in `_getAuthToken` without `.catch()` — a rejecting
 * `sb.auth.getSession()` threw inside `await`, hit the bare `catch {}`
 * in reportError, and disappeared with no trace.
 *
 * This test loads error-reporter.js in a vm.createContext sandbox with
 * a stub window + fetch + supabase client, dispatches a synthetic
 * ErrorEvent by calling the registered listener directly, and asserts:
 *
 *   1. The listener was registered for 'error' (Sprint 12.3 baseline).
 *   2. Dispatching an ErrorEvent triggers a fetch to /api/error-logs.
 *   3. The fetch body has the right shape (level + source + message).
 *   4. A rejecting auth-token Promise does NOT block the fetch (the
 *      bug Tester01 hit).
 *   5. Malformed events (empty/missing message) still fire a POST with
 *      a defensive "Unknown error" fallback (no silent bail).
 *   6. Sync throw inside the listener body does not detach the listener
 *      (defensive try/catch around the handler).
 */

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(
  join(__dirname, '..', 'js', 'error-reporter.js'),
  'utf8',
);


/**
 * Build a fresh sandboxed window + run error-reporter.js inside it.
 * Returns { window, fetchCalls, consoleErrors, listeners } for assertions.
 *
 * `getSessionImpl` lets tests override how the supabase session check
 * resolves (or rejects) — critical for pinning Falsification #82's
 * rejecting-auth scenario.
 */
function setupSandbox({ getSessionImpl, fetchImpl } = {}) {
  const fetchCalls = [];
  const consoleErrors = [];
  const listeners = {};

  const recording = (delegate) => (url, opts) => {
    fetchCalls.push({ url, opts });
    return delegate ? delegate(url, opts) : Promise.resolve({ ok: true, status: 200 });
  };
  const defaultFetch = recording();

  const defaultGetSession = () =>
    Promise.resolve({ data: { session: { access_token: 'tok-123' } } });

  const fakeWindow = {
    addEventListener(name, fn) {
      listeners[name] = fn;
    },
    fetch: fetchImpl ? recording(fetchImpl) : defaultFetch,
    location: { pathname: '/test/path', hostname: 'localhost' },
    navigator: { userAgent: 'test/1.0' },
    crypto: { randomUUID: () => 'rid-fixed-001' },
    getSupabase() {
      return {
        auth: { getSession: getSessionImpl || defaultGetSession },
      };
    },
  };

  const fakeConsole = {
    error: (...args) => consoleErrors.push(['error', ...args]),
    warn:  (...args) => consoleErrors.push(['warn',  ...args]),
    log:   () => {},
  };

  const ctx = vm.createContext({
    window: fakeWindow,
    console: fakeConsole,
    Set,
    String,
    JSON,
    Math,
    Date,
    Promise,
    setTimeout,
    clearTimeout,
  });

  vm.runInContext(SOURCE, ctx);

  return { window: fakeWindow, fetchCalls, consoleErrors, listeners };
}

/**
 * Wait for the microtask queue + a setTimeout(0) so any pending async
 * work inside the reporter has a chance to land.
 */
async function flush() {
  await new Promise((r) => setTimeout(r, 50));
}


describe('Sprint 12.3.1 — Falsification #82 dispatch sentinel', () => {

  test('listener is registered for window.error', () => {
    const { listeners } = setupSandbox();
    assert.ok(typeof listeners.error === 'function',
      'window.addEventListener("error", ...) must register a listener');
  });

  test('listener is registered for window.unhandledrejection', () => {
    const { listeners } = setupSandbox();
    assert.ok(typeof listeners.unhandledrejection === 'function',
      'window.addEventListener("unhandledrejection", ...) must register a listener');
  });

  test('dispatching an ErrorEvent triggers a POST to /api/error-logs', async () => {
    const { listeners, fetchCalls } = setupSandbox();
    const event = {
      message: 'TypeError: foo is not a function',
      error:   { message: 'foo is not a function', stack: 'at line 42' },
      filename: 'app.js',
      lineno:   10,
      colno:    5,
    };
    listeners.error(event);
    await flush();
    assert.equal(fetchCalls.length, 1,
      `Expected 1 fetch call, got ${fetchCalls.length} (Falsification #82 regression)`);
    assert.ok(fetchCalls[0].url.endsWith('/api/error-logs'),
      `fetch URL was ${fetchCalls[0].url}`);
  });

  test('POST body carries level, source, message, request_id', async () => {
    const { listeners, fetchCalls } = setupSandbox();
    listeners.error({ message: 'whoa', error: { stack: 's' } });
    await flush();
    assert.equal(fetchCalls.length, 1);
    const body = JSON.parse(fetchCalls[0].opts.body);
    assert.equal(body.level, 'error');
    assert.equal(body.source, 'frontend');
    assert.equal(body.message, 'whoa');
    assert.ok(body.request_id, 'request_id must be populated');
  });

  test('rejecting auth-token Promise does NOT block fetch (the actual bug)', async () => {
    const rejectingSession = () => Promise.reject(new Error('supabase down'));
    const { listeners, fetchCalls, consoleErrors } = setupSandbox({
      getSessionImpl: rejectingSession,
    });
    listeners.error({ message: 'auth-rejection-but-still-fires' });
    await flush();
    assert.equal(fetchCalls.length, 1,
      'fetch must still fire even when auth resolution rejects (Falsification #82)');
    // Falsification #82 trace: the rejection should leave a console.error
    // breadcrumb so future dogfood can see why a session check failed.
    const traceFound = consoleErrors.some(
      (e) => Array.isArray(e) && String(e[1] || '').includes('getSession failed'),
    );
    assert.ok(traceFound,
      `Expected console.error('[error-reporter] getSession failed: ...') trace; got ${JSON.stringify(consoleErrors)}`);
  });

  test('event with missing message still POSTs (defensive fallback)', async () => {
    const { listeners, fetchCalls } = setupSandbox();
    // Browser sometimes fires error events with empty/missing message.
    listeners.error({ message: '', error: null });
    await flush();
    assert.equal(fetchCalls.length, 1, 'empty-message event must still POST');
    const body = JSON.parse(fetchCalls[0].opts.body);
    assert.equal(body.message, 'Unknown error',
      'missing message must fall back to "Unknown error"');
  });

  test('completely empty event still POSTs (defensive fallback)', async () => {
    const { listeners, fetchCalls } = setupSandbox();
    listeners.error({});
    await flush();
    assert.equal(fetchCalls.length, 1);
  });

  test('null event does NOT crash the listener', () => {
    const { listeners } = setupSandbox();
    // Should not throw — handler wraps in try/catch.
    assert.doesNotThrow(() => listeners.error(null));
  });

  test('non-2xx fetch response logs but does not throw', async () => {
    const failingFetch = () => Promise.resolve({ ok: false, status: 503 });
    const { listeners, fetchCalls, consoleErrors } = setupSandbox({
      fetchImpl: failingFetch,
    });
    listeners.error({ message: '503-test' });
    await flush();
    assert.equal(fetchCalls.length, 1);
    const traceFound = consoleErrors.some(
      (e) => Array.isArray(e) && String(e[1] || '').includes('returned'),
    );
    assert.ok(traceFound,
      `Expected console.error('[error-reporter] POST returned ...'); got ${JSON.stringify(consoleErrors)}`);
  });

  test('dedup prevents duplicate POSTs for identical (message, stack)', async () => {
    const { listeners, fetchCalls } = setupSandbox();
    const event = { message: 'dup', error: { stack: 'same' } };
    listeners.error(event);
    listeners.error(event);
    listeners.error(event);
    await flush();
    assert.equal(fetchCalls.length, 1,
      'dedup must collapse 3 identical errors into 1 POST');
  });

  test('window.aver.reportError() also POSTs', async () => {
    const { window, fetchCalls } = setupSandbox();
    window.aver.reportError('manual report', { component: 'X' });
    await flush();
    assert.equal(fetchCalls.length, 1);
    const body = JSON.parse(fetchCalls[0].opts.body);
    assert.equal(body.message, 'manual report');
    assert.equal(body.level, 'warning');
  });

  test('extractErrorPayload helper is exported for unit testing', () => {
    const { window } = setupSandbox();
    assert.ok(typeof window.aver._extractErrorPayload === 'function',
      'Sprint 12.3.1 exports _extractErrorPayload for testability');
    const payload = window.aver._extractErrorPayload({
      message: 'TypeError: x',
      error:   { stack: 'trace-here' },
      filename: 'main.js',
      lineno: 1, colno: 2,
    });
    assert.equal(payload.message, 'TypeError: x');
    assert.equal(payload.stack, 'trace-here');
    assert.equal(payload.extra.filename, 'main.js');
  });

  test('extractErrorPayload falls back when message is missing', () => {
    const { window } = setupSandbox();
    const p = window.aver._extractErrorPayload({});
    assert.equal(p.message, 'Unknown error');
  });

  test('extractErrorPayload returns null for null event', () => {
    const { window } = setupSandbox();
    assert.equal(window.aver._extractErrorPayload(null), null);
  });

  test('unhandledrejection with rejection reason fires POST', async () => {
    const { listeners, fetchCalls } = setupSandbox();
    listeners.unhandledrejection({
      reason: { message: 'rejected!', stack: 'at promise' },
    });
    await flush();
    assert.equal(fetchCalls.length, 1);
    const body = JSON.parse(fetchCalls[0].opts.body);
    assert.equal(body.message, 'rejected!');
    assert.equal(body.extra.type, 'unhandled_promise_rejection');
  });

  test('unhandledrejection with string reason fires POST', async () => {
    const { listeners, fetchCalls } = setupSandbox();
    listeners.unhandledrejection({ reason: 'plain string reason' });
    await flush();
    assert.equal(fetchCalls.length, 1);
    const body = JSON.parse(fetchCalls[0].opts.body);
    assert.equal(body.message, 'plain string reason');
  });
});

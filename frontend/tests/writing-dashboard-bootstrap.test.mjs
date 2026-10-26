/**
 * frontend/tests/writing-dashboard-bootstrap.test.mjs
 *
 * Run with:
 *   node --test frontend/tests/writing-dashboard-bootstrap.test.mjs
 *
 * Regression for the S2 writing-dashboard forever-hang that survived #1696:
 * the page intermittently stayed on "Chào em 👋 / Mã học viên: — / Bài giao:
 * Đang tải…" (>100 s) with NO error state and no retry button, and the
 * "Mẹo viết" tab sat on "Đang tải mẹo…".
 *
 * Root cause: the hang was BEFORE the two wrapped GETs. AuthProvider awaits
 * `sb.auth.getSession()` with no deadline, and the page effect returns early
 * until status is `signed-in`; `whenGlobalReady` timing out also returned
 * silently; a `null` list response left "Đang tải…" in place; the tips read had
 * no deadline at all.
 *
 * These tests drive the real bootstrap module against a never-resolving
 * getSession and a never-resolving profile fetch and assert the visible error
 * state (#error shown, "Thử lại" shown) appears.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { getWithTimeout, withDeadline } from '../lib/request-with-timeout.mjs';
import {
  WRITING_BOOTSTRAP_DEADLINE_MS,
  WRITING_BOOTSTRAP_MESSAGES,
  WRITING_SESSION_DEADLINE_MS,
  clearWritingBootstrapError,
  runWritingBootstrap,
  showWritingBootstrapError,
} from '../lib/writing-dashboard-bootstrap.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const never = () => new Promise(() => {});

// ── Minimal DOM for the shell's state containers ──────────────────────

function fakeElement(hidden) {
  const classes = new Set(hidden ? ['hidden'] : []);
  const attrs = {};
  return {
    textContent: '',
    dataset: {},
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    },
    setAttribute: (k, v) => { attrs[k] = v; },
    getAttribute: (k) => attrs[k],
  };
}

/** Mirrors page-shell.tsx: #error + #error-retry hidden, #content visible. */
function fakeShell() {
  const els = {
    error: fakeElement(true),
    'error-message': fakeElement(false),
    'error-retry': fakeElement(true),
    content: fakeElement(false),
  };
  return { els, getElementById: (id) => els[id] || null };
}

function viewFor(doc) {
  const calls = { error: [], signedOut: 0, ready: 0 };
  return {
    calls,
    view: {
      error: (e) => { calls.error.push(e); showWritingBootstrapError(doc, e); },
      signedOut: () => { calls.signedOut += 1; },
      ready: () => { calls.ready += 1; },
    },
  };
}

function assertVisibleErrorState(doc, message) {
  assert.equal(doc.els.error.classList.contains('hidden'), false, '#error must be visible');
  assert.equal(doc.els['error-retry'].classList.contains('hidden'), false, '"Thử lại" must be visible');
  assert.equal(doc.els['error-message'].textContent, message);
  assert.equal(doc.els.error.getAttribute('role'), 'alert');
}

/** Mirrors api.js: getWith awaits getSession() BEFORE fetch() exists. */
function apiWithSession(getSession, respond) {
  return {
    get: () => { throw new Error('getWith is used when abortable'); },
    getWith: async (p) => {
      await getSession();
      return respond(p);
    },
  };
}

/** Mirrors writing-behavior.tsx loadAssignments(): bounded GET, false = retryable failure. */
async function loadProfile(api, timeoutMs) {
  try {
    const data = await getWithTimeout(api, '/api/writing/my-assignments', { timeoutMs });
    if (!data) throw new Error('empty response');
    return true;
  } catch (err) {
    return err && err.status === 403;
  }
}

// ── Deadlines ─────────────────────────────────────────────────────────

describe('bootstrap deadlines', () => {
  test('are finite and far below the observed >100 s hang', () => {
    for (const ms of [WRITING_SESSION_DEADLINE_MS, WRITING_BOOTSTRAP_DEADLINE_MS]) {
      assert.ok(Number.isFinite(ms) && ms > 0 && ms <= 30000);
    }
    assert.ok(WRITING_SESSION_DEADLINE_MS < WRITING_BOOTSTRAP_DEADLINE_MS);
  });

  test('withDeadline rejects a never-settling promise with a tagged timeout and runs onTimeout', async () => {
    let cancelled = false;
    await assert.rejects(
      withDeadline(never(), { timeoutMs: 5, message: 'quá lâu', onTimeout: () => { cancelled = true; } }),
      (e) => e.timeout === true && e.message === 'quá lâu',
    );
    assert.ok(cancelled, 'onTimeout is the best-effort cancel hook');
  });

  test('withDeadline passes a winning value through and clears its timer', async () => {
    let cleared = 0;
    const value = await withDeadline(Promise.resolve(42), {
      timeoutMs: 1000, setTimer: () => 'id', clearTimer: () => { cleared += 1; },
    });
    assert.equal(value, 42);
    assert.equal(cleared, 1);
  });
});

// ── The two staging hangs ─────────────────────────────────────────────

describe('runWritingBootstrap — never-resolving getSession', () => {
  test('ends in the visible error state with "Thử lại" (no forever-loading)', async () => {
    const doc = fakeShell();
    const { calls, view } = viewFor(doc);
    let loaded = false;
    const outcome = await runWritingBootstrap({
      getSession: never, // supabase auth.getSession() stuck on the auth lock / refresh
      load: () => { loaded = true; return true; },
      view,
      sessionDeadlineMs: 20,
      deadlineMs: 200,
    });
    assert.equal(outcome, 'error');
    assert.equal(loaded, false, 'no data read may start without a session');
    assert.equal(calls.error.length, 1);
    assert.deepEqual(calls.error[0], {
      stage: 'session', message: WRITING_BOOTSTRAP_MESSAGES.session, timeout: true,
    });
    assertVisibleErrorState(doc, WRITING_BOOTSTRAP_MESSAGES.session);
    assert.ok(doc.els.content.classList.contains('hidden'),
      'nothing is wired before a session — the dead tabs are hidden');
    assert.equal(calls.signedOut, 0, 'a slow session is NOT "no session": no login redirect');
  });

  test('a late session after the deadline does not resume loading under the error box', async () => {
    const doc = fakeShell();
    const { view } = viewFor(doc);
    let release;
    let loaded = false;
    const outcome = await runWritingBootstrap({
      getSession: () => new Promise((r) => { release = r; }),
      load: () => { loaded = true; return true; },
      view,
      sessionDeadlineMs: 10,
      deadlineMs: 200,
    });
    assert.equal(outcome, 'error');
    release({ userId: 'u1' });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(loaded, false);
  });

  test('a stalled session inside the transport (api.js getWith) is also bounded', async () => {
    const doc = fakeShell();
    const { calls, view } = viewFor(doc);
    const api = apiWithSession(never, () => ({ student: {}, assignments: [] }));
    const outcome = await runWritingBootstrap({
      getSession: () => ({ userId: 'u1' }),
      load: () => loadProfile(api, 20),
      view,
      deadlineMs: 500,
    });
    assert.equal(outcome, 'error');
    assert.equal(calls.error[0].stage, 'data');
    assertVisibleErrorState(doc, WRITING_BOOTSTRAP_MESSAGES.failed);
  });
});

describe('runWritingBootstrap — never-resolving profile fetch', () => {
  test('per-request deadline: the bounded profile GET fails → visible error state', async () => {
    const doc = fakeShell();
    const { calls, view } = viewFor(doc);
    const api = { get: never, getWith: never }; // backend never answers
    const outcome = await runWritingBootstrap({
      getSession: () => ({ userId: 'u1' }),
      load: () => loadProfile(api, 20),
      view,
      deadlineMs: 500,
    });
    assert.equal(outcome, 'error');
    assert.deepEqual(calls.error[0], {
      stage: 'data', message: WRITING_BOOTSTRAP_MESSAGES.failed, timeout: false,
    });
    assertVisibleErrorState(doc, WRITING_BOOTSTRAP_MESSAGES.failed);
    assert.equal(doc.els.content.classList.contains('hidden'), false,
      'a data failure keeps the half that loaded usable');
  });

  test('whole-bootstrap deadline: a loader that never settles still ends in the error state', async () => {
    const doc = fakeShell();
    const { calls, view } = viewFor(doc);
    const outcome = await runWritingBootstrap({
      getSession: () => ({ userId: 'u1' }),
      load: never, // e.g. an unwrapped profile read
      view,
      deadlineMs: 20,
    });
    assert.equal(outcome, 'error');
    assert.deepEqual(calls.error[0], {
      stage: 'data', message: WRITING_BOOTSTRAP_MESSAGES.data, timeout: true,
    });
    assertVisibleErrorState(doc, WRITING_BOOTSTRAP_MESSAGES.data);
  });

  test('a null (204 / 401-redirect) profile response is a failure, not "Đang tải…" forever', async () => {
    const doc = fakeShell();
    const { view } = viewFor(doc);
    const api = apiWithSession(() => Promise.resolve(), () => null);
    const outcome = await runWritingBootstrap({
      getSession: () => ({ userId: 'u1' }),
      load: () => loadProfile(api, 1000),
      view,
      deadlineMs: 500,
    });
    assert.equal(outcome, 'error');
    assertVisibleErrorState(doc, WRITING_BOOTSTRAP_MESSAGES.failed);
  });

  test('a 403 (not linked / no Writing permission) is a truthful answer, not a retry banner', async () => {
    const doc = fakeShell();
    const { calls, view } = viewFor(doc);
    const api = apiWithSession(() => Promise.resolve(), () => {
      throw Object.assign(new Error('Quyền Writing chưa được kích hoạt'), { status: 403 });
    });
    const outcome = await runWritingBootstrap({
      getSession: () => ({ userId: 'u1' }),
      load: () => loadProfile(api, 1000),
      view,
    });
    assert.equal(outcome, 'ready');
    assert.equal(calls.error.length, 0);
    assert.ok(doc.els.error.classList.contains('hidden'));
  });
});

describe('runWritingBootstrap — other terminal paths', () => {
  test('no session at all → signedOut (login redirect), never an error', async () => {
    const doc = fakeShell();
    const { calls, view } = viewFor(doc);
    const outcome = await runWritingBootstrap({
      getSession: () => Promise.resolve(null), load: () => true, view,
    });
    assert.equal(outcome, 'signed-out');
    assert.equal(calls.signedOut, 1);
    assert.equal(calls.error.length, 0);
  });

  test('missing page globals (whenGlobalReady → false) → prepare-stage error, not a silent return', async () => {
    const doc = fakeShell();
    const { calls, view } = viewFor(doc);
    const outcome = await runWritingBootstrap({
      getSession: () => ({ userId: 'u1' }), prepare: () => false, load: () => true, view,
    });
    assert.equal(outcome, 'error');
    assert.equal(calls.error[0].stage, 'prepare');
    assertVisibleErrorState(doc, WRITING_BOOTSTRAP_MESSAGES.prepare);
    assert.ok(doc.els.content.classList.contains('hidden'));
  });

  test('success → ready; a stale run (account switch / unmount) reports nothing', async () => {
    const doc = fakeShell();
    const { calls, view } = viewFor(doc);
    assert.equal(await runWritingBootstrap({
      getSession: () => ({ userId: 'u1' }), prepare: () => true, load: () => true, view,
    }), 'ready');
    assert.equal(calls.ready, 1);
    let current = true;
    const stale = runWritingBootstrap({
      getSession: never, load: () => true, view, isCurrent: () => current,
      sessionDeadlineMs: 10, deadlineMs: 100,
    });
    current = false;
    assert.equal(await stale, 'stale');
    assert.equal(calls.error.length, 0);
  });

  test('clearWritingBootstrapError restores the content and hides the box', () => {
    const doc = fakeShell();
    showWritingBootstrapError(doc, { stage: 'session', message: 'x', timeout: true });
    clearWritingBootstrapError(doc);
    assert.ok(doc.els.error.classList.contains('hidden'));
    assert.equal(doc.els.content.classList.contains('hidden'), false);
  });
});

// ── Wiring guards (the .tsx is not importable under node --test) ──────

describe('writing dashboard wiring', () => {
  let shell;
  let behavior;
  let layout;
  before(() => {
    const dir = path.join(__dirname, '..', 'app', '(authed-writing)');
    shell = readFileSync(path.join(dir, 'writing', 'dashboard', 'page-shell.tsx'), 'utf8');
    behavior = readFileSync(path.join(dir, 'writing', 'dashboard', 'writing-behavior.tsx'), 'utf8');
    layout = readFileSync(path.join(dir, 'layout.tsx'), 'utf8');
  });

  test('shell exposes "Thử lại" in the page error box and the tips error box', () => {
    assert.match(shell, /id="error-retry"[^>]*>\s*Thử lại/);
    assert.match(shell, /id="tips-retry"[^>]*>Thử lại/);
  });

  test('the main load runs through the bounded bootstrap; no silent globals bail-out', () => {
    assert.match(behavior, /await runWritingBootstrap\(\{/);
    assert.doesNotMatch(behavior, /if \(!isCurrent\(\) \|\| !ok\) return;/);
  });

  test('a stuck AuthProvider (initial-loading) is bounded by a watchdog', () => {
    assert.match(behavior, /if \(status !== 'initial-loading'\) return;[\s\S]{0,200}runWritingBootstrap\(/);
  });

  test('tips, prompt bank, permissions and receipt reconcile reads carry deadlines', () => {
    assert.match(behavior, /withDeadline\(getBrowserJson\('\/api\/writing\/tips'/);
    assert.match(behavior, /withDeadline\(getBrowserJson\('\/api\/writing\/prompt-bank'/);
    assert.match(behavior, /getWithTimeout\(api, '\/api\/student\/permissions'\)/);
    assert.doesNotMatch(behavior, /await getBrowserJson\(/);
    assert.doesNotMatch(behavior, /api\.get\('\/api\/student\/permissions'\)/);
  });

  test('the receipt global the bootstrap waits on is not queued behind the markdown chain', () => {
    assert.match(layout, /<RouteScriptChain scripts=\{\[\{ src: '\/js\/writing-submit-receipt\.js' \}\]\} \/>/);
  });
});

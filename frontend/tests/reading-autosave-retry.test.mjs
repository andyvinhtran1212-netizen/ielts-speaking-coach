/**
 * reading-autosave-retry.test.mjs — DEBT-2026-07-22-D.
 *
 * Reading auto-save used to swallow every failure:
 *   savePromise.catch(function (e) { console.warn('auto-save failed q=' + qNum) })
 * with a comment claiming "the source of truth is in-memory + submit body".
 * That is true only for a submit from the SAME tab. Resume re-reads the
 * answers from the server (`reading_student.py` `_fetch_in_progress_payload`
 * → `reading_attempt_answers`), so a swallowed PATCH = the answer is gone the
 * moment the student refreshes — silently, with no cue anywhere.
 *
 * These are real-value tests: the retry cluster is extracted from
 * reading-exam.js and RUN against a stubbed api/DOM, so they assert what the
 * code does (how many PATCHes, what body, what cue), not that a string exists.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

const js = read('frontend/js/reading-exam.js');
const apiJs = read('frontend/js/api.js');

// ── Harness ─────────────────────────────────────────────────────────────
// Slice the DEBT-D cluster (from _SAVE_RETRY_DELAYS through
// _flushPendingSaves) and instantiate it with stub collaborators.
const SRC = js.slice(
  js.indexOf('var _SAVE_RETRY_DELAYS'),
  js.indexOf('function restoreAnswers()'),
);
assert.ok(SRC.includes('function patchAnswer'), 'patchAnswer not inside the extracted slice');
assert.ok(SRC.includes('function _flushPendingSaves'), '_flushPendingSaves not inside the extracted slice');

function makeHarness({ responder, shareMode = false } = {}) {
  const calls = [];
  const tiles = new Map();
  const makeTile = (q) => {
    const classes = new Set();
    return {
      dataset: { q: String(q) },
      attrs: {},
      classList: {
        toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
        contains: (c) => classes.has(c),
      },
      setAttribute(k, v) { this.attrs[k] = v; },
      removeAttribute(k) { delete this.attrs[k]; },
    };
  };
  const note = { hidden: true, textContent: '' };

  const SESSION = {
    attempt_id: 'att-1',
    timer_locked: false,
    share_mode: shareMode,
    answers: new Map(),
    unsaved: new Set(),
    debounce_timers: new Map(),
    save_retry_timers: new Map(),
  };

  const patchWith = (url, body, hdrs, opts) => {
    const n = calls.length;
    calls.push({ url, body, hdrs, opts });
    return responder(n, body);
  };
  const win = { api: { patchWith }, console: { warn() {} } };
  const doc = {
    querySelector: (sel) => {
      const m = /data-q="(\d+)"/.exec(sel);
      if (!m) return null;
      if (!tiles.has(m[1])) tiles.set(m[1], makeTile(m[1]));
      return tiles.get(m[1]);
    },
    getElementById: () => null,
  };

  const factory = new Function(
    'SESSION', 'window', 'document', '$', '_updatePaletteAriaLabel', '_anonHeaders',
    SRC + '\nreturn { patchAnswer: patchAnswer, _flushPendingSaves: _flushPendingSaves,' +
    ' _isRetriableSaveError: _isRetriableSaveError, delays: _SAVE_RETRY_DELAYS };',
  );
  const api = factory(
    SESSION, win, doc,
    (id) => (id === 'exam-unsaved-note' ? note : null),
    () => {},
    () => ({ 'X-Reading-Anon': 'anon-token' }),
  );
  // Collapse the real 400/1200/3000 backoff in place — the schedule is a
  // product decision, the retry COUNT is what these tests pin.
  for (let i = 0; i < api.delays.length; i++) api.delays[i] = 0;

  return { api, SESSION, calls, tiles, note };
}

const httpErr = (status) => Object.assign(new Error('HTTP ' + status), { status });
const netErr = () => new TypeError('Failed to fetch');   // no .status — fetch never answered

// ── Which failures are worth retrying ───────────────────────────────────

describe('DEBT-D — _isRetriableSaveError (real value)', () => {
  const { api } = makeHarness({ responder: () => Promise.resolve(null) });

  test('network failure (no status) → retry', () => {
    assert.equal(api._isRetriableSaveError(netErr()), true);
  });
  test('5xx → retry, including the postgrest-gateway 555 class (DEBT-E)', () => {
    for (const s of [500, 502, 503, 504, 555]) {
      assert.equal(api._isRetriableSaveError(httpErr(s)), true, 'status ' + s);
    }
  });
  test('4xx → do NOT retry (deterministic: access, attempt gone, bad body)', () => {
    for (const s of [400, 401, 403, 404, 409, 422]) {
      assert.equal(api._isRetriableSaveError(httpErr(s)), false, 'status ' + s);
    }
  });
});

// ── The retry itself ────────────────────────────────────────────────────

describe('DEBT-D — a transient failure is retried, not swallowed', () => {
  test('500 then 200 → two PATCHes, cue raised then cleared', async () => {
    const h = makeHarness({
      responder: (n) => (n === 0 ? Promise.reject(httpErr(500)) : Promise.resolve({ ok: true })),
    });
    h.SESSION.answers.set(7, 'volcano');
    await h.api.patchAnswer(7, 'volcano');

    assert.equal(h.calls.length, 2, 'expected one retry after the 500');
    assert.deepEqual(h.calls[1].body, { q_num: 7, user_answer: 'volcano' });
    assert.equal(h.SESSION.unsaved.has(7), false, 'unsaved must clear once the retry lands');
    assert.equal(h.tiles.get('7').classList.contains('is-unsaved'), false);
    assert.equal(h.note.hidden, true, 'the warning must disappear once the answer is saved');
  });

  test('persistent network failure → 1 + 3 attempts, then reported as unsaved', async () => {
    const h = makeHarness({ responder: () => Promise.reject(netErr()) });
    h.SESSION.answers.set(12, 'clay');
    await h.api.patchAnswer(12, 'clay');

    assert.equal(h.calls.length, 4, 'first attempt + 3 retries');
    assert.equal(h.SESSION.unsaved.has(12), true);
    const tile = h.tiles.get('12');
    assert.equal(tile.classList.contains('is-unsaved'), true, 'palette tile must show the unsaved state');
    assert.match(tile.attrs.title || '', /Chưa lưu được/);
    assert.equal(h.note.hidden, false, 'the student must be told, not just the console');
    assert.match(h.note.textContent, /1 câu/);
    assert.match(h.note.textContent, /Đừng đóng tab/);
  });

  test('403 is NOT retried — one call, cue still raised', async () => {
    const h = makeHarness({ responder: () => Promise.reject(httpErr(403)) });
    await h.api.patchAnswer(3, 'x');
    assert.equal(h.calls.length, 1, 'a 4xx would repeat identically — do not hammer');
    assert.equal(h.SESSION.unsaved.has(3), true);
  });

  test('the returned promise never rejects (fire-and-forget call sites)', async () => {
    const h = makeHarness({ responder: () => Promise.reject(netErr()) });
    // A rejection here would surface as an unhandled-rejection error-log row
    // for a failure the code already handles.
    await assert.doesNotReject(() => h.api.patchAnswer(5, 'y'));
  });

  test('the retry sends the CURRENT answer, not the stale one that failed', async () => {
    const h = makeHarness({
      responder: (n) => (n === 0 ? Promise.reject(httpErr(503)) : Promise.resolve(null)),
    });
    h.SESSION.answers.set(9, 'old');
    const p = h.api.patchAnswer(9, 'old');
    h.SESSION.answers.set(9, 'new');       // student edits while the retry waits
    await p;
    assert.equal(h.calls[1].body.user_answer, 'new',
      'replaying the stale value would overwrite the newer answer server-side');
  });

  test('a fresh edit cancels the pending retry chain (no duplicate PATCH)', async () => {
    let failFirst = true;
    const h = makeHarness({
      responder: () => (failFirst ? Promise.reject(httpErr(500)) : Promise.resolve(null)),
    });
    h.api.delays[0] = 30;                  // hold the first retry in the queue
    h.SESSION.answers.set(4, 'a');
    h.api.patchAnswer(4, 'a');
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(h.SESSION.save_retry_timers.has(4), true, 'retry should be pending');
    failFirst = false;
    await h.api.patchAnswer(4, 'b');       // fresh edit supersedes it
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(h.calls.length, 2, 'the superseded retry must not fire a third PATCH');
    assert.equal(h.SESSION.unsaved.has(4), false);
  });
});

// ── Unload flush ────────────────────────────────────────────────────────

describe('DEBT-D — _flushPendingSaves on the way out', () => {
  test('flushes debounced + failed answers with keepalive, from the in-memory store', async () => {
    const h = makeHarness({ responder: () => Promise.resolve(null) });
    h.SESSION.answers.set(1, 'alpha');
    h.SESSION.answers.set(2, 'beta');
    h.SESSION.debounce_timers.set(1, setTimeout(() => {
      throw new Error('the debounce must be cleared, not allowed to fire');
    }, 500));
    h.SESSION.unsaved.add(2);

    h.api._flushPendingSaves();
    await new Promise((r) => setTimeout(r, 5));

    assert.equal(h.calls.length, 2);
    assert.equal(h.SESSION.debounce_timers.size, 0, 'debounce queue must be drained');
    const byQ = Object.fromEntries(h.calls.map((c) => [c.body.q_num, c]));
    assert.equal(byQ[1].body.user_answer, 'alpha');
    assert.equal(byQ[2].body.user_answer, 'beta');
    // keepalive is the whole point — a plain fetch fired from pagehide dies
    // with the document.
    assert.equal(byQ[1].opts.keepalive, true);
    assert.equal(byQ[2].opts.keepalive, true);
  });

  test('a question queued twice (debounce + unsaved) is flushed once', async () => {
    const h = makeHarness({ responder: () => Promise.resolve(null) });
    h.SESSION.answers.set(6, 'once');
    h.SESSION.debounce_timers.set(6, setTimeout(() => {}, 500));
    h.SESSION.unsaved.add(6);
    h.api._flushPendingSaves();
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(h.calls.length, 1);
  });

  test('no attempt / locked timer → no PATCH at all', () => {
    const h = makeHarness({ responder: () => Promise.resolve(null) });
    h.SESSION.answers.set(1, 'x');
    h.SESSION.unsaved.add(1);
    h.SESSION.timer_locked = true;
    h.api._flushPendingSaves();
    h.SESSION.timer_locked = false;
    h.SESSION.attempt_id = null;
    h.api._flushPendingSaves();
    assert.equal(h.calls.length, 0);
  });

  test('both unload signals are wired (pagehide + visibilitychange→hidden)', () => {
    assert.match(js, /addEventListener\('pagehide', _flushPendingSaves\)/);
    assert.match(
      js,
      /visibilitychange[\s\S]{0,200}visibilityState === 'hidden'\) _flushPendingSaves\(\)/,
    );
  });
});

// ── Contracts that must not regress ─────────────────────────────────────

describe('DEBT-D — surrounding contracts held', () => {
  test('anon share-mode keeps X-Reading-Anon + noRedirect', async () => {
    const h = makeHarness({ responder: () => Promise.resolve(null), shareMode: true });
    await h.api.patchAnswer(1, 'x');
    assert.deepEqual(h.calls[0].hdrs, { 'X-Reading-Anon': 'anon-token' });
    assert.equal(h.calls[0].opts.noRedirect, true);
  });

  test('the authed path does NOT pass noRedirect (401 still bounces to login)', async () => {
    const h = makeHarness({ responder: () => Promise.resolve(null) });
    await h.api.patchAnswer(1, 'x');
    assert.equal(h.calls[0].hdrs, null);
    assert.ok(!h.calls[0].opts.noRedirect, 'authed 401 must keep redirecting to login');
  });

  test('api.js forwards opts.keepalive to fetch, opt-in only', () => {
    assert.match(apiJs, /keepalive: !!\(opts && opts\.keepalive\) \|\| undefined/);
    // `false || undefined` → undefined, so every existing caller sends the
    // exact same fetch init as before.
    assert.equal(!!(undefined && undefined) || undefined, undefined);
  });

  test('the palette aria-label announces the unsaved state', () => {
    const fnSrc = js.slice(js.indexOf('function _updatePaletteAriaLabel'));
    assert.match(fnSrc.slice(0, 700), /is-unsaved'\)\) parts\.push\('not saved to server'\)/);
  });
});

// ── Why this matters: the resume path really does read from the server ──

describe('DEBT-D — premise cross-check (backend)', () => {
  const router = read('backend/routers/reading_student.py');
  test('resume rebuilds answers from reading_attempt_answers, not client state', () => {
    const fn = router.slice(router.indexOf('def _fetch_in_progress_payload'));
    assert.match(fn.slice(0, 2500), /reading_attempt_answers/);
  });
});

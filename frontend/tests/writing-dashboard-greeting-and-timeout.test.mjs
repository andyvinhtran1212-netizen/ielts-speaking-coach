/**
 * frontend/tests/writing-dashboard-greeting-and-timeout.test.mjs
 *
 * Run with:
 *   node --test frontend/tests/writing-dashboard-greeting-and-timeout.test.mjs
 *
 * Regression for the S2 writing-dashboard bug (after #1691):
 *   - greeting read "Chào em, em 👋" (empty name, duplicated "em"),
 *   - "Mã học viên: —",
 *   - "Bài giao" tab stuck on "Đang tải…" for 25s+ and never loading.
 *
 * Root cause: renderStudent() only runs inside the SUCCESS path of
 * loadAssignments/loadEssays, which called api.get() with NO client-side
 * timeout. fetch() has no default timeout, so a stalled backend read left the
 * await hanging forever — the greeting + code stayed at the static placeholders
 * and the list stayed on "Đang tải…". The greeting fallback also duplicated
 * "em" against the static "Chào em,".
 *
 * These tests pin the real behaviour of the extracted helpers + the shell /
 * behaviour wiring (source-level guards, since the .tsx is not importable here).
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { writingGreetingParts, writingStudentCode } from '../lib/writing-dashboard-student.mjs';
import { getWithTimeout, DEFAULT_REQUEST_TIMEOUT_MS } from '../lib/request-with-timeout.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));


// ── Greeting: account name, clean single-"em" fallback ────────────────

describe('writingGreetingParts', () => {
  test('a name yields a comma separator + the name ("Chào em, <name>")', () => {
    assert.deepEqual(writingGreetingParts({ full_name: 'Vinh Tran' }),
      { separator: ', ', name: 'Vinh Tran' });
  });

  test('no name yields empty separator + empty name (one clean "em")', () => {
    for (const s of [null, undefined, {}, { full_name: '' }, { full_name: '   ' }, { full_name: 42 }]) {
      assert.deepEqual(writingGreetingParts(s), { separator: '', name: '' },
        `no-name input ${JSON.stringify(s)} must not inject a stray "em" or comma`);
    }
  });

  test('a surrounding static "Chào em" never renders "Chào em, em"', () => {
    const render = (s) => {
      const { separator, name } = writingGreetingParts(s);
      return `Chào em${separator}${name} 👋`;
    };
    assert.equal(render({ full_name: 'Vinh Tran' }), 'Chào em, Vinh Tran 👋');
    assert.equal(render({}), 'Chào em 👋');
    assert.equal(render(null), 'Chào em 👋');
  });
});

describe('writingStudentCode', () => {
  test('returns the roster code when present', () => {
    assert.equal(writingStudentCode({ student_code: 'Tester01' }), 'Tester01');
  });
  test('falls back to "—" when the code is missing/blank', () => {
    for (const s of [null, undefined, {}, { student_code: '' }, { student_code: '  ' }]) {
      assert.equal(writingStudentCode(s), '—');
    }
  });
});


// ── Request timeout: never hang on "Đang tải…" ────────────────────────

class FakeAbortController {
  constructor() { this.signal = { aborted: false, onabort: null }; }
  abort() { this.signal.aborted = true; if (this.signal.onabort) this.signal.onabort(); }
}

describe('getWithTimeout', () => {
  test('default timeout is a bounded, finite value', () => {
    assert.ok(Number.isFinite(DEFAULT_REQUEST_TIMEOUT_MS) && DEFAULT_REQUEST_TIMEOUT_MS > 0);
    // Must be shorter than the observed 25s hang so the user sees an error.
    assert.ok(DEFAULT_REQUEST_TIMEOUT_MS < 25000);
  });

  test('resolves with data and clears the timer when the request wins', async () => {
    let cleared = false;
    const api = {
      get: () => { throw new Error('should use getWith when abortable'); },
      getWith: (p, h, o) => { assert.ok(o && o.signal, 'signal passed through'); return Promise.resolve({ ok: true, path: p }); },
    };
    const data = await getWithTimeout(api, '/x', {
      timeoutMs: 1000, AbortCtor: FakeAbortController,
      setTimer: () => 'id', clearTimer: () => { cleared = true; },
    });
    assert.deepEqual(data, { ok: true, path: '/x' });
    assert.ok(cleared, 'timer must be cleared on success');
  });

  test('a stalled request is aborted and rejects with a tagged, clear error', async () => {
    let fire = null;
    const api = {
      get: () => new Promise(() => {}),
      // Mirrors fetch: aborting the signal rejects the in-flight request.
      getWith: (_p, _h, o) => new Promise((_resolve, reject) => {
        o.signal.onabort = () => reject(new Error('AbortError'));
      }),
    };
    const p = getWithTimeout(api, '/slow', {
      timeoutMs: 50, message: 'Tải dữ liệu quá lâu. Vui lòng tải lại trang.',
      AbortCtor: FakeAbortController,
      setTimer: (cb) => { fire = cb; return 'id'; },
      clearTimer: () => {},
    });
    assert.ok(typeof fire === 'function', 'a timeout must be scheduled');
    fire(); // simulate the deadline elapsing
    await assert.rejects(p, (e) => e.timeout === true && e.message === 'Tải dữ liệu quá lâu. Vui lòng tải lại trang.');
  });

  test('rejects at the deadline even when the transport NEVER settles (stalled session retrieval)', async () => {
    // Reproduces the real api.js flow: getWith() awaits _getAuthToken() →
    // auth.getSession() BEFORE it ever reaches fetch(). If getSession() stalls,
    // fetch is never created, so aborting the signal cancels nothing and the
    // transport promise stays pending forever. The wrapper MUST still reject
    // with the tagged timeout error at the deadline rather than hang.
    let fire = null;
    let aborted = false;
    const neverResolvingGetSession = () => new Promise(() => {});
    const api = {
      get: () => { throw new Error('should use getWith when abortable'); },
      // Mirror api.js: await the (stalled) session BEFORE touching fetch. The
      // signal is observed but never has an in-flight fetch to abort.
      getWith: async (_p, _h, o) => {
        o.signal.onabort = () => { aborted = true; };
        await neverResolvingGetSession();
        /* fetch(...) is never reached */
        return { unreachable: true };
      },
    };
    const p = getWithTimeout(api, '/api/writing/my-assignments', {
      timeoutMs: 10, message: 'Tải dữ liệu quá lâu. Vui lòng tải lại trang.',
      AbortCtor: FakeAbortController,
      setTimer: (cb) => { fire = cb; return 'id'; },
      clearTimer: () => {},
    });
    assert.ok(typeof fire === 'function', 'a timeout must be scheduled');
    fire(); // deadline elapses while the transport is still pending on getSession
    await assert.rejects(p, (e) => e.timeout === true && e.message === 'Tải dữ liệu quá lâu. Vui lòng tải lại trang.',
      'must reject with the tagged timeout error despite a never-settling transport');
    assert.ok(aborted, 'abort() is still attempted as best-effort cancellation');
  });

  test('falls back to a plain get when AbortController is unavailable', async () => {
    let usedGet = false;
    const api = {
      get: () => { usedGet = true; return Promise.resolve({ ok: 1 }); },
      getWith: () => { throw new Error('must not use getWith without abort support'); },
    };
    const data = await getWithTimeout(api, '/x', { AbortCtor: null });
    assert.ok(usedGet);
    assert.deepEqual(data, { ok: 1 });
  });
});


// ── Source-level wiring guards (the .tsx is not importable here) ───────

describe('writing dashboard shell + behaviour wiring', () => {
  let shell;
  let behavior;
  before(() => {
    const dir = path.join(__dirname, '..', 'app', '(authed-writing)', 'writing', 'dashboard');
    shell = readFileSync(path.join(dir, 'page-shell.tsx'), 'utf8');
    behavior = readFileSync(path.join(dir, 'writing-behavior.tsx'), 'utf8');
  });

  test('shell greeting no longer hardcodes the duplicated "Chào em, em"', () => {
    // The old markup was: Chào em, <span id="greeting-name">em</span>
    assert.doesNotMatch(shell, /Chào em,\s*<span id="greeting-name">em<\/span>/,
      'static "Chào em, " + span default "em" reproduced "Chào em, em"');
    assert.match(shell, /id="greeting-sep"/, 'greeting separator span must exist');
    assert.match(shell, /id="greeting-name"><\/span>/, 'greeting-name must default to empty, not "em"');
  });

  test('both canonical loads go through the timeout wrapper, not a raw api.get', () => {
    assert.match(behavior, /getWithTimeout\(api, '\/api\/writing\/my-assignments'\)/);
    assert.match(behavior, /getWithTimeout\(api, '\/api\/writing\/my-essays'\)/);
    assert.doesNotMatch(behavior, /await api\.get\('\/api\/writing\/my-(assignments|essays)'\)/,
      'raw untimed api.get on the list endpoints reintroduces the forever-hang');
  });

  test('a timeout surfaces its clear message instead of a generic fallback', () => {
    assert.match(behavior, /err\?\.timeout \? err\.message/);
  });
});

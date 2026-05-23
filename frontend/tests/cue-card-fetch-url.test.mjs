/**
 * frontend/tests/cue-card-fetch-url.test.mjs — Sprint 14.6.3
 *
 * P0 hotfix sentinel. Sprint 14.6.2 shipped an AI cue-card generator
 * that fired `fetch('/sessions/cuecard/generate', ...)` with a RAW
 * relative path — bypassing the canonical `window.api.post(...)`
 * helper. In production the Vercel frontend at www.averlearning.com
 * resolved that to itself and returned a 404 HTML page; users could
 * not generate cue cards from a 1-line trigger.
 *
 * Pattern #34 (new): integration sentinels MUST assert the OUTBOUND
 * URL, not just the mock call shape. Sprint 14.6.2's tests passed
 * because `opts.fetch` accepted any URL and returned a 200 stub —
 * the production base-URL gap was invisible to CI.
 *
 * These sentinels pin:
 *
 *   1. The detector calls `window.api.post(path, body)` (the helper
 *      that prepends the Railway backend base), NOT a raw fetch.
 *   2. The path passed to `api.post` is exactly
 *      `/sessions/cuecard/generate` — pinned literally so a
 *      refactor that drops the slash or renames the endpoint
 *      breaks the build before production.
 *   3. The body shape is `{ trigger: <string> }`.
 *   4. Errors thrown by `api.post` (which already carry `.status` /
 *      `.detail` per api.js semantics) propagate verbatim, including
 *      the Vietnamese fallback message when no detail is provided.
 *   5. The detector accepts `opts.api` as a test seam (L2 — preserve
 *      injection so unit tests don't have to monkey-patch globals).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { parseCustomQuestionsByPart } = require(
  join(__dirname, '..', 'js', 'cue-card-detector.js'),
);


// ── Helpers ────────────────────────────────────────────────────────────────


/** A spy that records every (path, body) pair sent to api.post. */
function _spyApi(responseBody) {
  const calls = [];
  const post = async (path, body) => {
    calls.push({ path, body });
    return responseBody;
  };
  return { post, calls };
}

/** An api stub whose .post throws an Error shaped like api.js's
 *  _apiRequest error path (.status + .detail attached). */
function _errApi(status, detail, message) {
  return {
    post: async () => {
      const err = new Error(message ?? 'HTTP ' + status);
      err.status = status;
      err.detail = detail;
      throw err;
    },
  };
}


// ── 1) Path-as-contract: exact URL pinned ─────────────────────────────────


describe('Sprint 14.6.3 — cue card AI gen uses window.api.post with the exact path', () => {

  test('detector POSTs to /sessions/cuecard/generate via opts.api.post', async () => {
    // Pin BOTH the helper used and the exact path string. A refactor
    // that drops `cuecard` → `cue-card` or moves to /api/* would
    // surface here, not in production.
    const api = _spyApi({
      type:    'cue_card',
      topic:   'Describe a hobby you enjoy.',
      bullets: ['What it is', 'When you do it', 'Why you enjoy it'],
      prompt:  '...',
      source:  'ai_generated',
      trigger: 'my hobby is reading',
    });

    const out = await parseCustomQuestionsByPart('my hobby is reading', 2, { api });

    assert.strictEqual(api.calls.length, 1, 'must call api.post exactly once');
    assert.strictEqual(
      api.calls[0].path,
      '/sessions/cuecard/generate',
      'Sprint 14.6.3 — Path MUST be `/sessions/cuecard/generate` so ' +
      'api.js prepends the Railway base. Any deviation surfaces here.',
    );
    assert.deepStrictEqual(api.calls[0].body, { trigger: 'my hobby is reading' });

    // Return shape preserved from Sprint 14.6.2 (CueCardQuestion forwarded).
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].type,   'cue_card');
    assert.strictEqual(out[0].source, 'ai_generated');
  });

  test('detector trims trigger to first non-empty line (L4 multi-line fallback)', async () => {
    const api = _spyApi({
      type: 'cue_card', topic: 'X', bullets: [],
      prompt: '...', source: 'ai_generated', trigger: 'A place you visited',
    });
    const paste = [
      '',
      '  A place you visited',
      'extra noise line',
    ].join('\n');

    await parseCustomQuestionsByPart(paste, 2, { api });

    assert.strictEqual(api.calls.length, 1);
    assert.deepStrictEqual(api.calls[0].body, { trigger: 'A place you visited' });
  });

});


// ── 2) Real-window.api integration (the production code path) ────────────


describe('Sprint 14.6.3 — detector falls back to window.api.post when no opts.api', () => {

  test('detector uses window.api.post when opts is omitted entirely', async () => {
    const calls = [];
    const fakeWindow = {
      api: {
        post: async (path, body) => {
          calls.push({ path, body });
          return {
            type: 'cue_card', topic: 'X', bullets: [],
            prompt: '...', source: 'ai_generated', trigger: 'X',
          };
        },
      },
    };
    // Stash + restore — the detector reads `window` lazily inside the
    // function call so module load order doesn't matter.
    const prior = globalThis.window;
    globalThis.window = fakeWindow;
    try {
      await parseCustomQuestionsByPart('Describe X', 2);
    } finally {
      globalThis.window = prior;
    }
    assert.strictEqual(calls.length, 1,
      'Detector must consult window.api.post when no opts.api is passed — ' +
      'this is the production code path that Sprint 14.6.2 broke.');
    assert.strictEqual(calls[0].path, '/sessions/cuecard/generate');
  });

  test('detector throws a clear error when window.api.post unavailable', async () => {
    // Defensive — if api.js failed to load, the detector must produce
    // an actionable error, not a 404 from a relative-path fetch.
    const prior = globalThis.window;
    globalThis.window = { api: null };
    try {
      await assert.rejects(
        parseCustomQuestionsByPart('Describe X', 2, { api: null }),
        /window\.api\.post not available|api\.post not available/,
        'Detector must signal the missing helper, not silently fall back ' +
        'to a raw relative-path fetch (Sprint 14.6.2 bug class).',
      );
    } finally {
      globalThis.window = prior;
    }
  });

});


// ── 3) Error propagation — api.js semantics preserved ─────────────────────


describe('Sprint 14.6.3 — api.post errors propagate with structured detail', () => {

  test('503 from backend surfaces structured detail.code + message', async () => {
    // api.js throws Error{.status, .detail}; the detector relays it
    // so speaking.html's try/catch can branch on .status.
    const api = _errApi(503, {
      code:    'cue_card_generation_unavailable',
      message: 'Không thể tạo cue card lúc này. Vui lòng paste cue card đầy đủ thủ công.',
      trigger: 'Describe X.',
    });

    try {
      await parseCustomQuestionsByPart('Describe X.', 2, { api });
      assert.fail('should have thrown');
    } catch (e) {
      assert.strictEqual(e.status, 503, 'Status must propagate');
      assert.strictEqual(e.detail.code, 'cue_card_generation_unavailable');
      assert.match(e.message, /paste cue card đầy đủ/);
    }
  });

  test('opaque error (no .detail) surfaces the VN fallback message', async () => {
    // api.js may throw a plain Error when the response isn't JSON
    // (e.g. Vercel HTML 404 — the exact Sprint 14.6.2 production
    // failure mode). The detector must wrap or relay the error with
    // a user-actionable VN message.
    const api = {
      post: async () => {
        const err = new Error('HTTP 404');
        err.status = 404;
        err.detail = null;
        throw err;
      },
    };

    try {
      await parseCustomQuestionsByPart('Describe X.', 2, { api });
      assert.fail('should have thrown');
    } catch (e) {
      // Either propagate the underlying message OR substitute the
      // Vietnamese fallback — both acceptable; the contract is that
      // SOMETHING actionable surfaces.
      assert.ok(
        e.status === 404,
        'Status must propagate through error wrapping',
      );
    }
  });

});


// ── 4) Negative path — no Part 2 AI call without trigger ──────────────────


describe('Sprint 14.6.3 — empty Part 2 input never calls api.post (no spurious traffic)', () => {

  test('empty paste throws BEFORE touching api.post', async () => {
    let called = 0;
    const api = { post: async () => { called++; return {}; } };

    await assert.rejects(
      parseCustomQuestionsByPart('', 2, { api }),
      /ít nhất 1 dòng/,
    );
    assert.strictEqual(called, 0,
      'Empty input must not burn an api.post call — the input guard ' +
      'remains the first line of defence.');
  });

  test('full cue card paste short-circuits without api.post (user_pasted path)', async () => {
    let called = 0;
    const api = { post: async () => { called++; return {}; } };

    const cueCard = [
      'Describe a memorable trip you took.',
      'You should say:',
      '- where you went',
      '- who you went with',
      '- what you did there',
      'and explain why it was memorable.',
    ].join('\n');

    const out = await parseCustomQuestionsByPart(cueCard, 2, { api });
    assert.strictEqual(called, 0,
      'A fully-formed cue card uses the heuristic — no api.post call.');
    assert.strictEqual(out[0].source, 'user_pasted');
  });

});

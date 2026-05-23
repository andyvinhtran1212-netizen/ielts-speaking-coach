/**
 * frontend/tests/cue-card-part-router.test.mjs — Sprint 14.6.2 (created)
 *                                              — Sprint 14.6.3 (migrated)
 *
 * Behaviour tests for `parseCustomQuestionsByPart` — the Sprint 14.6.2
 * replacement for the Sprint 14.4 three-option toggle. Routing
 * decisions flow from the Part selector.
 *
 * Sprint 14.6.3 migration: the AI-cue-card branch now goes through
 * `window.api.post(...)` (the canonical helper that prepends the
 * Railway backend base URL) instead of a raw `fetch('/sessions/...')`.
 * The `opts.fetch` test seam is gone; tests now inject `opts.api`
 * (an object with a `.post(path, body)` async method). This file
 * was migrated from the Sprint 14.6.2 fetch-mock shape to the new
 * api-stub shape — see `cue-card-fetch-url.test.mjs` for the URL +
 * helper-routing sentinels that pin Sprint 14.6.3's contract.
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


/** Build a stub api whose .post returns the given JSON body. */
function _okApi(body) {
  return {
    post: async (_path, _body) => body,
  };
}

/** Build a stub api whose .post throws an Error shaped like api.js's
 *  _apiRequest error path (.status + .detail attached). */
function _errApi(status, detail) {
  return {
    post: async () => {
      const err = new Error((detail && detail.message) || 'HTTP ' + status);
      err.status = status;
      err.detail = detail;
      throw err;
    },
  };
}

/** Build a stub api that records every call for assertion. */
function _spyApi(responseBody) {
  const calls = [];
  const post = async (path, body) => {
    calls.push({ path, body });
    return responseBody;
  };
  return { post, calls };
}


// ── Part 1 / Part 3 — naive split ─────────────────────────────────────────


describe('Sprint 14.6.2 — Part 1/3 route through naive single-question split', () => {

  test('Part 1: each line becomes a separate question string', async () => {
    const out = await parseCustomQuestionsByPart(
      'What is your favourite season?\nDo you like rainy days?\nHow do you spend weekends?',
      1,
      { api: { post: () => { throw new Error('Part 1 must not call api.post'); } } },
    );
    assert.deepStrictEqual(out, [
      'What is your favourite season?',
      'Do you like rainy days?',
      'How do you spend weekends?',
    ]);
  });

  test('Part 3: each line becomes a separate question string', async () => {
    const out = await parseCustomQuestionsByPart(
      'How has technology changed education?\nWhat skills will children need?',
      3,
      { api: { post: () => { throw new Error('Part 3 must not call api.post'); } } },
    );
    assert.deepStrictEqual(out, [
      'How has technology changed education?',
      'What skills will children need?',
    ]);
  });

  test('Part 1/3 caps at 10 questions to match legacy naive-split behaviour', async () => {
    // L8 — preserves the pre-Sprint-14.4 `.slice(0, 10)` cap; protects the
    // backend from a runaway 50-line paste.
    const lines = Array.from({ length: 25 }, (_, i) => `Q${i + 1}?`).join('\n');
    const out = await parseCustomQuestionsByPart(lines, 1);
    assert.strictEqual(out.length, 10);
    assert.strictEqual(out[0],  'Q1?');
    assert.strictEqual(out[9],  'Q10?');
  });

  test('Part 1: empty string returns empty list (no error, no api call)', async () => {
    let called = false;
    const api = { post: async () => { called = true; throw new Error('boom'); } };
    const out = await parseCustomQuestionsByPart('', 1, { api });
    assert.deepStrictEqual(out, []);
    assert.strictEqual(called, false);
  });

});


// ── Part 2 — case A: full cue card paste (Sprint 14.4 heuristic) ──────────


describe('Sprint 14.6.2 — Part 2 + full cue card paste short-circuits AI gen', () => {

  test('detected cue card returns user_pasted source, no api call', async () => {
    let apiCalled = false;
    const cueCard = [
      'Describe a memorable trip you took.',
      'You should say:',
      '- where you went',
      '- who you went with',
      '- what you did there',
      'and explain why it was memorable.',
    ].join('\n');

    const out = await parseCustomQuestionsByPart(cueCard, 2, {
      api: { post: async () => { apiCalled = true; throw new Error('no api'); } },
    });

    assert.strictEqual(apiCalled, false,
      'Full cue card paste must not call the AI gen endpoint');
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].type,   'cue_card');
    assert.strictEqual(out[0].source, 'user_pasted_multiline');
    assert.strictEqual(out[0].topic,  'Describe a memorable trip you took.');
    assert.deepStrictEqual(out[0].bullets, [
      'where you went', 'who you went with', 'what you did there',
    ]);
    // The whole paste flows through as the rendered prompt — preserves
    // the user's exact wording for the Part 2 monologue UI.
    assert.ok(out[0].prompt.includes('and explain why it was memorable.'));
  });

});


// ── Part 2 — case B: 1-line trigger → AI gen ──────────────────────────────


describe('Sprint 14.6.2 — Part 2 + non-cue-card paste calls AI cue card gen', () => {

  test('1-line trigger calls api.post(/sessions/cuecard/generate, {trigger})', async () => {
    const api = _spyApi({
      type:    'cue_card',
      topic:   'Describe a hobby you enjoy.',
      bullets: ['What it is', 'When you do it', 'Why you enjoy it'],
      prompt:  'Describe a hobby you enjoy.\nYou should say:\n- What it is\n- When you do it\n- Why you enjoy it\nand explain why this hobby is important to you.',
      source:  'ai_generated',
      trigger: 'my hobby is reading',
    });

    const out = await parseCustomQuestionsByPart('my hobby is reading', 2, { api });

    assert.strictEqual(api.calls.length, 1, 'must call api.post exactly once');
    assert.strictEqual(api.calls[0].path, '/sessions/cuecard/generate');
    assert.deepStrictEqual(api.calls[0].body, { trigger: 'my hobby is reading' });

    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].type,    'cue_card');
    assert.strictEqual(out[0].source,  'ai_generated');
    assert.strictEqual(out[0].topic,   'Describe a hobby you enjoy.');
    assert.strictEqual(out[0].trigger, 'my hobby is reading');
    assert.deepStrictEqual(out[0].bullets,
      ['What it is', 'When you do it', 'Why you enjoy it']);
  });

  test('multi-line non-cue-card paste uses first non-empty line as trigger (L4)', async () => {
    // L4 — when the user pastes multiple lines that aren't a cue card,
    // use the first non-empty line as the trigger and ignore the rest.
    // Better UX than rejecting; the alternative is a confusing error for
    // someone who pasted a paragraph by mistake.
    const api = _spyApi({
      type:    'cue_card',
      topic:   'Describe a place you visited.',
      bullets: ['a', 'b', 'c'],
      prompt:  '...',
      source:  'ai_generated',
      trigger: 'A place you visited',
    });

    const paste = [
      '',
      '  A place you visited',
      'extra context line that user added',
      'another stray line',
    ].join('\n');

    const out = await parseCustomQuestionsByPart(paste, 2, { api });

    assert.strictEqual(api.calls.length, 1);
    assert.deepStrictEqual(api.calls[0].body, { trigger: 'A place you visited' });
    assert.strictEqual(out[0].type, 'cue_card');
  });

  test('forwards `source` from backend payload verbatim (audit field)', async () => {
    // Even if the backend ever returned a different source (future
    // human-curated fallback path), the detector must relay it as-is so
    // the admin / audit surfaces see canonical provenance.
    const api = _okApi({
      type:    'cue_card',
      topic:   'X',
      bullets: ['a', 'b'],
      prompt:  'X\nYou should say:\n- a\n- b',
      source:  'ai_generated',
      trigger: 'X',
    });
    const out = await parseCustomQuestionsByPart('X', 2, { api });
    assert.strictEqual(out[0].source, 'ai_generated');
  });

});


// ── Part 2 — error paths ───────────────────────────────────────────────────


describe('Sprint 14.6.2 — Part 2 error paths surface actionable messages', () => {

  test('empty paste throws with Vietnamese message (no api call)', async () => {
    let apiCalled = false;
    await assert.rejects(
      parseCustomQuestionsByPart('', 2, {
        api: { post: async () => { apiCalled = true; return {}; } },
      }),
      /ít nhất 1 dòng/,
    );
    assert.strictEqual(apiCalled, false,
      'Empty paste must short-circuit before any api call');
  });

  test('whitespace-only paste throws (no api call)', async () => {
    let apiCalled = false;
    await assert.rejects(
      parseCustomQuestionsByPart('   \n  \n   ', 2, {
        api: { post: async () => { apiCalled = true; return {}; } },
      }),
      /ít nhất 1 dòng/,
    );
    assert.strictEqual(apiCalled, false);
  });

  test('503 from AI gen endpoint surfaces backend message verbatim', async () => {
    // api.js throws Error{.status, .detail, .message} on non-2xx; the
    // detector relays it so the UI can show backend Vietnamese copy
    // verbatim. .message is set from detail.message when present.
    await assert.rejects(
      parseCustomQuestionsByPart('Describe X.', 2, {
        api: _errApi(503, {
          code:    'cue_card_generation_unavailable',
          message: 'Không thể tạo cue card lúc này. Vui lòng paste cue card đầy đủ thủ công.',
          trigger: 'Describe X.',
        }),
      }),
      /paste cue card đầy đủ/,
    );
  });

  test('thrown error carries .status and .detail for UI branching', async () => {
    try {
      await parseCustomQuestionsByPart('Describe X.', 2, {
        api: _errApi(503, {
          code:    'cue_card_generation_unavailable',
          message: 'Hãy paste cue card đầy đủ.',
          trigger: 'Describe X.',
        }),
      });
      assert.fail('should have thrown');
    } catch (e) {
      assert.strictEqual(e.status, 503);
      assert.strictEqual(e.detail.code, 'cue_card_generation_unavailable');
      assert.strictEqual(e.detail.trigger, 'Describe X.');
    }
  });

  test('opaque HTTP error (no detail) still throws with a fallback VN message', async () => {
    // Sprint 14.6.3 — this is the failure mode that bit production:
    // a Vercel 404 HTML page comes through api.js as a plain
    // Error.message = "HTTP 404" with no detail. The detector
    // substitutes the VN actionable fallback so the user doesn't see
    // raw "HTTP 404" text.
    const api = {
      post: async () => {
        const err = new Error('HTTP 502');
        err.status = 502;
        err.detail = null;
        throw err;
      },
    };
    try {
      await parseCustomQuestionsByPart('X', 2, { api });
      assert.fail('should have thrown');
    } catch (e) {
      assert.match(e.message, /Không thể tạo cue card|paste cue card đầy đủ/i);
      assert.strictEqual(e.status, 502);
    }
  });

  test('unsupported partNum throws synchronously', async () => {
    await assert.rejects(
      parseCustomQuestionsByPart('anything', 4),
      /unsupported partNum/,
    );
  });

  test('user_pasted cue card path short-circuits before needing api.post', async () => {
    // Pin the contract that a fully-formed cue card never tries to
    // hit the network — even if no api seam were provided, this path
    // would still succeed.
    const out = await parseCustomQuestionsByPart(
      'Describe X.\nYou should say:\n- a\n- b\nand explain.', 2,
      { api: { post: () => { throw new Error('api.post must not be called for user_pasted path'); } } },
    );
    assert.strictEqual(out[0].source, 'user_pasted_multiline');
  });

});


// ── Backward compat: parseCustomQuestions kept as L10 alias ───────────────


describe('Sprint 14.6.2 — Sprint 14.4 parseCustomQuestions still exported (L10)', () => {

  test('parseCustomQuestions function still exists on the module', () => {
    const mod = require(join(__dirname, '..', 'js', 'cue-card-detector.js'));
    assert.strictEqual(typeof mod.parseCustomQuestions, 'function',
      'Sprint 14.4 parseCustomQuestions must remain for L10 backward compat ' +
      '(other surfaces may still import it)');
  });

});

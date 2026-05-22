/**
 * frontend/tests/cue-card-part-router.test.mjs — Sprint 14.6.2.
 *
 * Behaviour tests for `parseCustomQuestionsByPart` — the Sprint 14.6.2
 * replacement for the Sprint 14.4 three-option toggle. Routing decisions
 * now flow from the Part selector instead of a redundant radio group
 * (Andy's 2026-05-22 17:03 screenshot).
 *
 * Routing contract (commission locks L2 + L3):
 *   - Part 1 + Part 3 → naive split into single questions (legacy path).
 *   - Part 2 + paste matches detectCueCard heuristic → use the paste
 *     verbatim as a cue card; `source: "user_pasted"`.
 *   - Part 2 + heuristic fails → POST first non-empty line as `trigger`
 *     to `/sessions/cuecard/generate`; relay the AI-generated cue card
 *     with `source: "ai_generated"`.
 *
 * The `opts.fetch` testing seam lets us stub the network without
 * monkey-patching globalThis.fetch, keeping each test isolated.
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


/** Build a stub fetch that returns the given JSON body with status 200. */
function _okFetch(body) {
  return async (_url, _init) => ({
    ok:     true,
    status: 200,
    json:   async () => body,
  });
}

/** Build a stub fetch that returns a structured error response. */
function _errFetch(status, detail) {
  return async (_url, _init) => ({
    ok:     false,
    status: status,
    json:   async () => ({ detail: detail }),
  });
}

/** Build a stub fetch that records the request for assertion. */
function _spyFetch(responseBody) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: url, init: init });
    return {
      ok:     true,
      status: 200,
      json:   async () => responseBody,
    };
  };
  impl.calls = calls;
  return impl;
}


// ── Part 1 / Part 3 — naive split ─────────────────────────────────────────


describe('Sprint 14.6.2 — Part 1/3 route through naive single-question split', () => {

  test('Part 1: each line becomes a separate question string', async () => {
    const out = await parseCustomQuestionsByPart(
      'What is your favourite season?\nDo you like rainy days?\nHow do you spend weekends?',
      1,
      { fetch: () => { throw new Error('Part 1 must not call fetch'); } },
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
      { fetch: () => { throw new Error('Part 3 must not call fetch'); } },
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

  test('Part 1: empty string returns empty list (no error, no fetch)', async () => {
    let called = false;
    const out = await parseCustomQuestionsByPart('', 1, {
      fetch: async () => { called = true; throw new Error('boom'); },
    });
    assert.deepStrictEqual(out, []);
    assert.strictEqual(called, false);
  });

});


// ── Part 2 — case A: full cue card paste (Sprint 14.4 heuristic) ──────────


describe('Sprint 14.6.2 — Part 2 + full cue card paste short-circuits AI gen', () => {

  test('detected cue card returns user_pasted source, no fetch call', async () => {
    let fetchCalled = false;
    const cueCard = [
      'Describe a memorable trip you took.',
      'You should say:',
      '- where you went',
      '- who you went with',
      '- what you did there',
      'and explain why it was memorable.',
    ].join('\n');

    const out = await parseCustomQuestionsByPart(cueCard, 2, {
      fetch: async () => { fetchCalled = true; throw new Error('no fetch'); },
    });

    assert.strictEqual(fetchCalled, false,
      'Full cue card paste must not call the AI gen endpoint');
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].type,   'cue_card');
    assert.strictEqual(out[0].source, 'user_pasted');
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

  test('1-line trigger POSTs to /sessions/cuecard/generate with trigger payload', async () => {
    const spy = _spyFetch({
      type:    'cue_card',
      topic:   'Describe a hobby you enjoy.',
      bullets: ['What it is', 'When you do it', 'Why you enjoy it'],
      prompt:  'Describe a hobby you enjoy.\nYou should say:\n- What it is\n- When you do it\n- Why you enjoy it\nand explain why this hobby is important to you.',
      source:  'ai_generated',
      trigger: 'my hobby is reading',
    });

    const out = await parseCustomQuestionsByPart('my hobby is reading', 2, { fetch: spy });

    assert.strictEqual(spy.calls.length, 1, 'must call fetch exactly once');
    const call = spy.calls[0];
    assert.strictEqual(call.url, '/sessions/cuecard/generate');
    assert.strictEqual(call.init.method, 'POST');
    assert.strictEqual(call.init.headers['Content-Type'], 'application/json');
    assert.deepStrictEqual(JSON.parse(call.init.body), { trigger: 'my hobby is reading' });

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
    const spy = _spyFetch({
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

    const out = await parseCustomQuestionsByPart(paste, 2, { fetch: spy });

    assert.strictEqual(spy.calls.length, 1);
    assert.deepStrictEqual(
      JSON.parse(spy.calls[0].init.body),
      { trigger: 'A place you visited' },
    );
    assert.strictEqual(out[0].type, 'cue_card');
  });

  test('forwards `source` from backend payload verbatim (audit field)', async () => {
    // Even if the backend ever returned a different source (future
    // human-curated fallback path), the detector must relay it as-is so
    // the admin / audit surfaces see canonical provenance.
    const spy = _spyFetch({
      type:    'cue_card',
      topic:   'X',
      bullets: ['a', 'b'],
      prompt:  'X\nYou should say:\n- a\n- b',
      source:  'ai_generated',
      trigger: 'X',
    });
    const out = await parseCustomQuestionsByPart('X', 2, { fetch: spy });
    assert.strictEqual(out[0].source, 'ai_generated');
  });

});


// ── Part 2 — error paths ───────────────────────────────────────────────────


describe('Sprint 14.6.2 — Part 2 error paths surface actionable messages', () => {

  test('empty paste throws with Vietnamese message (no fetch)', async () => {
    let fetchCalled = false;
    await assert.rejects(
      parseCustomQuestionsByPart('', 2, {
        fetch: async () => { fetchCalled = true; return { ok: true, json: async () => ({}) }; },
      }),
      /ít nhất 1 dòng/,
    );
    assert.strictEqual(fetchCalled, false,
      'Empty paste must short-circuit before any network call');
  });

  test('whitespace-only paste throws (no fetch)', async () => {
    let fetchCalled = false;
    await assert.rejects(
      parseCustomQuestionsByPart('   \n  \n   ', 2, {
        fetch: async () => { fetchCalled = true; return { ok: true, json: async () => ({}) }; },
      }),
      /ít nhất 1 dòng/,
    );
    assert.strictEqual(fetchCalled, false);
  });

  test('503 from AI gen endpoint surfaces backend message verbatim', async () => {
    // The endpoint returns `detail.message` in Vietnamese with the
    // paste-manually hint. The detector must propagate it so the UI
    // doesn't have to re-translate generic English copy.
    const err = await assert.rejects(
      parseCustomQuestionsByPart('Describe X.', 2, {
        fetch: _errFetch(503, {
          code:    'cue_card_generation_unavailable',
          message: 'Không thể tạo cue card lúc này. Vui lòng paste cue card đầy đủ thủ công.',
          trigger: 'Describe X.',
        }),
      }),
      /paste cue card đầy đủ/,
    );
    // `err.status` is exposed on the thrown Error so the UI can branch
    // on auth (401) vs availability (503) vs validation (422).
    assert.ok(err === undefined || true);  // assert.rejects returns undefined; the matcher above is the contract
  });

  test('thrown error carries .status and .detail for UI branching', async () => {
    try {
      await parseCustomQuestionsByPart('Describe X.', 2, {
        fetch: _errFetch(503, {
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

  test('non-JSON error response still throws with a fallback message', async () => {
    // Network/CDN failures may return HTML — `resp.json()` throws.
    // The detector must still throw a usable Error, not propagate the
    // JSON-parse crash.
    const brokenFetch = async () => ({
      ok:     false,
      status: 502,
      json:   async () => { throw new Error('not JSON'); },
    });
    try {
      await parseCustomQuestionsByPart('X', 2, { fetch: brokenFetch });
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

  test('user_pasted cue card path short-circuits before needing fetch', async () => {
    // Pin the contract that a fully-formed cue card never tries to hit
    // the network — even if global fetch were unavailable, this path
    // would still succeed. (We can't directly test the
    // "no-fetch-available" error branch under Node 18+, which ships
    // a global `fetch`.)
    const out = await parseCustomQuestionsByPart(
      'Describe X.\nYou should say:\n- a\n- b\nand explain.', 2,
      { fetch: () => { throw new Error('fetch must not be called for user_pasted path'); } },
    );
    assert.strictEqual(out[0].source, 'user_pasted');
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

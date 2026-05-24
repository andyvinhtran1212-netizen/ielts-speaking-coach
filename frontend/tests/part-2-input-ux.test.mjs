/**
 * frontend/tests/part-2-input-ux.test.mjs — Sprint 14.6.4
 *
 * Andy 2026-05-23 empirical bug: user pasted a full cue card on a
 * single line (no `\n`, no `-` bullet markers):
 *
 *   "Describe a traditional festival you attended. You should say:
 *    What the event was When and where it happened ..."
 *
 * Sprint 14.4's `detectCueCard` requires `\n` separated bullets so
 * the heuristic returned `isCueCard: false`. Sprint 14.6.2's Part 2
 * fallback then took `lines[0]` — the *whole* string — and sent it
 * to the AI gen endpoint as the `trigger`. The model received a
 * pre-formed cue card as input, "generated" a different one, and the
 * user saw inconsistent output.
 *
 * Sprint 14.6.4 strategy: **UX constraint, not heuristic expansion**
 * (Pattern #35). The detector now extracts only the FIRST SENTENCE
 * from long single-line input, and the UI nudges users to paste only
 * a topic statement. This file pins the new `extractFirstLineAsTrigger`
 * contract and the simplified Part 2 routing.
 *
 * L9 TDD discipline (re-applied from Sprint 14.6.3): the new tests
 * fail against the pre-Sprint-14.6.4 detector; the fix turns them
 * green without regressing the Sprint 14.6.2 + 14.6.3 sentinels.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const mod = require(join(__dirname, '..', 'js', 'cue-card-detector.js'));
const { parseCustomQuestionsByPart } = mod;


// ── Helpers ────────────────────────────────────────────────────────────────


/** Build a stub api that records calls + returns a generic payload. */
function _spyApi(responseBody) {
  const calls = [];
  const post = async (path, body) => {
    calls.push({ path, body });
    return responseBody || {
      type: 'cue_card', topic: 'X', bullets: [],
      prompt: '...', source: 'ai_generated', trigger: 'X',
    };
  };
  return { post, calls };
}


// ── extractFirstLineAsTrigger — pure helper, table-driven ──────────────────


describe('Sprint 14.6.4 — extractFirstLineAsTrigger edge cases (L7)', () => {

  test('exists on the module exports', () => {
    assert.strictEqual(
      typeof mod.extractFirstLineAsTrigger, 'function',
      'extractFirstLineAsTrigger must be exported so tests + future ' +
      'callers can reuse the helper without re-implementing it.',
    );
  });

  test('multi-line input returns the first non-empty line', () => {
    assert.strictEqual(
      mod.extractFirstLineAsTrigger('Line 1.\nLine 2.\nLine 3.'),
      'Line 1.',
    );
  });

  test('multi-line input skips leading blank lines', () => {
    assert.strictEqual(
      mod.extractFirstLineAsTrigger('\n\n  Real first line.\nOther stuff.'),
      'Real first line.',
    );
  });

  test('short single line returns the trimmed text as-is', () => {
    assert.strictEqual(
      mod.extractFirstLineAsTrigger('  Describe a place you like.  '),
      'Describe a place you like.',
    );
  });

  test('LONG single line truncates at the first ". " — Andy 2026-05-23 case', () => {
    // The literal text Andy pasted in session
    // e6cf179b-26b1-4141-b9dc-aab10e9cef1e — pinned verbatim so a
    // future regex tweak that re-breaks this empirical case fails
    // here before it reaches production.
    const andyPaste =
      'Describe a traditional festival you attended. You should say: ' +
      'What the event was When and where it happened What you saw and ' +
      'did And explain why it was memorable.';
    assert.strictEqual(
      mod.extractFirstLineAsTrigger(andyPaste),
      'Describe a traditional festival you attended.',
      'Sprint 14.6.4 must extract the first sentence from a long ' +
      'single-line paste so the AI gen receives a clean topic ' +
      'statement, not a re-paste of the full cue card.',
    );
  });

  test('long single line without a period truncates at 200 chars', () => {
    // L7 fallback: when no ". " separator is found, cap at 200
    // characters so the AI gen prompt stays bounded.
    const text = 'A'.repeat(300);
    const result = mod.extractFirstLineAsTrigger(text);
    assert.strictEqual(result.length, 200);
    assert.strictEqual(result, 'A'.repeat(200));
  });

  test('empty / whitespace input returns empty string', () => {
    assert.strictEqual(mod.extractFirstLineAsTrigger(''), '');
    assert.strictEqual(mod.extractFirstLineAsTrigger('   '), '');
    assert.strictEqual(mod.extractFirstLineAsTrigger('\n\n\n'), '');
    assert.strictEqual(mod.extractFirstLineAsTrigger(null), '');
    assert.strictEqual(mod.extractFirstLineAsTrigger(undefined), '');
  });

  test('long single line without period — period appears AFTER 200 chars', () => {
    // Defensive: if the first `. ` lands past the 200-char cap we
    // must still cap at 200 (the helper's bounded-prompt guarantee).
    const text = 'X'.repeat(250) + '. The rest.';
    const result = mod.extractFirstLineAsTrigger(text);
    assert.strictEqual(result.length, 200);
  });

  test('mid-length single line with internal period returns up to that period', () => {
    // The example a user pastes verbatim from Andy's report — single
    // line, has `. ` within the cap, take everything up to and
    // including the period.
    const text = 'Describe X. You should say: A B C.';
    const result = mod.extractFirstLineAsTrigger(text);
    assert.strictEqual(result, 'Describe X.');
  });

});


// ── Part 2 routing — Andy's empirical bug + happy paths ───────────────────


describe('Sprint 14.6.4 — Part 2 routing simplification (L2)', () => {

  test('Andy 2026-05-23 paste extracts first sentence as AI gen trigger', async () => {
    const andyPaste =
      'Describe a traditional festival you attended. You should say: ' +
      'What the event was When and where it happened What you saw and ' +
      'did And explain why it was memorable.';

    const api = _spyApi();
    await parseCustomQuestionsByPart(andyPaste, 2, { api });

    assert.strictEqual(api.calls.length, 1, 'must call AI gen exactly once');
    assert.strictEqual(
      api.calls[0].body.trigger,
      'Describe a traditional festival you attended.',
      'The empirical bug: trigger must be the first sentence, NOT ' +
      'the whole pre-formed cue card paste.',
    );
  });

  test('multi-line cue card (Sprint 14.4 detection) → user_pasted_multiline, no AI gen', async () => {
    const cueCard = [
      'Describe a memorable trip you took.',
      'You should say:',
      '- where you went',
      '- who you went with',
      '- what you did there',
      'and explain why it was memorable.',
    ].join('\n');

    let aiCalled = false;
    const api = { post: async () => { aiCalled = true; return {}; } };

    const out = await parseCustomQuestionsByPart(cueCard, 2, { api });

    assert.strictEqual(aiCalled, false,
      'A user explicitly pasting a structured multi-line cue card must ' +
      'bypass AI gen (graceful path, L8).');
    assert.strictEqual(out[0].type,   'cue_card');
    assert.strictEqual(
      out[0].source, 'user_pasted_multiline',
      'Sprint 14.6.4 renamed source to "user_pasted_multiline" to ' +
      'signal that the multi-line path is now the *secondary* route, ' +
      'not the primary one.',
    );
  });

  test('short single-line trigger still routes to AI gen with the full text', async () => {
    // Backward compat with Sprint 14.6.2: a normal 1-line trigger
    // (under 200 chars, no embedded period mid-sentence) hits AI gen
    // with the whole text — no regression for the common case.
    const api = _spyApi();
    await parseCustomQuestionsByPart('Describe a person you admire.', 2, { api });
    assert.strictEqual(api.calls.length, 1);
    assert.strictEqual(api.calls[0].body.trigger, 'Describe a person you admire.');
  });

  test('Part 1 routing unchanged (regression)', async () => {
    const out = await parseCustomQuestionsByPart('Q1\nQ2\nQ3', 1);
    assert.deepStrictEqual(out, ['Q1', 'Q2', 'Q3']);
  });

  test('Part 3 routing unchanged (regression)', async () => {
    const out = await parseCustomQuestionsByPart('Q1\nQ2', 3);
    assert.deepStrictEqual(out, ['Q1', 'Q2']);
  });

});

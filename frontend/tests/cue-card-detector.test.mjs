/**
 * frontend/tests/cue-card-detector.test.mjs — Sprint 14.4.
 *
 * Behaviour tests for the cue card heuristic + parser.
 *
 * The "PF4 cue card corpus" is embedded below as a regression-protected
 * literal rather than a separate doc file. The asserted precision/recall
 * is computed live at the bottom of this file; if a future heuristic
 * tweak drops either below the L6 target (precision ≥ 0.95, recall
 * ≥ 0.80) the build fails.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { detectCueCard, parseCustomQuestions } = require(
  join(__dirname, '..', 'js', 'cue-card-detector.js'),
);


// ── Cambridge cue card corpus (PF4) ───────────────────────────────────────


// 7 canonical-format cue cards drawn from public Cambridge IELTS prep
// materials. Variants cover: bullet style (-, •, *, numbered), opening
// keyword variants, "say"/"mention"/"include" phrasing.
const CUE_CARDS = [
  // 1 — canonical dash bullets, "you should say"
  `Describe a time when you helped someone.
You should say:
- who you helped
- how you helped them
- why they needed help
- and explain how you felt afterwards.`,

  // 2 — "Talk about" opening, bullet-point style
  `Talk about a memorable trip you took.
You should say:
- where you went
- who you went with
- what you did
- and explain why it was memorable.`,

  // 3 — "Tell me about" + "you should mention"
  `Tell me about a book that influenced you.
You should mention:
- the title and author
- when you read it
- what it is about
- and explain why it influenced you.`,

  // 4 — bullet `•` style + "you should include"
  `Describe a piece of technology you find useful.
You should include:
• what it is
• how often you use it
• how it helps you
• and explain how your life would be different without it.`,

  // 5 — numbered bullets (1. 2. 3.)
  `Describe an important decision you made.
You should say:
1. what the decision was
2. when you made it
3. how it changed your life
4. and explain whether you would make the same decision again.`,

  // 6 — asterisk bullets, "Describe a person"
  `Describe a person you admire.
You should say:
* who this person is
* how you know them
* what qualities they have
* and explain why you admire them.`,

  // 7 — only 2 bullets (minimum L2 threshold)
  `Describe a place you would like to visit.
You should say:
- where it is
- and explain why you want to visit it.`,
];


// 8 non-cue-card pastes. The heuristic must REJECT these (false-positive
// = user confused). Each names the signal that's missing.
const NON_CUE_CARDS = [
  // A — single line starting "Describe" (Part 1 / 3 question)
  'Describe your hometown.',

  // B — "Describe" + bullets but NO "you should say"
  `Describe X.
- detail 1
- detail 2
- detail 3`,

  // C — "you should say" + bullets but does NOT open with the trigger
  `What was the best holiday you had?
You should say:
- where you went
- what you did
- why it was the best`,

  // D — opens with trigger + "you should say" but only 1 bullet
  `Describe a hobby.
You should say:
- what it is`,

  // E — 5 separate Part-1-style questions (the broken pre-14.4 case)
  `Do you enjoy spending time outdoors?
How often do you use public transportation?
What kind of music do you like listening to?
Do you think technology has improved daily life?
Where did you grow up?`,

  // F — single question with embedded dash mid-sentence (no actual bullets)
  'What do you think about online learning - is it effective?',

  // G — empty string
  '',

  // H — whitespace only
  '   \n\n  \n',
];


// ── Detector unit tests ───────────────────────────────────────────────────


describe('Sprint 14.4 — detectCueCard heuristic', () => {

  test('canonical Cambridge dash-bullet cue card is detected', () => {
    const r = detectCueCard(CUE_CARDS[0]);
    assert.strictEqual(r.isCueCard, true);
    assert.match(r.topic, /^Describe a time when you helped someone/);
    assert.strictEqual(r.bullets.length, 4);
    assert.strictEqual(r.bullets[0], 'who you helped');
  });

  test('"Talk about" opening matches', () => {
    assert.strictEqual(detectCueCard(CUE_CARDS[1]).isCueCard, true);
  });

  test('"Tell me about" + "you should mention" matches', () => {
    assert.strictEqual(detectCueCard(CUE_CARDS[2]).isCueCard, true);
  });

  test('"you should include" + • bullets matches', () => {
    const r = detectCueCard(CUE_CARDS[3]);
    assert.strictEqual(r.isCueCard, true);
    assert.strictEqual(r.bullets.length, 4);
  });

  test('numbered bullets (1. 2. 3.) match', () => {
    const r = detectCueCard(CUE_CARDS[4]);
    assert.strictEqual(r.isCueCard, true);
    assert.strictEqual(r.bullets.length, 4);
  });

  test('* asterisk bullets match', () => {
    assert.strictEqual(detectCueCard(CUE_CARDS[5]).isCueCard, true);
  });

  test('minimum 2 bullets accepted', () => {
    assert.strictEqual(detectCueCard(CUE_CARDS[6]).isCueCard, true);
  });

  test('single "Describe X" sentence does NOT trigger (no bullets, no signal 2/3)', () => {
    assert.strictEqual(detectCueCard(NON_CUE_CARDS[0]).isCueCard, false);
  });

  test('"Describe" with bullets but missing "you should say" does NOT trigger', () => {
    assert.strictEqual(detectCueCard(NON_CUE_CARDS[1]).isCueCard, false);
  });

  test('"you should say" with bullets but wrong opening does NOT trigger', () => {
    assert.strictEqual(detectCueCard(NON_CUE_CARDS[2]).isCueCard, false);
  });

  test('only 1 bullet does NOT trigger (L2 requires ≥2)', () => {
    assert.strictEqual(detectCueCard(NON_CUE_CARDS[3]).isCueCard, false);
  });

  test('mid-sentence dash is not counted as a bullet', () => {
    assert.strictEqual(detectCueCard(NON_CUE_CARDS[5]).isCueCard, false);
  });

  test('empty + whitespace-only inputs return false safely', () => {
    assert.strictEqual(detectCueCard('').isCueCard, false);
    assert.strictEqual(detectCueCard('   \n\n  ').isCueCard, false);
    assert.strictEqual(detectCueCard(null).isCueCard, false);
    assert.strictEqual(detectCueCard(undefined).isCueCard, false);
  });

});


// ── Parser orchestrator (modes) ───────────────────────────────────────────


describe('Sprint 14.4 — parseCustomQuestions modes', () => {

  test('auto mode: cue card → single object with type=cue_card', () => {
    const out = parseCustomQuestions(CUE_CARDS[0], 'auto');
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].type, 'cue_card');
    assert.match(out[0].prompt, /Describe a time when you helped someone/);
    assert.strictEqual(out[0].bullets.length, 4);
  });

  test('auto mode: non-cue-card paste falls back to single questions (L3 safer default)', () => {
    const out = parseCustomQuestions(NON_CUE_CARDS[4], 'auto');
    assert.ok(out.length >= 3, 'expected multiple single-question entries');
    // Legacy shape: plain strings (L8 backward compat).
    assert.strictEqual(typeof out[0], 'string');
  });

  test('forced cue_card mode overrides heuristic', () => {
    // A bare "Describe X." that doesn't match the heuristic — user
    // explicitly forces cue card. Backend still accepts and stores it.
    const out = parseCustomQuestions('Describe X.', 'cue_card');
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].type, 'cue_card');
    assert.deepStrictEqual(out[0].bullets, []);
  });

  test('forced single mode overrides heuristic (cue card split into bullets)', () => {
    const out = parseCustomQuestions(CUE_CARDS[0], 'single');
    assert.ok(out.length > 1,
      'forced single mode must naive-split, not return cue card object');
    assert.strictEqual(typeof out[0], 'string');
  });

  test('legacy 10-question cap preserved (L8 backward compat)', () => {
    const many = Array.from({length: 25}, (_, i) => `Question ${i + 1}?`).join('\n');
    const out = parseCustomQuestions(many, 'auto');
    assert.strictEqual(out.length, 10);
  });

  test('empty input yields empty array (no crash)', () => {
    assert.deepStrictEqual(parseCustomQuestions('',   'auto'), []);
    assert.deepStrictEqual(parseCustomQuestions(null, 'single'), []);
  });

});


// ── PF6 — corpus-level precision / recall ─────────────────────────────────


describe('Sprint 14.4 — heuristic precision + recall on corpus (L6 target)', () => {

  test('precision ≥ 0.95 (cue-card detections are real cue cards)', () => {
    let truePos = 0, falsePos = 0;
    for (const sample of CUE_CARDS) {
      if (detectCueCard(sample).isCueCard) truePos++;
    }
    for (const sample of NON_CUE_CARDS) {
      if (detectCueCard(sample).isCueCard) falsePos++;
    }
    const precision = truePos / (truePos + falsePos || 1);
    assert.ok(
      precision >= 0.95,
      `precision ${precision.toFixed(3)} < 0.95 — false positives: ${falsePos}`,
    );
  });

  test('recall ≥ 0.80 (real cue cards are detected)', () => {
    let truePos = 0, falseNeg = 0;
    for (const sample of CUE_CARDS) {
      if (detectCueCard(sample).isCueCard) truePos++;
      else falseNeg++;
    }
    const recall = truePos / (truePos + falseNeg || 1);
    assert.ok(
      recall >= 0.80,
      `recall ${recall.toFixed(3)} < 0.80 — missed: ${falseNeg} of ${CUE_CARDS.length}`,
    );
  });

  test('corpus sizes are non-trivial (regression guard)', () => {
    // If a future cleanup deletes corpus entries, the precision/recall
    // tests would still pass on a tiny n. Pin the n explicitly.
    assert.ok(CUE_CARDS.length     >= 7,
      `cue-card corpus shrunk below 7 — current ${CUE_CARDS.length}`);
    assert.ok(NON_CUE_CARDS.length >= 6,
      `non-cue-card corpus shrunk below 6 — current ${NON_CUE_CARDS.length}`);
  });

});


// ── Output shape (L7) ─────────────────────────────────────────────────────


describe('Sprint 14.4 — output shape contracts (L7 / L8)', () => {

  test('cue card output carries the L7-locked keys', () => {
    const out = parseCustomQuestions(CUE_CARDS[0], 'auto');
    const k = Object.keys(out[0]).sort();
    assert.deepStrictEqual(k, ['bullets', 'prompt', 'topic', 'type']);
  });

  test('single-question output remains plain strings (L8 backward compat)', () => {
    const out = parseCustomQuestions('Q1\nQ2\nQ3', 'auto');
    assert.ok(out.every(item => typeof item === 'string'),
      'pre-14.4 callers depend on a list[str] body shape');
  });

});

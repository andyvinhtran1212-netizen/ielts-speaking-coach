/**
 * frontend/tests/quiz-engine.test.mjs — Quick-Check Adaptive Mastery engine.
 * Pins grading + the mastery loop (distinct skills + production + provisional
 * anti-guess + cooldown).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText, gradeQuestion, createEngine } from '../js/quiz-engine.js';

// ── grading ──────────────────────────────────────────────────────────

describe('gradeQuestion', () => {
  test('choice: index match', () => {
    const q = { input: 'choice', answer: 1 };
    assert.equal(gradeQuestion(q, 1), true);
    assert.equal(gradeQuestion(q, 0), false);
  });
  test('boolean: 1 ⇒ true', () => {
    assert.equal(gradeQuestion({ input: 'boolean', answer: 1 }, true), true);
    assert.equal(gradeQuestion({ input: 'boolean', answer: 1 }, false), false);
    assert.equal(gradeQuestion({ input: 'boolean', answer: 0 }, false), true);
  });
  test('syllable: index match', () => {
    assert.equal(gradeQuestion({ input: 'syllable', answer: 2 }, 2), true);
    assert.equal(gradeQuestion({ input: 'syllable', answer: 2 }, 1), false);
  });
  test('text: normalized accept match', () => {
    const q = { input: 'text', accept: ['alpha'] };
    assert.equal(gradeQuestion(q, 'ALPHA'), true);
    assert.equal(gradeQuestion(q, '  alpha. '), true);
    assert.equal(gradeQuestion(q, 'beta'), false);
  });
  test('text: case_sensitive', () => {
    const q = { input: 'text', accept: ['Alpha'], case_sensitive: true };
    assert.equal(gradeQuestion(q, 'alpha'), false);
    assert.equal(gradeQuestion(q, 'Alpha'), true);
  });
});

test('normalizeText trims, collapses, lowercases, strips edge punctuation', () => {
  assert.equal(normalizeText('  Hello,   World! '), 'hello, world');
});

// ── mastery loop ───────────────────────────────────────────────────────

function oneWordBank() {
  return {
    meta: { correct_to_master: 2, require_distinct_skill: true, require_production_to_master: true, cooldown: 0 },
    questions: [
      { qid: 'a1', item_key: 'Alpha', input: 'choice', skill: 'meaning', answer: 0, type: 'mcq' },
      { qid: 'a2', item_key: 'Alpha', input: 'choice', skill: 'recall', answer: 0, type: 'mcq' },
      { qid: 'a3', item_key: 'Alpha', input: 'text', skill: 'usage', accept: ['alpha'], type: 'gap_text' },
    ],
  };
}

test('masters a word via 2 distinct skills + a production answer', () => {
  const eng = createEngine(oneWordBank());
  const q1 = eng.next();
  assert.equal(q1.item_key, 'Alpha');
  const r1 = eng.submit(0);                 // choice/meaning correct → provisional
  assert.equal(r1.correct, true);
  assert.equal(r1.mastered, false);          // single MCQ ⇒ not mastered (anti-guess)

  const q2 = eng.next();
  assert.equal(q2.question.input, 'text');   // provisional ⇒ prefers a production confirmer
  const r2 = eng.submit('alpha');            // production correct → confirm + master
  assert.equal(r2.mastered, true);
  assert.equal(r2.done, true);
  assert.equal(eng.progress().mastered, 1);
});

test('a single correct MCQ alone does not master (provisional)', () => {
  const eng = createEngine(oneWordBank());
  eng.next();
  const r = eng.submit(0);
  assert.equal(r.mastered, false);
  assert.equal(eng.progress().mastered, 0);
  assert.equal(eng.progress().remaining, 1);
});

test('wrong answer increments wrong_count and is logged', () => {
  const eng = createEngine(oneWordBank());
  eng.next();
  eng.submit(1);                             // answer is 0 → wrong
  const batch = eng.drainBatch();
  assert.equal(batch.attempts.length, 1);
  assert.equal(batch.attempts[0].is_correct, false);
  const alpha = batch.word_stats.find((w) => w.item_key === 'Alpha');
  assert.equal(alpha.wrong_count, 1);
  assert.equal(alpha.first_try_correct, false);
});

test('cooldown spaces a word: next pick avoids the just-asked word', () => {
  const bank = {
    meta: { cooldown: 1, correct_to_master: 2 },
    questions: [
      { qid: 'a1', item_key: 'A', input: 'choice', skill: 'meaning', answer: 0, type: 'mcq' },
      { qid: 'b1', item_key: 'B', input: 'choice', skill: 'meaning', answer: 0, type: 'mcq' },
    ],
  };
  const eng = createEngine(bank);
  const first = eng.next();
  eng.submit(1);                             // wrong → stays in queue
  const second = eng.next();
  assert.notEqual(second.item_key, first.item_key);   // cooldown skipped the repeat
});

test('resume seeds passed skills from prior word_stats', () => {
  const eng = createEngine(oneWordBank(), {
    resume: [{ item_key: 'Alpha', status: 'testing', skills_passed: ['meaning'], correct_count: 1 }],
  });
  // one production correct now adds 'usage' → 2 distinct skills + production ⇒ master
  eng.next();
  // drive to the production question deterministically: answer current correct first
  let r = eng.submit(0);
  if (!r.mastered) {
    eng.next();
    r = eng.submit('alpha');
  }
  assert.equal(eng.progress().mastered, 1);
});

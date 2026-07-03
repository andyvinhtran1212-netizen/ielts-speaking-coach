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

test('resume rehydrates a provisional skill so a production confirmer masters', () => {
  const eng = createEngine(oneWordBank(), {
    resume: [{ item_key: 'Alpha', status: 'provisional', provisional_skill: 'meaning', skills_passed: [] }],
  });
  const q = eng.next();                       // provisional ⇒ prefers a production confirmer
  assert.equal(q.question.input, 'text');
  const r = eng.submit('alpha');              // production confirms 'meaning' + adds 'usage' ⇒ master
  assert.equal(r.mastered, true);
});

test('drainBatch carries provisional_skill + production_done for resume', () => {
  const eng = createEngine(oneWordBank());
  eng.next();
  eng.submit(0);                              // one MCQ correct ⇒ provisional {meaning}
  const batch = eng.drainBatch();
  const alpha = batch.word_stats.find((w) => w.item_key === 'Alpha');
  assert.equal(alpha.provisional_skill, 'meaning');
  assert.equal(alpha.production_done, false);
});

test('unsupported input (match) is filtered out, never served/counted', () => {
  const bank = {
    meta: { correct_to_master: 1 },
    questions: [
      { qid: 'm1', item_key: 'M', input: 'match', skill: 'meaning', pairs: [['a', 'b']], type: 'match' },
      { qid: 'k1', item_key: 'K', input: 'choice', skill: 'meaning', answer: 0, type: 'mcq' },
    ],
  };
  const eng = createEngine(bank);
  assert.equal(eng.progress().total, 1);      // only 'K' (match-only 'M' excluded)
  const q = eng.next();
  assert.equal(q.item_key, 'K');
});

test('each attempt carries a UUID-shaped client_id (incl. fallback path)', () => {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  // normal path (crypto.randomUUID)
  let eng = createEngine(oneWordBank()); eng.next(); eng.submit(0);
  assert.match(eng.drainBatch().attempts[0].client_id, UUID_RE);
  // fallback path: stub randomUUID to throw → must still be UUID-shaped (the
  // client_id column is UUID; a non-UUID id would fail to persist).
  const orig = globalThis.crypto && globalThis.crypto.randomUUID;
  let stubbed = false;
  try { globalThis.crypto.randomUUID = () => { throw new Error('unavailable'); }; stubbed = true; } catch (e) { /* read-only */ }
  if (stubbed) {
    try {
      eng = createEngine(oneWordBank()); eng.next(); eng.submit(0);
      assert.match(eng.drainBatch().attempts[0].client_id, UUID_RE);
    } finally { try { globalThis.crypto.randomUUID = orig; } catch (e) {} }
  }
});

test('require_distinct_skill:false masters via repeated same-skill corrects', () => {
  const bank = {
    meta: { correct_to_master: 2, require_distinct_skill: false,
            require_production_to_master: false, provisional_on_single_mcq: false },
    questions: [
      { qid: 'n1', item_key: 'N', input: 'choice', skill: 'meaning', answer: 0, type: 'mcq' },
      { qid: 'n2', item_key: 'N', input: 'choice', skill: 'meaning', answer: 0, type: 'mcq' },
    ],
  };
  const eng = createEngine(bank);
  eng.next(); let r = eng.submit(0);          // credit 1 of 2
  assert.equal(r.mastered, false);
  eng.next(); r = eng.submit(0);              // credit 2 → mastered (same skill OK)
  assert.equal(r.mastered, true);
});

test('resume keeps an already-mastered word mastered (not re-asked)', () => {
  const eng = createEngine(oneWordBank(), {
    resume: [{ item_key: 'Alpha', status: 'mastered', skills_passed: ['meaning', 'usage'],
               production_done: true, credit_count: 2 }],
  });
  assert.equal(eng.progress().mastered, 1);
  assert.equal(eng.next(), null);             // nothing left to ask
});

test('honors imported META from the raw API shape {bank:{meta},questions}', () => {
  const apiShape = {
    bank: { meta: { correct_to_master: 1, require_production_to_master: false, provisional_on_single_mcq: false } },
    questions: [{ qid: 'z1', item_key: 'Z', input: 'choice', skill: 'meaning', answer: 0, type: 'mcq' }],
  };
  const eng = createEngine(apiShape);
  eng.next();
  const r = eng.submit(0);
  assert.equal(r.mastered, true);             // META honored (would stay provisional under defaults)
});

function fiveWordBank() {
  const qs = [];
  ['A', 'B', 'C', 'D', 'E'].forEach((k) => {
    qs.push({ qid: k + '1', item_key: k, input: 'choice', skill: 'meaning', answer: 0, type: 'mcq' });
    qs.push({ qid: k + '2', item_key: k, input: 'text', skill: 'usage', accept: [k.toLowerCase()], type: 'gap_text' });
  });
  return { meta: { correct_to_master: 2, cooldown: 0 }, questions: qs };
}

test('unseeded engine keeps deterministic file order (first word == first in file)', () => {
  const a = createEngine(fiveWordBank());
  const b = createEngine(fiveWordBank());
  assert.equal(a.next().item_key, 'A');       // file order preserved
  assert.equal(b.next().item_key, 'A');       // reproducible without a seed
});

test('seeded engine randomizes word order, deterministically per seed', () => {
  const s1a = createEngine(fiveWordBank(), { seed: 'sess-1' });
  const s1b = createEngine(fiveWordBank(), { seed: 'sess-1' });
  // same seed → identical order (resume-stable)
  const orderA = [], orderB = [];
  for (let i = 0; i < 5; i++) { orderA.push(s1a.next().item_key); s1a.submit(0); }
  for (let i = 0; i < 5; i++) { orderB.push(s1b.next().item_key); s1b.submit(0); }
  assert.deepEqual(orderA, orderB);
  // every word still appears exactly once (nothing dropped by the shuffle)
  assert.deepEqual([...orderA].sort(), ['A', 'B', 'C', 'D', 'E']);
  // at least one seed reorders away from strict file order (defeats fixed sequence).
  const seeds = ['sess-1', 'sess-2', 'sess-3', 'sess-4', 'sess-5'];
  const anyReordered = seeds.some((seed) => {
    const e = createEngine(fiveWordBank(), { seed });
    const ord = [];
    for (let i = 0; i < 5; i++) { ord.push(e.next().item_key); e.submit(0); }
    return ord.join('') !== 'ABCDE';
  });
  assert.equal(anyReordered, true);
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

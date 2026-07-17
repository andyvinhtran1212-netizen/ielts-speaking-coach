/**
 * quiz-instruction-ux.test.mjs — audit đợt 2 (AUDIT_GRAMMAR_QUIZ_UX_CONTENT_2026-07-16):
 * per-type instruction line, grammar-area copy, provisional visibility, and the
 * punctuation-only text-grading fix. Engine behavior via import; page structure
 * via source sentinels (quiz.html is DOM/IIFE, not importable).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gradeText, gradeQuestion, createEngine } from '../js/quiz-engine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const QUIZ = readFileSync(join(__dirname, '..', 'pages', 'quiz.html'), 'utf8');

// ── engine: punctuation-only accepts grade by the literal mark ───────

describe('gradeText — punctuation-only accept (e.g. ";" for run-on fixes)', () => {
  const q = { input: 'text', type: 'gap_text', accept: [';'] };
  test('the exact mark passes', () => {
    assert.equal(gradeText(q, ';').correct, true);
    assert.equal(gradeText(q, ' ; ').correct, true);
  });
  test('a DIFFERENT punctuation mark no longer false-matches via empty-normalize', () => {
    // normalizeText strips edge punctuation, so "." and ";" both normalize to ""
    // — before the fix any punctuation answer was graded correct.
    assert.equal(gradeText(q, '.').correct, false);
    assert.equal(gradeText(q, ',').correct, false);
    assert.equal(gradeText(q, '').correct, false);
  });
  test('word answers still grade normally against word accepts', () => {
    const w = { input: 'text', type: 'gap_text', accept: ['by'] };
    assert.equal(gradeQuestion(w, 'by'), true);
    assert.equal(gradeQuestion(w, 'of'), false);
  });
});

// ── engine: provisional credit is exposed on the submit result ───────

describe('submit result exposes provisional (anti-guess) state', () => {
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
  test('first correct MCQ → provisional: true (progress bar will not move yet)', () => {
    const eng = createEngine(oneWordBank());
    eng.next();
    const r = eng.submit(0);
    assert.equal(r.correct, true);
    assert.equal(r.mastered, false);
    assert.equal(r.provisional, true);
  });
  test('production confirm → mastered, provisional: false', () => {
    const eng = createEngine(oneWordBank());
    eng.next(); eng.submit(0);          // provisional MCQ
    eng.next();
    const r = eng.submit('alpha');      // production confirms + masters
    assert.equal(r.mastered, true);
    assert.equal(r.provisional, false);
  });
  test('wrong answer → provisional reset, flag false', () => {
    const eng = createEngine(oneWordBank());
    eng.next();
    const r = eng.submit(3);            // wrong
    assert.equal(r.correct, false);
    assert.equal(r.provisional, false);
  });
});

// ── page: per-type instruction line ──────────────────────────────────

describe('quiz.html — instruction layer + copy (source sentinels)', () => {
  test('renders a per-type instruction line (#qz-instr)', () => {
    assert.match(QUIZ, /<p id="qz-instr" class="qz-instr hidden"><\/p>/);
    assert.match(QUIZ, /Chọn Đúng hoặc Sai\./);
    assert.match(QUIZ, /Chọn từ\/cụm đúng cho chỗ trống\./);
    assert.match(QUIZ, /Chọn đáp án đúng\./);
  });
  test('typed answers get a word-count hint — only when every accept agrees', () => {
    // Mixed-length accepts ("The government" / "Government") must not advertise
    // a "required" count the grader doesn't enforce (review P2, PR #806).
    assert.match(QUIZ, /\.map\(\(a\) => String\(a\)\.trim\(\)\.split\(\/\\s\+\/\)\.length\)/);
    assert.match(QUIZ, /counts\.every\(\(c\) => c === counts\[0\]\)/);
    assert.match(QUIZ, /Gõ đáp án vào ô trống \(' \+ n \+ ' từ\)\./);
  });
  test('blank placeholder renders from 2 underscores up (was 4)', () => {
    assert.match(QUIZ, /replace\(\/_\{2,\}\/g/);
    assert.doesNotMatch(QUIZ, /replace\(\/_\{4,\}\/g/);
  });
  test('grammar banks get grammar copy, not vocab copy', () => {
    assert.match(QUIZ, /Bạn đã nắm trọn vẹn các điểm ngữ pháp của bài này!/);
    assert.match(QUIZ, /\(isGrammar \? 'Đã nắm ' : 'Đã thuộc '\)/);
    assert.match(QUIZ, /Điểm khó nhất/);
    // review-chip labels + hardest word go through the slug prettifier
    assert.match(QUIZ, /const keyLabel = \(k\) =>/);
    assert.match(QUIZ, /keyLabel\(s\.hardest\.key\)/);
    assert.match(QUIZ, /el\.textContent = keyLabel\(k\)/);
  });
  test('one-line mastery explainer is set for both areas (#qz-sub)', () => {
    assert.match(QUIZ, /<p id="qz-sub" class="qz-sub"><\/p>/);
    assert.match(QUIZ, /bài sẽ tự lặp lại điểm bạn còn sai/);
    assert.match(QUIZ, /bài sẽ tự lặp lại từ bạn còn sai/);
  });
  test('provisional credit is explained in the feedback panel', () => {
    assert.match(QUIZ, /res\.correct && res\.provisional/);
    assert.match(QUIZ, /để được tính vào tiến độ/);
  });
});

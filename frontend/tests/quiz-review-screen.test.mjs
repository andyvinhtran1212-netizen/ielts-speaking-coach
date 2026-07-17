/**
 * quiz-review-screen.test.mjs — audit 2026-07-17 §II: end-of-session review of
 * every graded answer (wrong-first). Pure logic via import (quiz-review.js);
 * page structure via source sentinels (quiz.html is DOM/IIFE, not importable).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReviewList } from '../js/quiz-review.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const QUIZ = readFileSync(join(__dirname, '..', 'pages', 'quiz.html'), 'utf8');

// ── buildReviewList — grouping + last-attempt semantics ──────────────

describe('buildReviewList', () => {
  const e = (qid, correct, extra) => ({ qid, correct, given: 'x', ...extra });

  test('groups by qid, keeps the LAST attempt, counts wrong attempts', () => {
    const list = buildReviewList([
      e('q1', false, { given: 'bad' }),
      e('q2', true),
      e('q1', true, { given: 'good' }),
    ]);
    assert.equal(list.length, 2);
    const q1 = list.find((it) => it.qid === 'q1');
    assert.equal(q1.given, 'good');        // last attempt wins
    assert.equal(q1.correct, true);
    assert.equal(q1.wrongCount, 1);        // wrong once along the way
    assert.equal(q1.attempts, 2);
    const q2 = list.find((it) => it.qid === 'q2');
    assert.equal(q2.wrongCount, 0);
    assert.equal(q2.attempts, 1);
  });

  test('preserves first-seen (session) order', () => {
    const list = buildReviewList([e('b', true), e('a', false), e('b', true)]);
    assert.deepEqual(list.map((it) => it.qid), ['b', 'a']);
  });

  test('a question wrong at its final attempt stays correct:false', () => {
    const list = buildReviewList([e('q1', true), e('q1', false)]);
    assert.equal(list[0].correct, false);
    assert.equal(list[0].wrongCount, 1);
  });

  test('tolerates empty/null input and entries without qid', () => {
    assert.deepEqual(buildReviewList([]), []);
    assert.deepEqual(buildReviewList(null), []);
    assert.deepEqual(buildReviewList([{ correct: true }]), []);
  });

  test('carries the entry fields through (prompt/answers/explain/article_url)', () => {
    const list = buildReviewList([{
      qid: 'q1', item_key: 'k', prompt: 'P', given: 'g', correctText: 'c',
      correct: false, explain: 'E', article_url: '/grammar/x/y',
    }]);
    assert.equal(list[0].prompt, 'P');
    assert.equal(list[0].correctText, 'c');
    assert.equal(list[0].explain, 'E');
    assert.equal(list[0].article_url, '/grammar/x/y');
  });
});

// ── page: the session is logged and the result screen renders it ─────

describe('quiz.html — review log + result-screen card (source sentinels)', () => {
  test('imports the pure review module', () => {
    assert.match(QUIZ, /import \{ buildReviewList \} from '\/js\/quiz-review\.js'/);
  });
  test('grade() logs every answer (given + correct answer + explain + article link)', () => {
    assert.match(QUIZ, /sessionLog\.push\(\{/);
    assert.match(QUIZ, /given: givenAnswerText\(q, value\)/);
    assert.match(QUIZ, /correctText: corr/);
    assert.match(QUIZ, /article_url: artUrl \|\| null/);
    // the {{audio}} token never reaches the review list
    assert.match(QUIZ, /prompt: String\(q\.prompt \|\| ''\)\.replace\(AUDIO_TOKEN_RE, ' '\)\.trim\(\)/);
  });
  test('log resets per play (startPlay is re-entrant via the mastered gate)', () => {
    assert.match(QUIZ, /sessionLog = \[\];\s*\/\/ fresh review log per play/);
  });
  test('result screen ships the review card + wrong-only/all toggle', () => {
    assert.match(QUIZ, /id="qz-res-log"/);
    assert.match(QUIZ, /id="qz-res-log-toggle"/);
    assert.match(QUIZ, /id="qz-res-log-list"/);
    assert.match(QUIZ, /Xem lại bài làm/);
    assert.match(QUIZ, /Hiện tất cả \(/);
    assert.match(QUIZ, /Chỉ câu sai \(/);
  });
  test('renderResult builds the list from the in-memory log', () => {
    assert.match(QUIZ, /_reviewList = buildReviewList\(sessionLog\)/);
    assert.match(QUIZ, /function renderReviewLog\(\)/);
  });
  test('a question answered wrong then fixed renders as "fixed", not a false sai', () => {
    assert.match(QUIZ, /it\.wrongCount > 0 \? 'is-fixed' : 'is-right'/);
    assert.match(QUIZ, /sai ' \+ it\.wrongCount \+ ' lần trước đó/);
  });
  test('wrong items reveal the correct answer + keep the 📖 article link durable', () => {
    assert.match(QUIZ, /lastWrong && it\.correctText/);
    assert.match(QUIZ, /it\.article_url\s*\?\s*'<div><a class="qz-fb__review"/);
  });
  test('typed-answer input no longer carries a third "type here" cue (placeholder)', () => {
    assert.doesNotMatch(QUIZ, /placeholder = 'Gõ đáp án…'/);
  });
});

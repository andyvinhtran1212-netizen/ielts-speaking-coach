import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  firstPracticeUnsettledIndex,
  normalizePracticeAttempt,
  normalizePracticeCheck,
  normalizePracticeResume,
  normalizePracticeRunTest,
  normalizePracticeStart,
  normalizePracticeSubmit,
  normalizePracticeWindows,
  practiceRunParams,
} from '../lib/listening-practice-run-model.mjs';

const TEST_ID = '11111111-1111-4111-8111-111111111100';
const QUESTIONS = [1, 2];
const testBundle = (payload = {}) => ({
  id: TEST_ID,
  test_id: 'PRACTICE-1',
  test_type: 'practice',
  title: 'Numbers',
  audio_url: 'https://audio.test/practice.mp3',
  audio_duration_seconds: 42,
  sections: [{ exercises: [{ payload: {
    instruction: 'Complete the notes.',
    questions: [
      { q_num: 2, prompt: 'Colour ____' },
      { q_num: 1, prompt: 'Number ____', options: [
        { letter: 'A', text: 'nineteen' }, { letter: 'B', text: 'ninety' },
      ] },
    ],
    ...payload,
  } }] }],
});

describe('native Listening practice-run query and read contracts', () => {
  test('requires one canonical id and rejects ambiguous identity', () => {
    assert.deepEqual(practiceRunParams(`?id=%20${TEST_ID}%20`), { testId: TEST_ID });
    assert.throws(() => practiceRunParams(''), /missing-id/);
    assert.throws(() => practiceRunParams('?id=a&id=b'), /missing-id/);
  });

  test('normalizes only the requested practice test and sorts unique questions', () => {
    const result = normalizePracticeRunTest(testBundle(), TEST_ID);
    assert.equal(result.id, TEST_ID);
    assert.deepEqual(result.questions.map((question) => question.qNum), [1, 2]);
    assert.equal(result.questions[0].options[1].text, 'ninety');
    assert.throws(() => normalizePracticeRunTest({ ...testBundle(), id: 'other' }, TEST_ID), /identity/);
    assert.throws(() => normalizePracticeRunTest({ ...testBundle(), test_type: 'full' }, TEST_ID), /identity/);
  });

  test('fails closed if a supposedly stripped payload leaks grading truth', () => {
    for (const leaked of [
      { answers: [{ q_num: 1, answer: 'nineteen' }] },
      { solutions: { 1: { why: 'secret' } } },
      { questions: [{ q_num: 3, prompt: 'x', correct_answer: 'x' }] },
      { questions: [{ q_num: 3, prompt: 'x', answer_idx: 1 }] },
      { model_answer: 'secret gist' },
      { rubric_keywords: ['secret', 'grading'] },
    ]) assert.throws(() => normalizePracticeRunTest(testBundle(leaked), TEST_ID), /answer-leak/);
  });

  test('windows accept only finite windows for questions in this test', () => {
    const windows = normalizePracticeWindows({ test_id: TEST_ID, windows: {
      1: { start: 3.5, end: 8.2 }, 2: { start: 9, end: 14 },
    } }, TEST_ID, QUESTIONS);
    assert.equal(windows.get(1).start, 3.5);
    assert.throws(() => normalizePracticeWindows({ test_id: TEST_ID, windows: {
      3: { start: 1, end: 2 },
    } }, TEST_ID, QUESTIONS), /windows-contract/);
  });

  test('resume distinguishes no attempt from a valid unique first-answer ledger', () => {
    assert.equal(normalizePracticeResume({ attempt: null }, QUESTIONS), null);
    const resumed = normalizePracticeResume({ attempt: {
      attempt_id: 'attempt-1', started_at: '2026-08-17T00:00:00Z',
      answers: [{ q_num: 2, user_answer: ' blue ' }, { q_num: 1, user_answer: 'ninety' }],
    } }, QUESTIONS);
    assert.deepEqual(resumed.answers.map((row) => row.qNum), [1, 2]);
    assert.throws(() => normalizePracticeResume({ attempt: {
      attempt_id: 'attempt-1', answers: [{ q_num: 1, user_answer: 'a' }, { q_num: 1, user_answer: 'b' }],
    } }, QUESTIONS), /resume-answers/);
  });
});

describe('native Listening practice-run mutation contracts', () => {
  test('start ACK must prove a live attempt identity', () => {
    assert.deepEqual(normalizePracticeStart({ attempt_id: 'attempt-1', status: 'in_progress' }), { attemptId: 'attempt-1' });
    assert.throws(() => normalizePracticeStart({ id: 'attempt-1' }), /start-contract/);
  });

  test('ordinary checks never carry the key and preserve first-answer truth', () => {
    const first = normalizePracticeCheck({
      q_num: 1, correct: false, canonical_correct: false, recorded: true,
      answered_before: false, audio_window: { start: 3, end: 8 },
    }, 1);
    assert.equal(first.recorded, true);
    const retry = normalizePracticeCheck({
      q_num: 1, correct: true, canonical_correct: false, recorded: false,
      answered_before: true, audio_window: { start: 3, end: 8 },
    }, 1);
    assert.equal(retry.correct, true);
    assert.equal(retry.canonicalCorrect, false);
    assert.throws(() => normalizePracticeCheck({
      q_num: 1, correct: false, canonical_correct: false, recorded: true,
      answered_before: false, expected: 'nineteen',
    }, 1), /answer-leak/);
  });

  test('reveal requires an already-settled wrong canonical answer and explicit key', () => {
    const revealed = normalizePracticeCheck({
      q_num: 1, correct: false, canonical_correct: false, recorded: false,
      answered_before: true, revealed: true, expected: 'nineteen', alternatives: ['19'],
      solution: { why: 'The speaker corrects the number.' }, audio_window: { start: 3, end: 8 },
    }, 1, { reveal: true });
    assert.equal(revealed.expected, 'nineteen');
    assert.throws(() => normalizePracticeCheck({
      q_num: 1, correct: true, canonical_correct: true, recorded: false,
      answered_before: true, revealed: true, expected: 'nineteen', alternatives: [], solution: {},
    }, 1, { reveal: true }), /reveal-contract/);
  });

  test('submit and reconciliation cross-check exact question and score truth', () => {
    const payload = {
      attempt_id: 'attempt-1', score: 1, max_score: 2,
      per_question: [
        { q_num: 1, correct: false, user_answer: 'ninety', expected: 'nineteen' },
        { q_num: 2, correct: true, user_answer: 'blue', expected: 'blue' },
      ],
    };
    const summary = normalizePracticeSubmit(payload, 'attempt-1', QUESTIONS);
    assert.equal(summary.score, 1);
    const reconciled = normalizePracticeAttempt({
      attempt_id: 'attempt-1', status: 'submitted', score: 1,
      grading_details: payload.per_question,
    }, 'attempt-1', QUESTIONS);
    assert.equal(reconciled.summary.maxScore, 2);
    assert.deepEqual(normalizePracticeAttempt({ attempt_id: 'attempt-1', status: 'in_progress' }, 'attempt-1', QUESTIONS), {
      status: 'in_progress', summary: null,
    });
    assert.throws(() => normalizePracticeSubmit({ ...payload, score: 2 }, 'attempt-1', QUESTIONS), /submit-score/);
  });

  test('resume lands on the first question not canonically correct', () => {
    const questions = [{ qNum: 1 }, { qNum: 2 }];
    assert.equal(firstPracticeUnsettledIndex(questions, new Map([[1, true], [2, false]])), 1);
    assert.equal(firstPracticeUnsettledIndex(questions, new Map([[1, true], [2, true]])), 2);
  });
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  answersForSubmit,
  grammarKnowledgeHref,
  normalizeAttemptAck,
  normalizeExam,
  normalizeExamList,
  normalizeExamReview,
} from '../lib/exam-player-model.mjs';

const rawExam = {
  id: 'exam-1',
  title: 'TOEIC Part 5',
  exam_source: 'toeic_rc',
  total_questions: 2,
  time_limit_minutes: 10,
  questions: [
    { q_num: 2, question_type: 'mcq_single', prompt: 'Second ___', options: [{ label: 'A', text: 'one' }, { label: 'B', text: 'two' }] },
    { q_num: 5, question_type: 'mcq_single', prompt: 'Fifth ___', options: [{ label: 'A', text: 'alpha' }, { label: 'B', text: 'beta' }] },
  ],
};

test('normalizes list/detail without trusting malformed or duplicate identities', () => {
  assert.deepEqual(normalizeExamList({ exams: [{
    id: 'exam-1', title: 'TOEIC Part 5', exam_source: 'toeic_rc', total_questions: 2, time_limit_minutes: 10,
  }] })?.[0], {
    id: 'exam-1', title: 'TOEIC Part 5', source: 'toeic_rc', sourceLabel: 'TOEIC · Reading', totalQuestions: 2, timeLimitMinutes: 10,
  });
  const exam = normalizeExam(rawExam, 'exam-1');
  assert.equal(exam.questions[1].qNum, 5);
  assert.equal(normalizeExam({ ...rawExam, id: 'other' }, 'exam-1'), null);
  assert.equal(normalizeExam({ ...rawExam, total_questions: 3 }, 'exam-1'), null);
  assert.equal(normalizeExam({ ...rawExam, questions: [
    { ...rawExam.questions[0], question_type: 'true_false' }, rawExam.questions[1],
  ] }, 'exam-1'), null);
  assert.equal(normalizeExam({ ...rawExam, questions: [rawExam.questions[0], rawExam.questions[0]] }, 'exam-1'), null);
  assert.equal(normalizeExamList({ exams: [{ ...rawExam, id: '' }] }), null);
});

test('submits every canonical q_num once and leaves unanswered values explicit', () => {
  const exam = normalizeExam(rawExam, 'exam-1');
  assert.deepEqual(answersForSubmit(exam, { 2: ' B ', 999: 'A' }), [
    { q_num: 2, user_answer: 'B' },
    { q_num: 5, user_answer: '' },
  ]);
});

test('attempt and review receipts require exact identities and complete score truth', () => {
  assert.deepEqual(normalizeAttemptAck({ attempt_id: 'att-1', score: 1, max_score: 2, correct_count: 1 }, 2), {
    attemptId: 'att-1', score: 1, maxScore: 2, correctCount: 1,
  });
  assert.equal(normalizeAttemptAck({ attempt_id: 'att-1', score: 1, max_score: 3, correct_count: 1 }, 2), null);

  const payload = {
    attempt_id: 'att-1', test_id: 'exam-1', score: 1, max_score: 2, correct_count: 1,
    review: [
      { q_num: 2, correct: true, user_answer: 'B', expected: 'B', prompt: 'Second ___', stepper: null },
      { q_num: 5, correct: false, user_answer: '', expected: 'A', prompt: 'Fifth ___', stepper: {
        steps: [{
          action: 'confirm', instruction_vi: 'Chốt đáp án.',
          kp_refs: [{ type: 'grammar', category: 'verb-forms', slug: 'gerunds', title: 'Gerunds' }],
          microcheck: { prompt: 'Chọn', options: ['Sai', 'Đúng'], answer: 'B' },
        }],
        distractors: [{
          option: 'B', why_wrong_vi: 'Sai loại từ.',
          kp_refs: [{ type: 'grammar', category: 'word-forms', slug: 'adjectives' }],
        }],
      } },
    ],
  };
  const normalized = normalizeExamReview(payload, { attemptId: 'att-1', testId: 'exam-1', qNums: [2, 5] });
  assert.equal(normalized.review.length, 2);
  assert.deepEqual(normalized.review[1].stepper.distractors, [{
    option: 'B', why_wrong_vi: 'Sai loại từ.',
    kp_refs: [{ type: 'grammar', category: 'word-forms', slug: 'adjectives', title: '', anchor: '' }],
  }]);
  assert.equal(normalizeExamReview({ ...payload, test_id: 'other' }, { attemptId: 'att-1', testId: 'exam-1', qNums: [2, 5] }), null);
  assert.equal(normalizeExamReview({ ...payload, review: payload.review.slice(0, 1) }, { attemptId: 'att-1', testId: 'exam-1', qNums: [2, 5] }), null);
  assert.equal(normalizeExamReview({ ...payload, correct_count: 2, score: 2 }, { attemptId: 'att-1', testId: 'exam-1', qNums: [2, 5] }), null);
  const invalidMicrocheck = structuredClone(payload);
  invalidMicrocheck.review[1].stepper = {
    steps: [{ action: 'confirm', instruction_vi: 'Chốt đáp án.', kp_refs: [], microcheck: { prompt: 'Chọn', options: ['A', 'B'], answer: 'Z' } }],
  };
  assert.equal(normalizeExamReview(invalidMicrocheck, { attemptId: 'att-1', testId: 'exam-1', qNums: [2, 5] }), null);

  const microcheckWithoutRef = structuredClone(payload);
  microcheckWithoutRef.review[1].stepper.steps[0].kp_refs = [];
  assert.equal(normalizeExamReview(microcheckWithoutRef, { attemptId: 'att-1', testId: 'exam-1', qNums: [2, 5] }), null);

  const invalidDistractor = structuredClone(payload);
  invalidDistractor.review[1].stepper.distractors[0].why_wrong_vi = '';
  assert.equal(normalizeExamReview(invalidDistractor, { attemptId: 'att-1', testId: 'exam-1', qNums: [2, 5] }), null);
});

test('builds only canonical grammar knowledge links', () => {
  assert.equal(grammarKnowledgeHref({ type: 'grammar', category: 'verb-forms', slug: 'gerunds', anchor: 'rule 1' }), '/grammar/verb-forms/gerunds#rule%201');
  assert.equal(grammarKnowledgeHref({ type: 'vocab', category: 'x', slug: 'y' }), null);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listeningKeepChangeAnswer } from '../lib/listening-test-controller.mjs';
import { normalizeListeningReview, listeningReviewAnswerState } from '../lib/listening-review-model.mjs';
import { normalizeFulltestPreview } from '../lib/admin-listening-fulltest-import-model.mjs';

test('KEEP/CHANGE saved answers restore choice and preserve spaces while typing', () => {
  assert.deepEqual(listeningKeepChangeAnswer('KEEP'), { choice: 'KEEP', text: '' });
  assert.deepEqual(listeningKeepChangeAnswer('CHANGE: Cedar '), { choice: 'CHANGE', text: 'Cedar ' });
  assert.deepEqual(listeningKeepChangeAnswer('CHANGE: '), { choice: 'CHANGE', text: '' });
  assert.deepEqual(listeningKeepChangeAnswer(''), { choice: '', text: '' });
});

test('admin dry-run preserves the existing question_type field for preview', () => {
  const preview = normalizeFulltestPreview({ ok: true, errors: [], warnings: [], section_count: 1, question_count: 1,
    metadata: { test_id: 'SYNTHETIC-CONTACT' }, questions: [{ q_num: 1, section: 'S1', prompt: 'Cedar Avenue.',
      question_type: 'keep_change', answer: 'KEEP' }] });
  assert.equal(preview.questions[0].questionType, 'keep_change');
  assert.equal(preview.questions[0].prompt, 'Cedar Avenue.');
});

test('review retains printed value, saved choice, expected correction and Vietnamese explanation', () => {
  const raw = { attempt_id: 'synthetic', status: 'submitted', score: 1, max_score: 2, sections: [],
    review: [
      { q_num: 1, correct: true, question_type: 'keep_change', printed_value: 'Cedar Avenue.',
        prompt: 'Address', user_answer: 'KEEP', expected: 'KEEP' },
      { q_num: 2, correct: false, question_type: 'keep_change', prompt: 'Northfield ZX4 8QP',
        user_answer: 'CHANGE: 8QP', expected: 'Westfield ZX4 9QP',
        solution: { why_correct: 'Người nói sửa mã bưu điện thành 9QP.' } },
    ] };
  const before = JSON.stringify(raw);
  const review = normalizeListeningReview(raw).review;
  assert.equal(review[0].printed_value, 'Cedar Avenue.');
  assert.equal(review[1].printed_value, 'Northfield ZX4 8QP');
  assert.equal(review[1].user_answer, 'CHANGE: 8QP');
  assert.equal(review[1].expected, 'Westfield ZX4 9QP');
  assert.equal(review[1].solution.why_correct, raw.review[1].solution.why_correct);
  assert.deepEqual(review.map(listeningReviewAnswerState), ['correct', 'incorrect']);
  assert.equal(JSON.stringify(raw), before);
});

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { quizCumulativeModel, quizEndPayload } from '../lib/quiz-player-model.mjs';

// FR-02-006: a Quick Check reopened after earlier answers labels its numbers
// as this run's and adds one running total from the saved word_stats.
describe('quizCumulativeModel', () => {
  test('first run (no saved answers) shows no total', () => {
    assert.equal(quizCumulativeModel([], { total_correct: 3, total_wrong: 0 }), null);
    assert.equal(quizCumulativeModel(undefined, { total_correct: 3 }), null);
    // Words resumed with zero counts (e.g. never answered) are not "earlier answers".
    assert.equal(quizCumulativeModel([{ item_key: 'a', correct_count: 0, wrong_count: 0 }], { total_correct: 1 }), null);
  });

  test('3 answered with 1 wrong, then reopened and finished: total keeps the wrong one', () => {
    const resume = [
      { item_key: 'a', correct_count: 1, wrong_count: 0 },
      { item_key: 'b', correct_count: 1, wrong_count: 0 },
      { item_key: 'c', correct_count: 0, wrong_count: 1 },
    ];
    assert.deepEqual(quizCumulativeModel(resume, { total_correct: 2, total_wrong: 0 }), { correct: 4, wrong: 1 });
  });

  test('this run alone all wrong still reports the earlier correct answers', () => {
    const resume = [{ item_key: 'a', correct_count: 2, wrong_count: 0 }, { item_key: 'b', correct_count: 1, wrong_count: 1 }];
    assert.deepEqual(quizCumulativeModel(resume, { total_correct: 0, total_wrong: 2 }), { correct: 3, wrong: 3 });
  });

  test('bad or negative counts are ignored, not added', () => {
    const resume = [{ correct_count: 'x', wrong_count: -4 }, { correct_count: 2, wrong_count: null }, null];
    assert.deepEqual(quizCumulativeModel(resume, {}), { correct: 2, wrong: 0 });
  });

  test('the end payload still carries only this run\'s numbers', () => {
    const payload = quizEndPayload({ total_questions: 2, total_correct: 2, total_wrong: 0 }, 10, true);
    assert.equal(payload.total_correct, 2);
    assert.equal(payload.total_wrong, 0);
  });
});

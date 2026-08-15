import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  firstUnansweredIndex,
  normalizeD1AttemptAck,
  normalizeD1Exercise,
  normalizeD1Resume,
  normalizeD1Start,
  normalizeD1Summary,
} from '../lib/d1-exercise-model.mjs';

const S = '00000000-0000-4000-8000-000000000101';
const A = '00000000-0000-4000-8000-000000000102';
const B = '00000000-0000-4000-8000-000000000103';
const ATT = '00000000-0000-4000-8000-000000000104';
const exercise = (id, answer = 'adapt') => ({
  id,
  sentence: 'People must ___ to change.',
  answer,
  options: [answer, 'freeze', 'delay', 'reject'],
  source: 'personalized',
});

describe('D1 Next canonical models', () => {
  test('accepts exact four-option exercise and rejects duplicates/answer drift', () => {
    assert.equal(normalizeD1Exercise(exercise(A)).id, A);
    assert.equal(normalizeD1Exercise({ ...exercise(A), options: ['adapt', 'adapt', 'x', 'y'] }), null);
    assert.equal(normalizeD1Exercise({ ...exercise(A), answer: 'missing' }), null);
    assert.equal(normalizeD1Exercise({ ...exercise(A), id: '<script>' }), null);
    assert.equal(normalizeD1Exercise({ ...exercise(A), sentence: 'No blank marker.' }), null);
  });

  test('start payload requires total, unique ids and immutable exercise list', () => {
    const value = normalizeD1Start({ session_id: S, exercises: [exercise(A), exercise(B, 'grow')], total: 2 });
    assert.equal(value.sessionId, S);
    assert.equal(value.exercises.length, 2);
    assert.equal(normalizeD1Start({ session_id: S, exercises: [exercise(A)], total: 2 }), null);
    assert.equal(normalizeD1Start({ session_id: S, exercises: [exercise(A), exercise(A)], total: 2 }), null);
  });

  test('resume validates snapshot order and selects the first unpersisted item', () => {
    const value = normalizeD1Resume({
      session: {
        id: S, status: 'active', total_count: 2,
        exercise_ids: [A, B], exercise_snapshot: [exercise(A), exercise(B, 'grow')],
      },
      attempts: [{ exercise_id: A, user_answer: 'adapt', is_correct: true }],
    });
    assert.equal(firstUnansweredIndex(value), 1);
    assert.equal(normalizeD1Resume({
      session: { id: S, status: 'active', total_count: 2, exercise_ids: [B, A], exercise_snapshot: [exercise(A), exercise(B, 'grow')] },
      attempts: [],
    }), null);
  });

  test('attempt ACK must be persisted and agree with local grade', () => {
    const ack = normalizeD1AttemptAck({
      attempt_id: ATT, persisted: true, replayed: false, is_correct: true,
      correct_answer: 'adapt', score: 1, srs_updated: true, srs_rating: 'good',
    }, exercise(A), 'adapt');
    assert.equal(ack.attemptId, ATT);
    assert.equal(normalizeD1AttemptAck({
      attempt_id: ATT, persisted: true, replayed: false, is_correct: false,
      correct_answer: 'adapt', score: 0, srs_updated: false, srs_rating: null,
    }, exercise(A), 'adapt'), null);
    assert.equal(normalizeD1AttemptAck({
      attempt_id: ATT, persisted: false, replayed: false, is_correct: true,
      correct_answer: 'adapt', score: 1, srs_updated: false, srs_rating: null,
    }, exercise(A), 'adapt'), null);
  });

  test('summary must cover the complete snapshot exactly once', () => {
    const session = normalizeD1Start({ session_id: S, exercises: [exercise(A), exercise(B, 'grow')], total: 2 });
    const summary = normalizeD1Summary({
      session_id: S, correct_count: 1, total_count: 2,
      correct: [{ exercise_id: A, sentence: 'People must ___ to change.', answer: 'adapt' }],
      wrong: [{ exercise_id: B, sentence: 'People must ___ to change.', user_answer: 'freeze', correct_answer: 'grow' }],
    }, session);
    assert.equal(summary.correctCount, 1);
    assert.equal(summary.wrong[0].exerciseId, B);
    assert.equal(normalizeD1Summary({
      session_id: S, correct_count: 1, total_count: 2,
      correct: [{ exercise_id: A, sentence: 'x', answer: 'adapt' }], wrong: [],
    }, session), null);
  });
});

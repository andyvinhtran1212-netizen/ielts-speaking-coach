// LEARNERCORE-0063 amendment 4 (G07-T31): pure helpers of the review pages' new tree.
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  NOTE_MAX_CHARS,
  flaggedQNums,
  normalizeReviewNotes,
  normalizeSavedNote,
  noteLength,
  noteSaveError,
  noteTooLong,
  onlyWrongFromSearch,
  reviewV2Enabled,
  withOnlyWrong,
} from '../lib/review-v2-model.mjs';
import { normalizeListeningReview } from '../lib/listening-review-model.mjs';
import { normalizeReadingReview } from '../lib/reading-review-model.mjs';

describe('FR-106 note length (as the learner sees it)', () => {
  it('counts code points, like the server', () => {
    assert.equal(NOTE_MAX_CHARS, 500);
    assert.equal(noteLength('ạ'.repeat(500)), 500);
    assert.equal(noteLength('😀a'), 2);
    assert.equal(noteLength(null), 0);
  });
  it('judges the trimmed note', () => {
    assert.equal(noteTooLong(`  ${'x'.repeat(500)}  `), false);
    assert.equal(noteTooLong('x'.repeat(501)), true);
  });
});

describe('FR-107 wire shapes', () => {
  it('reads GET notes into a map and refuses a bad shape', () => {
    const notes = normalizeReviewNotes({ notes: [{ q_num: 3, body: 'a', updated_at: '2026-11-23T00:00:00Z' }] });
    assert.deepEqual(notes.get(3), { body: 'a', updatedAt: '2026-11-23T00:00:00Z' });
    assert.throws(() => normalizeReviewNotes({}), /invalid-review-notes/);
    assert.throws(() => normalizeReviewNotes({ notes: [{ q_num: 0, body: 'a' }] }), /invalid-review-notes/);
    assert.throws(() => normalizeReviewNotes({ notes: [{ q_num: 1, body: 7 }] }), /invalid-review-notes/);
  });
  it('reads a save, a delete, and refuses another question', () => {
    assert.deepEqual(normalizeSavedNote({ q_num: 2, body: 'b', updated_at: 'x' }, 2), { body: 'b', updatedAt: 'x' });
    assert.deepEqual(normalizeSavedNote({ q_num: 2, body: null, updated_at: null }, 2), { body: null, updatedAt: null });
    assert.throws(() => normalizeSavedNote({ q_num: 3, body: 'b' }, 2), /invalid-review-note/);
  });
  it('says why a save failed', () => {
    assert.equal(noteSaveError({ status: 422, detail: { error: 'note_too_long', message: 'Ghi chú tối đa 500 ký tự.' } }),
      'Ghi chú tối đa 500 ký tự.');
    assert.equal(noteSaveError({ status: 401 }), 'Phiên đăng nhập đã hết. Đăng nhập lại để lưu ghi chú.');
    assert.equal(noteSaveError(new Error('network')), 'Chưa lưu được ghi chú. Thử lại sau.');
  });
});

describe('FR-109 my_flagged_q_nums', () => {
  it('keeps positive integers once, sorted; a missing field is none', () => {
    assert.deepEqual(flaggedQNums({ my_flagged_q_nums: [4, 2, 2, 0, -1, '3', 1.5] }), [2, 4]);
    assert.deepEqual(flaggedQNums({}), []);
    assert.deepEqual(flaggedQNums(null), []);
  });
});

describe('FR-104 tree pick', () => {
  it('only learner_v2_enabled === true draws the new tree', () => {
    assert.equal(reviewV2Enabled({ learner_v2_enabled: true }), true);
    for (const me of [{ learner_v2_enabled: 'true' }, { learner_v2_enabled: 1 }, {}, null, undefined]) {
      assert.equal(reviewV2Enabled(me), false);
    }
  });
});

describe('FR-105 ?only=wrong', () => {
  it('reads and writes the flag, keeping other params and the hash', () => {
    assert.equal(onlyWrongFromSearch('?attempt_id=a&only=wrong'), true);
    assert.equal(onlyWrongFromSearch('?only=all'), false);
    assert.equal(onlyWrongFromSearch(''), false);
    assert.equal(withOnlyWrong('https://x.test/reading/review?attempt_id=a#q2', true),
      '/reading/review?attempt_id=a&only=wrong#q2');
    assert.equal(withOnlyWrong('/reading/review?attempt_id=a&only=wrong', false), '/reading/review?attempt_id=a');
  });
});

describe('the review models carry the flagged questions', () => {
  it('Listening and Reading normalizers expose myFlaggedQNums', async () => {
    const { readFileSync } = await import('node:fs');
    const listening = JSON.parse(readFileSync(new URL('./fixtures/listening-review-group-and-editorial.json', import.meta.url), 'utf8')).group_review;
    assert.deepEqual(normalizeListeningReview({ ...listening, my_flagged_q_nums: [12] }).myFlaggedQNums, [12]);
    assert.deepEqual(normalizeListeningReview(listening).myFlaggedQNums, []);
    const reading = {
      attempt_id: 'a', status: 'submitted', test_id: 't', title: 'T', score: 0, max_score: 1, skill_breakdown: {},
      passages: [{ passage_order: 1, title: 'S', body_markdown: 'x' }],
      review: [{ q_num: 1, passage_order: 1, correct: false, user_answer: '', expected: 'A' }],
    };
    assert.deepEqual(normalizeReadingReview({ ...reading, my_flagged_q_nums: [1] }).myFlaggedQNums, [1]);
    assert.deepEqual(normalizeReadingReview(reading).myFlaggedQNums, []);
  });
});

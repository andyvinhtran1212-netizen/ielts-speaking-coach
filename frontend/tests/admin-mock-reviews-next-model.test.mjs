import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildFinalBandsPayload,
  initialBandDraft,
  normalizeBulkAck,
  normalizeEssayStatus,
  normalizeRetestSummary,
  normalizeReviewDetail,
  normalizeReviewRoster,
  normalizeSkillReview,
  overallPreview,
  reportSkills,
  reviewBandSkills,
} from '../lib/admin-mock-reviews-model.mjs';

const rosterRow = {
  sitting_id: 's1', review_id: 'r1', student_name: 'An', sitting_status: 'submitted',
  listening: { score: 30, max: 40, band: 7 }, reading: { score: 28, max: 40, band: 6.5 },
  writing: { task1_wc: 160, task2_wc: 270, task1_essay_id: 'e1', task2_essay_id: 'e2', band: 6.5, band_is_final: false },
  speaking: { count: 1, band: 7, band_is_final: true }, review_status: 'claimed', claimed: true,
  needs_retest: false, retest_flags: { reading: true },
};

const rawDetail = {
  review: {
    id: 'r1', sitting_id: 's1', status: 'claimed', claimed_by: 'admin-1',
    ai_draft: { listening: { band: 7 }, reading: { band: 6.5 }, writing: { band: 6.5 }, speaking: { band: 7 } },
    final_bands: {}, per_skill_notes: { speaking: { bands: { fc: 7 } } }, retest_flags: { reading: true }, examiner_comment_vi: 'Tiến bộ tốt.',
  },
  sitting: { id: 's1', student_name: 'An', status: 'submitted', listening_attempt_id: 'la1', reading_attempt_id: 'ra1', essay_task1_id: 'e1', essay_task2_id: 'e2', speaking_session_ids: ['sp1'], writing_submission: {} },
  required_skills: ['listening', 'reading', 'writing'], blankable_skills: [],
};

describe('Admin Mock Reviews strict models', () => {
  test('normalizes roster without turning malformed or duplicate rows into valid students', () => {
    const result = normalizeReviewRoster({ roster: [rosterRow, rosterRow, { ...rosterRow, sitting_id: 's2', listening: { score: '30' } }] });
    assert.equal(result.rows.length, 1);
    assert.equal(result.malformedCount, 2);
    assert.deepEqual(result.rows[0].retestFlags, { reading: true });
    assert.equal(normalizeReviewRoster({ rows: [rosterRow] }), null);
  });

  test('rejects a retest summary whose counts or skill identities are not canonical', () => {
    const good = { total_sittings: 2, reviewed_sittings: 1, needs_retest_count: 1, per_skill: { listening: 0, reading: 1, writing: 0, speaking: 0 }, students: [{ sitting_id: 's1', user_id: 'u1', student_name: 'An', skills: ['reading'] }] };
    assert.equal(normalizeRetestSummary(good).students[0].skills[0], 'reading');
    assert.equal(normalizeRetestSummary({ ...good, students: [{ ...good.students[0], skills: ['invented'] }] }), null);
    assert.equal(normalizeRetestSummary({ ...good, reviewed_sittings: -1 }), null);
  });

  test('uses live Speaking as an explicit extra band while preserving required/blankable rules', () => {
    const detail = normalizeReviewDetail(rawDetail);
    assert.ok(detail);
    assert.deepEqual(reviewBandSkills(detail), ['listening', 'reading', 'writing', 'speaking']);
    assert.deepEqual(initialBandDraft(detail), { listening: '7', reading: '6.5', writing: '6.5', speaking: '7' });
    assert.equal(overallPreview(detail, { listening: '7', reading: '6.5', writing: '6.5', speaking: '' }), 6.5, 'optional live extra does not blank preview');
    const missingSpeaking = buildFinalBandsPayload(detail, { listening: '7', reading: '6.5', writing: '6.5', speaking: '' }, {}, '');
    assert.equal(missingSpeaking.ok, false, 'live assessment still needs a signed-off Speaking band before save');
    const saved = buildFinalBandsPayload(detail, { listening: '7', reading: '6.5', writing: '6.5', speaking: '7' }, { reading: true }, ' ok ');
    assert.deepEqual(saved.value, { final_bands: { listening: 7, reading: 6.5, writing: 6.5, speaking: 7 }, examiner_comment_vi: 'ok', retest_flags: { listening: false, reading: true, writing: false } });
  });

  test('accepts only half-band steps and permits canonical blankable skills', () => {
    const detail = normalizeReviewDetail({ ...rawDetail, blankable_skills: ['writing'], review: { ...rawDetail.review, ai_draft: { listening: { band: 7 }, reading: { band: 6.5 } }, per_skill_notes: {} } });
    assert.equal(buildFinalBandsPayload(detail, { listening: '7', reading: '6.5', writing: '' }, {}, '').ok, true);
    assert.equal(buildFinalBandsPayload(detail, { listening: '7.2', reading: '6.5', writing: '' }, {}, '').ok, false);
  });

  test('pins batch acknowledgements and report truth to backend final bands', () => {
    assert.deepEqual(normalizeBulkAck({ released: ['s1'], skipped: [{ sitting_id: 's2', reason: 'Writing chưa duyệt.' }] }, 'released'), { successes: ['s1'], skipped: [{ sittingId: 's2', reason: 'Writing chưa duyệt.' }] });
    assert.equal(normalizeBulkAck({ released: ['s1'], skipped: [{ sitting_id: 's2' }] }, 'released'), null);
    const detail = normalizeReviewDetail({ ...rawDetail, review: { ...rawDetail.review, status: 'reviewed', final_bands: { listening: 7, reading: 6.5, writing: 6.5, speaking: 7, overall: 7 } } });
    assert.deepEqual(reportSkills(detail), ['listening', 'reading', 'writing', 'speaking'], 'a final-banded live Speaking result is not hidden by LRW config');
    assert.equal(detail.review.finalBands.overall, 7);
  });

  test('rejects malformed auxiliary status/result payloads before React renders them', () => {
    assert.deepEqual(normalizeEssayStatus({ status: 'grading' }), { status: 'grading' });
    assert.equal(normalizeEssayStatus({ status: 'invented' }), null);
    const result = normalizeSkillReview({ score: 1, max_score: 2, band_estimate: 4, review: [{ q_num: 1, user_answer: 'A', expected: 'B', correct: false }], skill_breakdown: { matching: { correct: 1, total: 2 } } });
    assert.equal(result.review[0].correct, false);
    assert.equal(normalizeSkillReview({ score: '1', max_score: 2, review: [] }), null);
    assert.equal(normalizeSkillReview({ score: 1, max_score: 2, review: [{ q_num: 1, correct: 'yes' }] }), null);
  });
});

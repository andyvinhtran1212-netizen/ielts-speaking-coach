import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatDuration,
  formatRatio,
  isUuid,
  normalizeQuizBankAnalytics,
  normalizeQuizBanks,
  normalizeQuizStudentDetail,
  normalizeQuizStudentRollup,
  quizScopeQuery,
} from '../lib/admin-vocab-quiz-analytics-model.mjs';

const userId = '00000000-0000-4000-8000-000000000301';
const bankId = '00000000-0000-4000-8000-000000000302';

describe('Admin Vocabulary quiz analytics model', () => {
  test('normalizes the canonical rollup and rejects a malformed root', () => {
    const value = normalizeQuizStudentRollup({
      overview: { active_learners: 1, total_sessions: 2, total_time_sec: 125, total_words_mastered: 8, avg_accuracy: 0.75 },
      students: [{ user_id: userId, name: 'Lan', email: 'lan@example.test', sessions: 2, graded_sessions: 1, time_sec: 125, avg_accuracy: 0.75, words_mastered: 8, last_active: null }],
    });
    assert.equal(value.students[0].userId, userId);
    assert.equal(value.students[0].lastActive, '');
    assert.equal(normalizeQuizStudentRollup({ students: [] }), null);
  });

  test('keeps canonical nullable session duration without dropping the row', () => {
    const value = normalizeQuizStudentDetail({
      user: { user_id: userId, name: 'Lan', email: 'lan@example.test' },
      banks: [{ bank_id: bankId, code: 'L02', title: null, skill_area: 'vocab', words_count: 20, mastered: 6, in_progress: 2 }],
      recent_sessions: [{ code: 'L02', accuracy: null, words_mastered: 0, total_questions: 0, total_correct: 0, duration_sec: null, ended_at: null, ended_by: null }],
    }, userId);
    assert.equal(value.banks[0].title, '');
    assert.equal(value.recentSessions[0].durationSec, 0);
    assert.equal(normalizeQuizStudentDetail({ user: { user_id: bankId }, banks: [], recent_sessions: [] }, userId), null);
  });

  test('constrains banks to the requested scope and validates analytics ratios', () => {
    const banks = normalizeQuizBanks([{ id: bankId, topic_id: null, code: 'L02', title: null, skill_area: 'vocab', words_count: 20, source: null, version: 1, is_published: true, updated_at: null }], 'vocab');
    assert.equal(banks[0].title, '');
    assert.deepEqual(normalizeQuizBanks([{ id: bankId, topic_id: null, code: 'L02', title: null, skill_area: 'course', words_count: 20, source: null, version: 1, is_published: true, updated_at: null }], 'vocab'), []);
    assert.deepEqual(normalizeQuizBankAnalytics({ session_count: 3, items: [{ item_key: 'mitigate', total: 4, wrong: 1, error_rate: 0.25 }], skills: [{ skill: 'meaning', total: 4, wrong: 1, error_rate: 0.25 }] }), { items: [{ label: 'mitigate', total: 4, wrong: 1, errorRate: 0.25 }], skills: [{ label: 'meaning', total: 4, wrong: 1, errorRate: 0.25 }], sessionCount: 3 });
    assert.equal(normalizeQuizBankAnalytics({ session_count: 1, items: [{ item_key: 'x', total: 1, wrong: 2, error_rate: 2 }], skills: [] }).items.length, 0);
  });

  test('validates URL inputs and formats truthful values', () => {
    assert.equal(isUuid(userId), true);
    assert.equal(isUuid('../users'), false);
    assert.equal(quizScopeQuery('course'), 'skill_area=course');
    assert.equal(quizScopeQuery('other'), null);
    assert.equal(formatDuration(3660), '1h 1m');
    assert.equal(formatDuration(null), '—');
    assert.equal(formatRatio(0.754), '75%');
    assert.equal(formatRatio(null), '—');
  });
});

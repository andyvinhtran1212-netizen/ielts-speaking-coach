import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatMetric,
  isUuid,
  normalizeFlashcardStatsPayload,
  normalizeVocabStatsPayload,
} from '../lib/admin-vocab-stats-model.mjs';

const flashcardPayload = {
  stats: {
    activity: { total_manual_stacks: 5, total_cards_in_manual_stacks: 42, total_active_users: 2, total_reviews_all_time: 20 },
    srs_health: { rating_distribution_percent: { again: 10, hard: 20, good: 50, easy: 20 }, rating_total_count: 10, avg_ease_factor: 2.4, cards_mastered_30plus_days: 8, cards_with_lapses: 3 },
    engagement: { avg_reviews_per_user_last_7_days: 4.5, avg_dau_last_30_days: 2.2, top_reviewed_words: [{ headword: 'mitigate', review_count: 9 }] },
    timeseries: [{ date: '2026-08-15', reviews: 3 }],
  },
  period_days: 30,
  computed_at: '2026-08-15T00:00:00Z',
};

describe('Admin Vocabulary canonical payload models', () => {
  test('accepts exact backend Vocab fields and preserves zero', () => {
    assert.deepEqual(normalizeVocabStatsPayload({ vocab_bank_total: 0, fp_reports_total: 0, fp_rate_percent: 0, users_with_vocab_enabled: 0 }), {
      vocab_bank_total: 0, fp_reports_total: 0, fp_rate_percent: 0, users_with_vocab_enabled: 0,
    });
    assert.equal(normalizeVocabStatsPayload({ vocab_bank_total: 1 }), null);
  });

  test('maps the actual Flashcards contract instead of stale legacy names', () => {
    const normalized = normalizeFlashcardStatsPayload(flashcardPayload);
    assert.equal(normalized.activity.total_manual_stacks, 5);
    assert.equal(normalized.srsHealth.cards_mastered_30plus_days, 8);
    assert.equal(normalized.engagement.topReviewedWords[0].headword, 'mitigate');
    assert.equal(normalized.timeseries[0].reviews, 3);
    assert.equal(normalizeFlashcardStatsPayload({ stats: { activity: { reviews_today: 9 } } }), null);
  });

  test('drops malformed nested rows and rejects missing arrays', () => {
    const payload = structuredClone(flashcardPayload);
    payload.stats.engagement.top_reviewed_words.push({ headword: '<script>', review_count: -1 });
    assert.equal(normalizeFlashcardStatsPayload(payload).engagement.topReviewedWords.length, 1);
    delete payload.stats.timeseries;
    assert.equal(normalizeFlashcardStatsPayload(payload), null);
  });

  test('validates canonical UUID and formats metrics without inventing values', () => {
    assert.equal(isUuid('00000000-0000-4000-8000-000000000115'), true);
    assert.equal(isUuid('user-115'), false);
    assert.equal(formatMetric(12.5, '%'), '12,5%');
    assert.equal(formatMetric(undefined), '—');
  });
});

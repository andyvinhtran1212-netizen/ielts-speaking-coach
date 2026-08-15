function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function metric(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function requiredMetrics(source, keys) {
  const row = record(source);
  if (!row) return null;
  const output = {};
  for (const key of keys) {
    const value = metric(row[key]);
    if (value == null) return null;
    output[key] = value;
  }
  return output;
}

export function normalizeVocabStatsPayload(raw) {
  return requiredMetrics(raw, [
    'vocab_bank_total',
    'fp_reports_total',
    'fp_rate_percent',
    'users_with_vocab_enabled',
  ]);
}

export function normalizeFlashcardStatsPayload(raw) {
  const root = record(raw);
  const stats = record(root?.stats);
  const activity = requiredMetrics(stats?.activity, [
    'total_manual_stacks',
    'total_cards_in_manual_stacks',
    'total_active_users',
    'total_reviews_all_time',
  ]);
  const srsHealth = requiredMetrics(stats?.srs_health, [
    'rating_total_count',
    'avg_ease_factor',
    'cards_mastered_30plus_days',
    'cards_with_lapses',
  ]);
  const engagement = requiredMetrics(stats?.engagement, [
    'avg_reviews_per_user_last_7_days',
    'avg_dau_last_30_days',
  ]);
  const distribution = requiredMetrics(stats?.srs_health?.rating_distribution_percent, [
    'again', 'hard', 'good', 'easy',
  ]);
  const periodDays = metric(root?.period_days);
  const computedAt = typeof root?.computed_at === 'string' && root.computed_at ? root.computed_at : null;
  if (!activity || !srsHealth || !engagement || !distribution || periodDays == null || !computedAt) return null;

  const words = Array.isArray(stats?.engagement?.top_reviewed_words)
    ? stats.engagement.top_reviewed_words.flatMap((value) => {
      const row = record(value);
      const count = metric(row?.review_count);
      return typeof row?.headword === 'string' && row.headword.trim() && count != null
        ? [{ headword: row.headword.trim(), review_count: count }]
        : [];
    })
    : null;
  const timeseries = Array.isArray(stats?.timeseries)
    ? stats.timeseries.flatMap((value) => {
      const row = record(value);
      const reviews = metric(row?.reviews);
      return typeof row?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.date) && reviews != null
        ? [{ date: row.date, reviews }]
        : [];
    })
    : null;
  if (!words || !timeseries) return null;

  return {
    activity,
    srsHealth: { ...srsHealth, ratingDistributionPercent: distribution },
    engagement: { ...engagement, topReviewedWords: words },
    timeseries,
    periodDays,
    computedAt,
  };
}

export function formatMetric(value, suffix = '') {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(value)}${suffix}`
    : '—';
}

export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

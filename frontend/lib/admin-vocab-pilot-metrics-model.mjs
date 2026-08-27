function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function count(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function percentage(value) {
  if (value === null) return null;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
    ? value : undefined;
}

function requireCounts(source, keys) {
  const row = record(source);
  if (!row) return null;
  const output = {};
  for (const key of keys) {
    const value = count(row[key]);
    if (value == null) return null;
    output[key] = value;
  }
  return output;
}

function outcome(source, kind) {
  const row = record(source);
  const counts = requireCounts(row, kind === 'immediate'
    ? ['eligible_unit_starts', 'completed_unit_starts', 'attempts']
    : ['eligible_unit_starts', 'assessed_unit_starts', 'attempts', 'transfer_attempts']);
  if (!row || !counts) return null;
  const rateKey = kind === 'immediate' ? 'completion_rate_percent' : 'followup_rate_percent';
  const rate = percentage(row[rateKey]);
  const accuracy = percentage(row.accuracy_percent);
  if (rate === undefined || accuracy === undefined) return null;
  if (kind === 'immediate') return { ...counts, completion_rate_percent: rate, accuracy_percent: accuracy };
  const transfer = percentage(row.transfer_success_percent);
  if (transfer === undefined) return null;
  return { ...counts, followup_rate_percent: rate, accuracy_percent: accuracy, transfer_success_percent: transfer };
}

export function normalizePilotMetrics(raw) {
  const root = record(raw);
  if (!root || ![30, 90, 180].includes(root.period_days) || typeof root.computed_at !== 'string') return null;
  const cohort = requireCounts(root.cohort, ['enabled_users', 'learners_started', 'unit_starts']);
  const immediate = outcome(root.immediate, 'immediate');
  const day7 = outcome(root.day7, 'delayed');
  const day28 = outcome(root.day28, 'delayed');
  const recommendations = requireCounts(root.recommendations, ['created', 'opened', 'completed', 'dismissed']);
  const recommendationRoot = record(root.recommendations);
  const openRate = percentage(recommendationRoot?.open_rate_percent);
  const completionRate = percentage(recommendationRoot?.completion_rate_percent);
  const runtimeFlags = record(root.runtime_flags);
  if (!cohort || !immediate || !day7 || !day28 || !recommendations || !recommendationRoot
    || openRate === undefined || completionRate === undefined || !runtimeFlags) return null;
  const flags = {};
  for (const key of ['vocab_units_read', 'vocab_unit_attempts_write', 'vocab_unit_recommendations', 'vocab_ai_scoring']) {
    if (typeof runtimeFlags[key] !== 'boolean') return null;
    flags[key] = runtimeFlags[key];
  }
  if (!Array.isArray(root.units)) return null;
  const units = root.units.flatMap((value) => {
    const row = record(value);
    if (!row || typeof row.unit_slug !== 'string' || typeof row.display_headword !== 'string') return [];
    const metrics = requireCounts(row, [
      'started', 'immediate_eligible', 'immediate_completed',
      'day7_eligible', 'day7_assessed', 'day28_eligible', 'day28_assessed',
    ]);
    const day7Accuracy = percentage(row.day7_accuracy_percent);
    const day28Accuracy = percentage(row.day28_accuracy_percent);
    return metrics && day7Accuracy !== undefined && day28Accuracy !== undefined
      ? [{ unit_slug: row.unit_slug, display_headword: row.display_headword, ...metrics,
          day7_accuracy_percent: day7Accuracy, day28_accuracy_percent: day28Accuracy }]
      : [];
  });
  if (units.length !== root.units.length) return null;
  return {
    period_days: root.period_days,
    computed_at: root.computed_at,
    cohort,
    runtime_flags: flags,
    immediate,
    day7,
    day28,
    recommendations: { ...recommendations, open_rate_percent: openRate, completion_rate_percent: completionRate },
    units,
  };
}

export function formatPilotMetric(value, suffix = '') {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(value)}${suffix}`
    : 'Chưa đủ dữ liệu';
}

export function isPilotSampleReady(eligible) {
  return typeof eligible === 'number' && eligible >= 10;
}

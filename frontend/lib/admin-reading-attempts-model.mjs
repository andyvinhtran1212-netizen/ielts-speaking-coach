function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function count(value, nullable = false) {
  if (nullable && value == null) return null;
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function number(value, { min = 0, max = Number.POSITIVE_INFINITY, nullable = false } = {}) {
  if (nullable && value == null) return null;
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : undefined;
}

function timestamp(value) {
  const normalized = text(value);
  return normalized && Number.isFinite(Date.parse(normalized)) ? normalized : undefined;
}

const LOOKUP_FAILURES = new Set(['all_time_count', 'window_count', 'test_titles', 'recent_identities']);

export function normalizeReadingAttemptsPayload(value) {
  const payload = record(value);
  if (!payload) return null;
  const status = ['complete', 'partial', 'unavailable'].includes(payload.data_status)
    ? payload.data_status
    : null;
  const windowDays = count(payload.window_days);
  const windowStart = timestamp(payload.window_start);
  const snapshotTo = timestamp(payload.snapshot_to);
  const computedAt = timestamp(payload.computed_at);
  const totals = record(payload.totals);
  if (!status || typeof payload.ok !== 'boolean'
    || (status === 'unavailable') !== (payload.ok === false)
    || ![7, 30, 90].includes(windowDays) || !windowStart || !snapshotTo || !computedAt || !totals
    || !Array.isArray(payload.band_distribution) || !Array.isArray(payload.skill_performance)
    || !Array.isArray(payload.per_test) || !Array.isArray(payload.recent)
    || !Array.isArray(payload.lookup_failures)) return null;

  const nullable = status === 'unavailable';
  const normalizedTotals = {
    submittedAllTime: count(totals.submitted_all_time, true),
    submittedWindow: count(totals.submitted_window, nullable),
    authAttempts: count(totals.auth_attempts, nullable),
    anonAttempts: count(totals.anon_attempts, nullable),
    authDistinctUsers: count(totals.auth_distinct_users, nullable),
    anonDistinctSources: count(totals.anon_distinct_sources, nullable),
    truncated: Boolean(totals.truncated),
  };
  if (Object.values(normalizedTotals).some((item) => item === undefined)) return null;
  if (status !== 'unavailable' && [normalizedTotals.submittedWindow, normalizedTotals.authAttempts,
    normalizedTotals.anonAttempts, normalizedTotals.authDistinctUsers,
    normalizedTotals.anonDistinctSources].some((item) => item == null)) return null;
  if (status === 'unavailable' && [normalizedTotals.submittedWindow, normalizedTotals.authAttempts,
    normalizedTotals.anonAttempts, normalizedTotals.authDistinctUsers,
    normalizedTotals.anonDistinctSources].some((item) => item != null)) return null;

  let clientMalformed = 0;
  const bands = [];
  for (const raw of payload.band_distribution) {
    const row = record(raw); const band = number(row?.band, { max: 9 }); const rowCount = count(row?.count);
    if (band === undefined || rowCount === undefined) { clientMalformed += 1; continue; }
    bands.push({ band, count: rowCount });
  }
  const skills = [];
  for (const raw of payload.skill_performance) {
    const row = record(raw); const skillTag = text(row?.skill_tag); const correct = count(row?.correct);
    const total = count(row?.total); const accuracy = number(row?.accuracy, { max: 1, nullable: true });
    if (!skillTag || correct === undefined || total === undefined || accuracy === undefined || correct > total) { clientMalformed += 1; continue; }
    skills.push({ skillTag, correct, total, accuracy });
  }
  const perTest = [];
  for (const raw of payload.per_test) {
    const row = record(raw); const testId = text(row?.test_id); const title = text(row?.title);
    const attempts = count(row?.attempts); const auth = count(row?.auth); const anon = count(row?.anon);
    const avgBand = number(row?.avg_band, { max: 9, nullable: true });
    if (!testId || !title || attempts === undefined || auth === undefined || anon === undefined || avgBand === undefined || auth + anon !== attempts) { clientMalformed += 1; continue; }
    perTest.push({ testId, title, attempts, auth, anon, avgBand });
  }
  const recent = [];
  for (const raw of payload.recent) {
    const row = record(raw); const submittedAt = timestamp(row?.submitted_at); const testTitle = text(row?.test_title);
    const who = text(row?.who); const band = number(row?.band, { max: 9, nullable: true });
    const timeMinutes = number(row?.time_minutes, { nullable: true });
    if (!submittedAt || !testTitle || !who || typeof row?.is_anonymous !== 'boolean' || band === undefined || timeMinutes === undefined) { clientMalformed += 1; continue; }
    recent.push({ submittedAt, testTitle, who, isAnonymous: row.is_anonymous, band, timeMinutes });
  }
  const time = record(payload.time_stats);
  const timeStats = time ? {
    avgMinutes: number(time.avg_minutes, { nullable: true }),
    medianMinutes: number(time.median_minutes, { nullable: true }),
    count: count(time.count),
  } : null;
  if (!timeStats || Object.values(timeStats).some((item) => item === undefined)) return null;

  const backendMalformed = count(payload.malformed_count);
  if (backendMalformed === undefined || payload.lookup_failures.some((item) => !LOOKUP_FAILURES.has(item))) return null;
  const lookupFailures = [...new Set(payload.lookup_failures)];
  const derivedAttempts = normalizedTotals.authAttempts == null || normalizedTotals.anonAttempts == null
    ? null
    : normalizedTotals.authAttempts + normalizedTotals.anonAttempts;
  if (status !== 'unavailable' && (
    normalizedTotals.submittedWindow < derivedAttempts
    || (status === 'complete' && normalizedTotals.submittedWindow !== derivedAttempts)
  )) return null;
  if (status === 'complete' && (normalizedTotals.truncated || backendMalformed > 0 || lookupFailures.length > 0)) return null;
  return {
    status: clientMalformed > 0 && status === 'complete' ? 'partial' : status,
    windowDays, windowStart, snapshotTo, computedAt,
    totals: normalizedTotals, bands, skills, timeStats, perTest, recent,
    malformedCount: backendMalformed + clientMalformed,
    lookupFailures,
  };
}

export function formatReadingCount(value, partial = false, approximate = false) {
  if (!Number.isSafeInteger(value) || value < 0) return '—';
  const prefix = approximate && partial ? '≈ ≥ ' : partial ? '≥ ' : approximate ? '≈ ' : '';
  return `${prefix}${value.toLocaleString('vi-VN')}`;
}

export function formatReadingDate(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return '—';
  return `${new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(value))} UTC`;
}

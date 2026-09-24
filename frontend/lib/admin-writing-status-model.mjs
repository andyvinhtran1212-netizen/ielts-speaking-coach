import { normalizeWritingNavigation, writingNavigationHref } from './admin-writing-navigation-model.mjs';

const STATUSES = new Set(['pending', 'grading', 'graded', 'reviewed', 'delivered', 'failed']);
const TERMINAL = new Set(['graded', 'reviewed', 'delivered', 'failed']);
const TIERS = new Set(['quick', 'standard', 'deep', 'instructor']);

const objectOf = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const stringOf = (value) => typeof value === 'string' ? value.trim() : '';
const nullableString = (value) => stringOf(value) || null;
const integerOf = (value) => {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value);
  return null;
};
const validDate = (value) => {
  const text = stringOf(value);
  return text && !Number.isNaN(Date.parse(text)) ? text : null;
};

export function normalizeWritingStatusQuery(raw = {}) {
  const navigation = normalizeWritingNavigation(raw);
  const legacyQueueContext = !raw?.from && !raw?.source &&
    ['mocklane', 'status', 'queue_status', 'queueStatus', 'cohort_id', 'cohortId', 'overdue', 'q', 'query', 'page', 'page_size', 'pageSize']
      .some((key) => raw?.[key] !== undefined && raw?.[key] !== null && raw?.[key] !== '' && raw?.[key] !== false);
  const context = navigation.queue;
  return {
    essayId: navigation.essayId,
    source: legacyQueueContext ? 'queue' : navigation.source,
    embed: navigation.embed,
    mocklane: navigation.mocklane,
    lane: context.lane,
    page: context.page,
    pageSize: context.pageSize,
    queueStatus: context.queueStatus,
    cohortId: context.cohortId,
    overdue: context.overdue,
    query: context.query,
  };
}

export function normalizeWritingStatusPayload(raw, expectedEssayId) {
  const data = objectOf(raw);
  if (!data) return null;
  const essayId = stringOf(data.essay_id);
  const status = stringOf(data.status);
  const etaSeconds = integerOf(data.eta_seconds);
  const attemptCount = integerOf(data.attempt_count);
  const maxAttempts = integerOf(data.max_attempts);
  const attemptFailures = integerOf(data.attempt_failures);
  const createdAt = validDate(data.created_at);
  const gradingTier = stringOf(data.grading_tier) || 'standard';
  if (!essayId || essayId !== stringOf(expectedEssayId) || !STATUSES.has(status) || !createdAt ||
      etaSeconds == null || etaSeconds < 1 || etaSeconds > 3600 || !TIERS.has(gradingTier) ||
      attemptCount == null || attemptCount < 0 || maxAttempts == null || maxAttempts < 1 ||
      attemptFailures == null || attemptFailures < 0 || attemptCount > maxAttempts) return null;

  let malformedOptional = 0;
  // A stuck, never-claimed queued job can record its first timeout before the
  // asynchronously scheduled retry increments attempt_count. The primary essay
  // status remains canonical in that window; degrade only the optional ledger
  // relationship instead of making the whole monitor unavailable.
  if (attemptFailures > attemptCount) malformedOptional += 1;
  const observedAttemptCeiling = Math.max(attemptCount, attemptFailures);
  let lastFailure = null;
  if (data.last_failure != null) {
    const failure = objectOf(data.last_failure);
    const attempt = integerOf(failure?.attempt);
    const model = nullableString(failure?.model);
    const kind = nullableString(failure?.kind);
    const message = nullableString(failure?.message);
    const at = validDate(failure?.at);
    if (failure && attempt != null && attempt > 0 && attempt <= observedAttemptCeiling && attempt <= maxAttempts && attemptFailures > 0 && (model || kind || message || at)) {
      lastFailure = { attempt, model, kind, message, at };
    } else malformedOptional += 1;
  } else if (attemptFailures > 0) malformedOptional += 1;
  if (data.error_message != null && typeof data.error_message !== 'string') malformedOptional += 1;

  return {
    essayId,
    status,
    errorMessage: nullableString(data.error_message),
    etaSeconds,
    gradingTier,
    createdAt,
    attemptCount,
    maxAttempts,
    attemptFailures,
    lastFailure,
    malformedOptional,
  };
}

export function isWritingStatusTerminal(status) {
  return TERMINAL.has(stringOf(status));
}

export function writingStatusProgress(status, observedSeconds, etaSeconds) {
  if (isWritingStatusTerminal(status)) return 100;
  if (status === 'pending') return 8;
  const eta = Math.max(1, Number(etaSeconds) || 60);
  return Math.max(12, Math.min(92, Math.round((Math.max(0, Number(observedSeconds) || 0) / eta) * 100)));
}

export function writingStatusPhase(status, tier, observedSeconds) {
  if (status !== 'grading') return null;
  if (tier !== 'deep') return tier === 'instructor'
    ? 'AI pass của instructor workflow đang chạy'
    : 'AI đang phân tích bài viết';
  const elapsed = Math.max(0, Number(observedSeconds) || 0);
  const phase = elapsed < 90 ? 1 : elapsed < 180 ? 2 : 3;
  return `Deep tier · pha ${phase}/3 ước tính`;
}

export function writingStatusHref(kind, query) {
  const normalized = normalizeWritingStatusQuery(query);
  return writingNavigationHref(kind === 'grade' ? 'grade' : 'queue', { ...normalized, from: normalized.source });
}

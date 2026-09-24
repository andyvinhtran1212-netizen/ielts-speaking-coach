import { normalizeWritingQueueContext, writingNavigationHref, writingQueueSearch } from './admin-writing-navigation-model.mjs';

export { writingQueueSearch };

const STATUSES = new Set(['pending', 'grading', 'graded', 'reviewed', 'delivered', 'failed']);

const objectOf = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const stringOf = (value) => typeof value === 'string' ? value.trim() : '';
const nullableString = (value) => stringOf(value) || null;
const finiteOf = (value) => value == null || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const dateOf = (value) => {
  const text = stringOf(value);
  return text && !Number.isNaN(Date.parse(text)) ? text : null;
};
const hasValue = (value) => value !== undefined && value !== null && value !== '';

export function normalizeWritingQueueFilters(raw = {}) {
  return normalizeWritingQueueContext(raw);
}

export function writingQueueFetchKey(filters) {
  const normalized = normalizeWritingQueueFilters({
    status: filters?.lane === 'mock' ? undefined : filters?.lane,
    mocklane: filters?.lane === 'mock',
    cohortId: filters?.cohortId,
    overdue: filters?.overdue,
    queueStatus: filters?.queueStatus,
    query: filters?.query,
    page: filters?.page,
  });
  return `${normalized.lane}\u0000${normalized.cohortId}\u0000${normalized.queueStatus}\u0000${normalized.overdue ? '1' : '0'}\u0000${normalized.query}`;
}

export function writingQueueApiQuery(filters, options = {}) {
  const normalized = normalizeWritingQueueFilters({
    status: filters?.lane === 'mock' ? undefined : filters?.lane,
    mocklane: filters?.lane === 'mock',
    cohortId: filters?.cohortId,
    overdue: filters?.overdue,
    queueStatus: filters?.queueStatus,
    query: filters?.query,
  });
  const limit = Math.min(100, Math.max(1, Number(options.limit) || 25));
  const offset = Math.max(0, Number(options.offset) || 0);
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset), mock: normalized.lane === 'mock' ? 'true' : 'false' });
  if (normalized.queueStatus) params.set('status', normalized.queueStatus);
  else if (!['all', 'mock'].includes(normalized.lane)) params.set('status', normalized.lane);
  if (normalized.cohortId) params.set('cohort_id', normalized.cohortId);
  const query = options.query === undefined ? normalized.query : stringOf(options.query).slice(0, 100);
  if (query) params.set('q', query);
  if (normalized.overdue) params.set('overdue', 'true');
  return params;
}

export function writingQueueApiPath(filters) {
  return `/admin/writing/essay-queue?${writingQueueApiQuery(filters)}`;
}

export function legacyWritingQueuePage(raw, query, now = Date.now()) {
  if (!Array.isArray(raw)) return null;
  const needle = stringOf(query?.get('q')).slice(0, 100).toLocaleLowerCase();
  const overdue = query?.get('overdue') === 'true';
  const limit = Math.min(100, Math.max(1, Number(query?.get('limit')) || 25));
  const offset = Math.max(0, Number(query?.get('offset')) || 0);
  const matching = raw.filter((row) => {
    if (!row || typeof row !== 'object') return false;
    if (needle && ![row.student_full_name, row.student_code]
      .some((field) => stringOf(field).toLocaleLowerCase().includes(needle))
      && stringOf(row.student_id).toLocaleLowerCase() !== needle) return false;
    return !overdue || isWritingEssayOverdue(row, now);
  }).sort((left, right) => {
    const leftCreated = stringOf(left.created_at);
    const rightCreated = stringOf(right.created_at);
    return leftCreated > rightCreated ? -1 : leftCreated < rightCreated ? 1
      : stringOf(left.id) > stringOf(right.id) ? -1
        : stringOf(left.id) < stringOf(right.id) ? 1 : 0;
  });
  return {
    items: matching.slice(offset, offset + limit),
    total: matching.length,
    total_complete: false,
    limit,
    offset,
  };
}

export function shouldPollWritingQueue(filters) {
  const normalized = normalizeWritingQueueFilters({
    status: filters?.lane === 'mock' ? undefined : filters?.lane,
    mocklane: filters?.lane === 'mock',
    queueStatus: filters?.queueStatus,
  });
  return normalized.lane === 'grading' || (normalized.lane === 'mock' && normalized.queueStatus === 'grading');
}

export function normalizeWritingQueueRow(raw) {
  const row = objectOf(raw);
  if (!row) return null;
  const id = stringOf(row.id);
  const status = stringOf(row.status);
  const taskType = stringOf(row.task_type);
  if (!id || !STATUSES.has(status) || !taskType) return null;
  const analysisLevel = finiteOf(row.analysis_level);
  const wordCount = finiteOf(row.word_count);
  const band = finiteOf(row.band);
  const createdAt = dateOf(row.created_at);
  const deliveredAt = dateOf(row.delivered_at);
  const gradingSkippedAt = dateOf(row.grading_skipped_at);
  const deadline = dateOf(row.deadline);
  if ((hasValue(row.analysis_level) && analysisLevel == null) || (hasValue(row.word_count) && wordCount == null) ||
      (hasValue(row.band) && band == null) || !createdAt ||
      (hasValue(row.delivered_at) && !deliveredAt) || (hasValue(row.grading_skipped_at) && !gradingSkippedAt) ||
      (hasValue(row.deadline) && !deadline) ||
      (analysisLevel != null && (!Number.isInteger(analysisLevel) || analysisLevel < 1 || analysisLevel > 5)) ||
      (wordCount != null && wordCount < 0) || (band != null && (band < 0 || band > 9))) return null;
  return {
    id,
    studentId: nullableString(row.student_id),
    studentName: nullableString(row.student_full_name),
    studentCode: nullableString(row.student_code),
    taskType,
    status,
    analysisLevel,
    selectedModel: nullableString(row.selected_model),
    wordCount: wordCount == null ? 0 : Math.round(wordCount),
    createdAt,
    deliveredAt,
    errorMessage: nullableString(row.error_message),
    sittingId: nullableString(row.sitting_id),
    gradingSkippedAt,
    band,
    deadline,
    task1ImageMissing: row.task1_image_missing === true,
  };
}

export function normalizeWritingQueueList(raw) {
  if (!Array.isArray(raw)) return null;
  const rows = [];
  let malformedCount = 0;
  for (const value of raw) {
    const row = normalizeWritingQueueRow(value);
    if (row) rows.push(row); else malformedCount += 1;
  }
  return { rows, malformedCount, returnedCount: raw.length };
}

export function normalizeWritingQueuePage(raw) {
  const source = objectOf(raw);
  if (!source || !Array.isArray(source.items)) return null;
  const total = finiteOf(source.total);
  const limit = finiteOf(source.limit);
  const offset = finiteOf(source.offset);
  if (total == null || limit == null || offset == null || !Number.isInteger(total) ||
      !Number.isInteger(limit) || !Number.isInteger(offset) || total < 0 || limit < 1 || offset < 0) return null;
  const normalized = normalizeWritingQueueList(source.items);
  if (!normalized) return null;
  if (typeof source.total_complete !== 'boolean') return null;
  return { ...normalized, total, totalComplete: source.total_complete, limit, offset };
}

export function normalizeWritingQueueCohorts(raw) {
  const source = objectOf(raw);
  if (!source || !Array.isArray(source.cohorts)) return null;
  const rows = [];
  let malformedCount = 0;
  for (const value of source.cohorts) {
    const cohort = objectOf(value);
    const id = stringOf(cohort?.id);
    const name = stringOf(cohort?.name);
    if (id && name) rows.push({ id, name }); else malformedCount += 1;
  }
  return { rows, malformedCount };
}

export function writingMockMinimum(taskType) {
  return stringOf(taskType).startsWith('task1') ? 150 : 250;
}

export function isWritingEssayOverdue(row, now = Date.now()) {
  return row?.status !== 'delivered' && Boolean(row?.deadline) && Date.parse(row.deadline) < now;
}

export function normalizeBulkDelivery(raw, expectedIds) {
  const data = objectOf(raw);
  const expected = [...new Set((expectedIds || []).map(stringOf).filter(Boolean))];
  if (!data || !Array.isArray(data.delivered) || !Array.isArray(data.skipped)) return null;
  const delivered = data.delivered.map(stringOf).filter(Boolean);
  const skipped = data.skipped.map((value) => {
    const item = objectOf(value);
    const id = stringOf(item?.id);
    return id ? { id, status: nullableString(item?.status), reason: nullableString(item?.reason) } : null;
  });
  if (skipped.some((item) => !item)) return null;
  const accounted = [...delivered, ...skipped.map((item) => item.id)];
  if (Number(data.delivered_count) !== delivered.length || Number(data.skipped_count) !== skipped.length ||
      new Set(accounted).size !== accounted.length || accounted.length !== expected.length ||
      accounted.some((id) => !expected.includes(id)) || expected.some((id) => !accounted.includes(id))) return null;
  return { delivered, skipped };
}

export function normalizeStartGrading(raw, essayId) {
  const data = objectOf(raw);
  return data && stringOf(data.essay_id) === stringOf(essayId) && stringOf(data.status) === 'queued' && stringOf(data.job_id)
    ? { essayId: stringOf(data.essay_id), jobId: stringOf(data.job_id) }
    : null;
}

export function normalizeWritingQueueStatusReadback(raw, essayId) {
  const data = objectOf(raw);
  const expected = stringOf(essayId);
  const actual = stringOf(data?.essay_id);
  const status = stringOf(data?.status);
  return data && expected && actual === expected && STATUSES.has(status)
    ? { essayId: actual, status }
    : null;
}

export function normalizeSkipGrading(raw, essayId) {
  const data = objectOf(raw);
  return data && data.ok === true && data.grading_skipped === true && stringOf(data.essay_id) === stringOf(essayId)
    ? { essayId: stringOf(data.essay_id) }
    : null;
}

export function writingQueueDestination(row, filters) {
  const path = (row.status === 'pending' && !row.gradingSkippedAt) || row.status === 'grading'
    ? 'status' : 'grade';
  return writingNavigationHref(path, { ...filters, from: 'queue', essayId: row.id, mocklane: filters?.lane === 'mock' });
}

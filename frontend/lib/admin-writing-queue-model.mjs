const LANES = new Set(['grading', 'graded', 'reviewed', 'delivered', 'all', 'mock']);
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
  const source = objectOf(raw) || {};
  const mock = source.mocklane === true || source.mocklane === '1';
  const supplied = source.status !== undefined && source.status !== null;
  const requested = stringOf(source.status);
  let lane = mock ? 'mock' : supplied && (requested === '' || requested === 'all') ? 'all' : requested || 'graded';
  if (!LANES.has(lane)) lane = 'graded';
  return {
    lane,
    cohortId: stringOf(source.cohortId || source.cohort_id),
    overdue: source.overdue === true || source.overdue === '1',
    embed: source.embed === true || source.embed === '1',
  };
}

export function writingQueueSearch(filters) {
  const normalized = normalizeWritingQueueFilters({
    status: filters?.lane === 'mock' ? undefined : filters?.lane,
    mocklane: filters?.lane === 'mock',
    cohortId: filters?.cohortId,
    overdue: filters?.overdue,
    embed: filters?.embed,
  });
  const params = new URLSearchParams();
  if (normalized.lane === 'mock') params.set('mocklane', '1');
  else if (normalized.lane !== 'graded') params.set('status', normalized.lane);
  if (normalized.cohortId) params.set('cohort_id', normalized.cohortId);
  if (normalized.overdue) params.set('overdue', '1');
  if (normalized.embed) params.set('embed', '1');
  return params.toString();
}

export function writingQueueFetchKey(filters) {
  const normalized = normalizeWritingQueueFilters({
    status: filters?.lane === 'mock' ? undefined : filters?.lane,
    mocklane: filters?.lane === 'mock',
    cohortId: filters?.cohortId,
  });
  return `${normalized.lane}\u0000${normalized.cohortId}`;
}

export function writingQueueApiPath(filters) {
  const normalized = normalizeWritingQueueFilters({
    status: filters?.lane === 'mock' ? undefined : filters?.lane,
    mocklane: filters?.lane === 'mock',
    cohortId: filters?.cohortId,
  });
  const params = new URLSearchParams({ limit: '200', mock: normalized.lane === 'mock' ? 'true' : 'false' });
  if (!['all', 'mock'].includes(normalized.lane)) params.set('status', normalized.lane);
  if (normalized.cohortId) params.set('cohort_id', normalized.cohortId);
  return `/admin/writing/essays?${params}`;
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

export function normalizeSkipGrading(raw, essayId) {
  const data = objectOf(raw);
  return data && data.ok === true && data.grading_skipped === true && stringOf(data.essay_id) === stringOf(essayId)
    ? { essayId: stringOf(data.essay_id) }
    : null;
}

export function writingQueueDestination(row, filters) {
  const params = new URLSearchParams();
  params.set('essay_id', row.id);
  if (filters?.embed) params.set('embed', '1');
  if (filters?.lane === 'mock') params.set('mocklane', '1');
  const path = (row.status === 'pending' && !row.gradingSkippedAt) || row.status === 'grading'
    ? '/pages/admin/writing/status.html'
    : '/admin/writing/grade';
  return `${path}?${params}`;
}

const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const isString = (value) => typeof value === 'string';
const isNullableDate = (value) => value == null || (isString(value) && Number.isFinite(Date.parse(value)));
const isCount = (value) => Number.isInteger(value) && value >= 0;
const isJsonValue = (value) => value == null || typeof value === 'string'
  || typeof value === 'number' || typeof value === 'boolean'
  || (Array.isArray(value) && value.every(isJsonValue))
  || (isObject(value) && Object.values(value).every(isJsonValue));

export const EXERCISE_STATUSES = ['draft', 'published', 'rejected'];
export const REVIEW_ACTIONS = ['publish', 'reject', 'unpublish'];

export function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

export function targetStatus(action) {
  return action === 'publish' ? 'published' : action === 'reject' ? 'rejected' : action === 'unpublish' ? 'draft' : '';
}

function normalizeExercise(value, expectedStatus = '') {
  if (!isObject(value) || !isUuid(value.id) || value.exercise_type !== 'D1'
    || !EXERCISE_STATUSES.includes(value.status) || (expectedStatus && value.status !== expectedStatus)
    || !isObject(value.content_payload) || !isJsonValue(value.content_payload)
    || !isNullableDate(value.created_at) || !isNullableDate(value.reviewed_at)) return null;
  const payload = value.content_payload;
  const sentence = isString(payload.sentence) ? payload.sentence : '';
  const answer = isString(payload.answer) ? payload.answer : isString(payload.word) ? payload.word : '';
  const distractors = Array.isArray(payload.distractors) && payload.distractors.every(isString) ? payload.distractors : [];
  return {
    id: value.id,
    exerciseType: value.exercise_type,
    status: value.status,
    contentPayload: payload,
    sentence,
    answer,
    distractors,
    payloadComplete: Boolean(sentence && answer && distractors.length),
    createdAt: value.created_at ?? '',
    reviewedAt: value.reviewed_at ?? '',
  };
}

export function normalizeExerciseList(value, expectedStatus, limit) {
  if (!EXERCISE_STATUSES.includes(expectedStatus) || !Number.isInteger(limit) || limit < 1
    || !Array.isArray(value) || value.length > limit) return null;
  const rows = value.map((row) => normalizeExercise(row, expectedStatus));
  return rows.every(Boolean) && new Set(rows.map((row) => row.id)).size === rows.length ? rows : null;
}

export function normalizeExerciseAck(value, expectedId, action) {
  const status = targetStatus(action);
  if (!status) return null;
  const row = normalizeExercise(value, status);
  return row && row.id === expectedId ? row : null;
}

export function normalizeBulkAck(value, expectedIds, expectedAction) {
  if (!isObject(value) || !['publish', 'reject'].includes(expectedAction)
    || value.action !== expectedAction || !isCount(value.affected) || !Array.isArray(value.ids)
    || value.affected !== expectedIds.length || value.ids.length !== expectedIds.length
    || !value.ids.every(isUuid) || new Set(value.ids).size !== value.ids.length) return null;
  const expected = new Set(expectedIds);
  return value.ids.every((id) => expected.has(id))
    ? { action: value.action, affected: value.affected, ids: value.ids }
    : null;
}

export function normalizeGenerationAck(value, expectedWords, expectedCount) {
  const maxItems = Math.min(expectedWords.length, expectedCount, 100);
  const expectedChunks = Math.max(1, Math.ceil(maxItems / 10));
  if (!isObject(value) || !isUuid(value.job_id) || !['completed', 'partial'].includes(value.status)
    || !isCount(value.inserted_count) || value.inserted_count > maxItems
    || value.requested_count !== expectedCount || value.word_count !== expectedWords.length
    || !isCount(value.total_chunks) || value.total_chunks !== expectedChunks
    || !isCount(value.successful_chunks) || !isCount(value.failed_chunks)
    || value.successful_chunks + value.failed_chunks !== value.total_chunks
    || (value.successful_chunks === 0) !== (value.inserted_count === 0)
    || (value.status === 'completed' && value.failed_chunks !== 0)
    || (value.status === 'partial' && value.failed_chunks === 0)
    || typeof value.estimated_cost_usd !== 'number' || !Number.isFinite(value.estimated_cost_usd) || value.estimated_cost_usd < 0
    || !isString(value.message)) return null;
  return {
    jobId: value.job_id,
    status: value.status,
    insertedCount: value.inserted_count,
    requestedCount: value.requested_count,
    wordCount: value.word_count,
    totalChunks: value.total_chunks,
    successfulChunks: value.successful_chunks,
    failedChunks: value.failed_chunks,
    estimatedCostUsd: value.estimated_cost_usd,
    message: value.message,
  };
}

export function parseTargetWords(value) {
  const seen = new Set();
  return String(value || '').split(/[\n,]+/).map((word) => word.trim()).filter((word) => {
    const key = word.toLocaleLowerCase('en');
    if (!word || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

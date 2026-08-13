const STATUSES = new Set(['queued', 'claimed', 'edited', 'delivered', 'released']);
const VIEWS = new Set(['all_active', 'queued', 'my_claims', 'delivered']);
const TASKS = new Set(['task1_academic', 'task1_general', 'task2']);
const objectOf = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const textOf = (value) => typeof value === 'string' ? value.trim() : '';
const optionalText = (value) => textOf(value) || null;
const dateOf = (value) => {
  const text = optionalText(value);
  return text && !Number.isNaN(Date.parse(text)) ? text : null;
};

export const INSTRUCTOR_QUEUE_VIEWS = {
  all_active: { statuses: ['queued', 'claimed', 'edited'], mine: false },
  queued: { statuses: ['queued'], mine: false },
  my_claims: { statuses: ['claimed', 'edited'], mine: true },
  delivered: { statuses: ['delivered'], mine: false },
};

export function normalizeInstructorReview(raw) {
  const row = objectOf(raw); const id = textOf(row?.id); const essayId = textOf(row?.essay_id); const status = textOf(row?.status);
  if (!row || !id || !essayId || !STATUSES.has(status)) return null;
  const createdAt = dateOf(row.created_at); const updatedAt = dateOf(row.updated_at);
  if (!createdAt || !updatedAt) return null;
  return { id, essayId, status, claimedBy: optionalText(row.claimed_by), claimedAt: dateOf(row.claimed_at), deliveredAt: dateOf(row.delivered_at), instructorNote: optionalText(row.instructor_note), createdAt, updatedAt };
}

export function normalizeInstructorQueueItem(raw) {
  const row = objectOf(raw); const review = normalizeInstructorReview(row?.review); const essayId = textOf(row?.essay_id); const taskType = textOf(row?.task_type);
  const level = Number(row?.student_level); const ageHours = Number(row?.age_hours);
  if (!row || !review || essayId !== review.essayId || !TASKS.has(taskType) || !Number.isInteger(level) || level < 1 || level > 5 || !Number.isFinite(ageHours) || ageHours < 0 || typeof row.is_overdue !== 'boolean') return null;
  const submittedAt = dateOf(row.submitted_at); if (!submittedAt) return null;
  return { review, essayId, studentEmail: optionalText(row.student_email), studentLevel: level, taskType, submittedAt, ageHours, isOverdue: row.is_overdue };
}

export function normalizeInstructorQueue(raw) {
  if (!Array.isArray(raw)) return null;
  const seen = new Set(); const rows = [];
  for (const value of raw) {
    const row = normalizeInstructorQueueItem(value);
    if (row && !seen.has(row.review.id)) { rows.push(row); seen.add(row.review.id); }
  }
  return { rows, malformedCount: raw.length - rows.length };
}

export function instructorQueueFilters(raw = {}) {
  const view = textOf(raw.view);
  return { view: VIEWS.has(view) ? view : 'all_active', embed: raw.embed === '1' ? '1' : '', mocklane: raw.mocklane === '1' ? '1' : '' };
}

export function instructorQueueHref(raw = {}) {
  const filters = instructorQueueFilters(raw); const params = new URLSearchParams();
  if (filters.view !== 'all_active') params.set('view', filters.view);
  if (filters.embed) params.set('embed', '1');
  if (filters.mocklane) params.set('mocklane', '1');
  const query = params.toString(); return `/admin/writing/instructor-queue${query ? `?${query}` : ''}`;
}

export function instructorQueuePath(view, adminId = '') {
  const filter = INSTRUCTOR_QUEUE_VIEWS[VIEWS.has(view) ? view : 'all_active']; const params = new URLSearchParams();
  for (const status of filter.statuses) params.append('status', status);
  if (filter.mine && textOf(adminId)) params.set('instructor_id', textOf(adminId));
  return `/admin/instructor/queue?${params}`;
}

export function instructorGradeHref(essayId, raw = {}) {
  const id = textOf(essayId); if (!id) return '';
  const filters = instructorQueueFilters(raw); const params = new URLSearchParams({ essay_id: id });
  if (filters.embed) params.set('embed', '1');
  if (filters.mocklane) params.set('mocklane', '1');
  return `/admin/writing/grade?${params}`;
}

export function normalizeClaimAck(raw, reviewId, adminId) {
  const review = normalizeInstructorReview(raw);
  return review && review.id === textOf(reviewId) && review.status === 'claimed' && review.claimedBy === textOf(adminId) ? review : null;
}

export function normalizeReleaseAck(raw, reviewId) {
  const review = normalizeInstructorReview(raw);
  return review && review.id === textOf(reviewId) && review.status === 'queued' && review.claimedBy === null && review.claimedAt === null ? review : null;
}

export function pendingInstructorOperation(raw, account) {
  const value = objectOf(raw); const action = textOf(value?.action); const reviewId = textOf(value?.reviewId); const owner = textOf(value?.account);
  if (owner !== textOf(account) || !['claim', 'release'].includes(action) || !reviewId) return null;
  return { account: owner, action, reviewId, essayId: optionalText(value.essayId), startedAt: dateOf(value.startedAt) || new Date(0).toISOString() };
}

export function findInstructorReview(rows, reviewId) {
  return (rows || []).find((row) => row?.review?.id === textOf(reviewId)) || null;
}

export function claimReadback(row, adminId) {
  return ['claimed', 'edited'].includes(row?.review?.status) && row.review.claimedBy === textOf(adminId) ? row : null;
}

export function releaseReadback(row) {
  return row?.review?.status === 'queued' && row.review.claimedBy === null ? row : null;
}

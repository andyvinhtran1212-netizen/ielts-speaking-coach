import { normalizeInstructorQueue } from './instructor-dashboard-model.mjs';

const ESSAY_STATUSES = new Set(['pending', 'grading', 'graded', 'reviewed', 'delivered', 'failed']);

function objectRow(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function nullableText(value) {
  return text(value) || null;
}

function finite(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function band(value) {
  const parsed = finite(value);
  return parsed != null && parsed >= 0 && parsed <= 9 ? parsed : null;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

export function readInstructorGradeQuery(params) {
  const essayIds = params.getAll('essay_id');
  const reviewIds = params.getAll('review_id');
  const targets = params.getAll('as_instructor');
  if (essayIds.length !== 1 || !text(essayIds[0])) {
    throw new Error(essayIds.length > 1 ? 'URL có nhiều essay_id.' : 'Thiếu essay_id.');
  }
  if (reviewIds.length > 1) throw new Error('URL có nhiều review_id. Hãy mở lại bài từ hàng chờ chấm.');
  if (targets.length > 1) throw new Error('URL có nhiều as_instructor. Hãy mở lại workspace từ trang Admin.');
  return Object.freeze({
    essayId: text(essayIds[0]),
    requestedReviewId: nullableText(reviewIds[0]),
    requestedInstructor: nullableText(targets[0]),
  });
}

export function normalizeInstructorGradeEssay(value, expectedEssayId) {
  const row = objectRow(value);
  const id = text(row?.id);
  const expected = text(expectedEssayId);
  const status = text(row?.status);
  const student = objectRow(row?.student);
  if (!row || !id || id !== expected || !ESSAY_STATUSES.has(status) || !student) return null;
  if (typeof row.essay_text !== 'string') return null;

  const studentId = text(student.id);
  if (!studentId) return null;

  let feedback = null;
  if (row.feedback != null) {
    const feedbackRow = objectRow(row.feedback);
    const feedbackJson = objectRow(feedbackRow?.feedback_json);
    const overallBandScore = band(feedbackRow?.overall_band_score);
    if (!feedbackRow || !feedbackJson || overallBandScore == null) return null;
    const version = finite(feedbackRow.version);
    if (version != null && (!Number.isSafeInteger(version) || version < 1)) return null;
    feedback = Object.freeze({
      version,
      overallBandScore,
      feedbackJson: cloneJson(feedbackJson),
    });
  }

  return Object.freeze({
    id,
    status,
    taskType: text(row.task_type) || '—',
    essayText: row.essay_text,
    instructorNote: typeof row.instructor_note === 'string' ? row.instructor_note : '',
    deliveredAt: nullableText(row.delivered_at),
    isFlagged: row.is_flagged === true,
    student: Object.freeze({
      id: studentId,
      fullName: text(student.full_name) || 'Học viên',
      studentCode: nullableText(student.student_code),
      targetBand: student.target_band == null ? null : band(student.target_band),
    }),
    feedback,
  });
}

/**
 * @param {unknown} queueValue
 * @param {unknown} essayId
 * @param {string | null} [requestedReviewId]
 */
export function resolveInstructorGradeReview(queueValue, essayId, requestedReviewId = null) {
  const queue = normalizeInstructorQueue(queueValue);
  if (!queue) return null;
  const expectedEssay = text(essayId);
  const requested = nullableText(requestedReviewId);
  const matches = queue.filter((item) => item.essayId === expectedEssay);
  if (matches.length > 1) return null;
  if (!requested) return Object.freeze({ queue, review: matches[0] || null, mismatch: false });
  const review = queue.find((item) => item.reviewId === requested && item.essayId === expectedEssay) || null;
  return Object.freeze({ queue, review, mismatch: !review });
}

export function instructorNotePayload(note) {
  if (typeof note !== 'string' || note.length > 5000) throw new TypeError('instructor-note-invalid');
  return Object.freeze({ instructor_note: note });
}

export function instructorDeliveryPayload(essayId, note) {
  const id = text(essayId);
  if (!id) throw new TypeError('essay-id-required');
  return Object.freeze({ essay_id: id, ...instructorNotePayload(note) });
}

export function normalizeInstructorNoteAck(value, essayId, note) {
  const row = objectRow(value);
  return Boolean(row
    && text(row.essay_id) === text(essayId)
    && row.instructor_note === note
    && ESSAY_STATUSES.has(text(row.status)));
}

export function normalizeInstructorDeliverAck(value, essayId, reviewId) {
  const row = objectRow(value);
  return Boolean(row
    && text(row.id) === text(reviewId)
    && text(row.essay_id) === text(essayId)
    && text(row.status) === 'delivered');
}

/**
 * @param {unknown} essayId
 * @param {string | null} [asInstructor]
 */
export function instructorGradeCompareHref(essayId, asInstructor = null) {
  const id = text(essayId);
  if (!id) throw new TypeError('essay-id-required');
  const params = new URLSearchParams({ essay_id: id });
  const target = nullableText(asInstructor);
  if (target) params.set('as_instructor', target);
  return `/instructor/compare?${params.toString()}`;
}

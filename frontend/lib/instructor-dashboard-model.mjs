function objectRow(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function nullableText(value) {
  const normalized = text(value);
  return normalized || null;
}

function finite(value, fallback = null) {
  if (typeof value !== 'number' && typeof value !== 'string') return fallback;
  if (typeof value === 'string' && !value.trim()) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function count(value) {
  const number = finite(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function nullableNumberText(value) {
  const number = finite(value);
  return number == null ? null : String(number);
}

function normalizeList(value, mapper) {
  if (!Array.isArray(value)) return null;
  const rows = [];
  for (const item of value) {
    const normalized = mapper(item);
    if (!normalized) return null;
    rows.push(normalized);
  }
  return rows;
}

export function normalizeInstructorProfile(value) {
  const row = objectRow(value);
  const id = text(row?.id);
  const role = text(row?.role);
  if (!id || !role) return null;
  return Object.freeze({ id, role, email: nullableText(row.email) });
}

export function normalizeInstructorCohorts(value) {
  return normalizeList(value, (item) => {
    const row = objectRow(item);
    const id = text(row?.id);
    const name = text(row?.name);
    if (!id || !name) return null;
    return Object.freeze({ id, name, createdAt: nullableText(row.created_at) });
  });
}

export function normalizeInstructorStudents(value) {
  return normalizeList(value, (item) => {
    const row = objectRow(item);
    const id = text(row?.id);
    if (!id) return null;
    return Object.freeze({
      id,
      fullName: text(row.full_name) || 'Học viên',
      studentCode: text(row.student_code) || '—',
      cohortId: nullableText(row.cohort_id),
      userId: nullableText(row.user_id),
    });
  });
}

export function normalizeInstructorPrompts(value) {
  return normalizeList(value, (item) => {
    const row = objectRow(item);
    const id = text(row?.id);
    const title = text(row?.title);
    if (!id || !title) return null;
    return Object.freeze({ id, title, taskType: nullableText(row.task_type) });
  });
}

export function normalizeInstructorCodes(value) {
  return normalizeList(value, (item) => {
    const row = objectRow(item);
    const code = text(row?.code);
    if (!code || typeof row.is_used !== 'boolean') return null;
    return Object.freeze({
      id: nullableText(row.id) || code,
      code,
      isUsed: row.is_used,
      cohortId: nullableText(row.cohort_id),
    });
  });
}

export function normalizeInstructorAssignments(value) {
  return normalizeList(value, (item) => {
    const row = objectRow(item);
    const id = text(row?.id);
    const promptId = text(row?.prompt_id);
    const studentId = text(row?.student_id);
    const status = text(row?.status);
    if (!id || !promptId || !studentId || !status) return null;
    return Object.freeze({
      id,
      promptId,
      studentId,
      status,
      essayId: nullableText(row.essay_id),
      deadline: nullableText(row.deadline),
      cohortId: nullableText(row.cohort_id),
      groupId: nullableText(row.assignment_group_id),
      name: nullableText(row.name),
      createdAt: nullableText(row.created_at),
      isLate: row.is_late === true,
    });
  });
}

function timestamp(value) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

/**
 * W-06 — the most recent canonical give of `promptId` to the same target:
 * a cohort give matches rows stamped with that cohort, a single-student give
 * matches any row of that student. Null when the target has no such give.
 *
 * @param {ReadonlyArray<any>} assignments normalized assignments
 * @param {{ promptId: string, cohortId?: string | null, studentId?: string | null }} target
 */
export function findExistingGive(assignments, { promptId, cohortId = null, studentId = null }) {
  if (!Array.isArray(assignments) || !text(promptId) || (!text(cohortId) && !text(studentId))) return null;
  let latest = null;
  for (const assignment of assignments) {
    if (assignment?.promptId !== promptId) continue;
    const sameTarget = text(cohortId) ? assignment.cohortId === cohortId : assignment.studentId === studentId;
    if (sameTarget && (!latest || timestamp(assignment.createdAt) > timestamp(latest.createdAt))) latest = assignment;
  }
  return latest;
}

// User-facing assignment copy, kept together for Content Manager review.
export const ASSIGNMENT_COPY = Object.freeze({
  cohortSuccess: 'Đã giao bài cho lớp.',
  studentSuccess: 'Đã giao bài cho học viên.',
  confirmCohort: (title, when) => `Lớp này đã được giao đề '${title}' ${when}. Giao thêm một lượt nữa?`,
  confirmStudent: (title, when) => `Học viên này đã được giao đề '${title}' ${when}. Giao thêm một lượt nữa?`,
  duplicatesWarning: (count) => `Đã giao bài cho lớp. Lưu ý: ${count} học viên đã được giao đề này từ trước.`,
  // BL-18: asked before the give, from the same overlap the banner reports.
  confirmCohortOverlap: (title, count) => `${count} học viên trong lớp đã từng được giao đề '${title}'. Giao thêm một lượt cho cả lớp? (Các học viên này sẽ có thêm một lượt.)`,
  // In-app dialog chrome around the confirm messages above (replaces window.confirm).
  confirmTitle: 'Đề đã được giao trước đó',
  confirmCancel: 'Hủy',
  confirmAccept: 'Giao thêm',
  deadline: (when) => `Hạn ${when}`,
});

/**
 * W-12 — how long the dashboard waits for the auth state to settle. A token
 * refresh that never answers (GoTrue down or hanging) otherwise leaves the
 * page on its loading line forever; past this bound it fails closed to
 * /login, the same place a signed-out session goes.
 */
export const AUTH_SETTLE_TIMEOUT_MS = 15_000;

/** BL-18 — `POST /instructor/assignments/duplicates-preview` → { studentCount, duplicateStudentIds } or null. */
export function normalizeDuplicatesPreview(value) {
  const row = objectRow(value);
  const count = row?.student_count;
  const ids = row?.duplicate_student_ids;
  if (!Number.isInteger(count) || count < 0 || !Array.isArray(ids) || !ids.every((id) => text(id))) return null;
  return Object.freeze({ studentCount: count, duplicateStudentIds: Object.freeze([...new Set(ids.map(text))]) });
}

/** BL-18 confirm text, or null when nobody in the class already holds the prompt. */
export function cohortOverlapConfirmMessage(preview, promptTitle) {
  const count = preview?.duplicateStudentIds?.length || 0;
  return count > 0 ? ASSIGNMENT_COPY.confirmCohortOverlap(text(promptTitle) || '(chưa có tiêu đề)', count) : null;
}

/** W-12 — the matrix cell's deadline line ("Hạn dd/mm/yyyy HH:mm", Vietnam time), or null. */
export function matrixDeadlineLabel(assignment) {
  const when = vietnamDateTime(assignment?.deadline);
  return when ? ASSIGNMENT_COPY.deadline(when) : null;
}

/** "dd/mm/yyyy HH:mm" in Vietnam time, or null for a missing/unparseable timestamp. */
function vietnamDateTime(value) {
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return null;
  const day = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(parsed);
  const time = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(parsed);
  return `${day} ${time}`;
}

function formatGiveTime(value) {
  // "lúc dd/mm/yyyy HH:mm", Vietnam time.
  const when = vietnamDateTime(value);
  return when ? `lúc ${when}` : 'trước đó';
}

/**
 * @param {any} existing result of findExistingGive
 * @param {string} promptTitle
 * @param {'cohort' | 'student'} target
 */
export function duplicateGiveConfirmMessage(existing, promptTitle, target) {
  const title = text(promptTitle) || '(chưa có tiêu đề)';
  const when = formatGiveTime(existing?.createdAt);
  return target === 'cohort' ? ASSIGNMENT_COPY.confirmCohort(title, when) : ASSIGNMENT_COPY.confirmStudent(title, when);
}

/** Fan-out success banner: warning tone when the backend reports students who already had the prompt. */
export function fanOutResultBanner(result) {
  const duplicates = objectRow(result)?.duplicates_warning;
  const count = Array.isArray(duplicates) ? duplicates.length : 0;
  return count > 0
    ? Object.freeze({ tone: 'warning', message: ASSIGNMENT_COPY.duplicatesWarning(count) })
    : Object.freeze({ tone: 'success', message: ASSIGNMENT_COPY.cohortSuccess });
}

export function normalizeInstructorQueue(value) {
  return normalizeList(value, (item) => {
    const row = objectRow(item);
    const review = objectRow(row?.review);
    const essayId = text(row?.essay_id);
    const reviewId = text(review?.id);
    const status = text(review?.status);
    if (!essayId || !reviewId || !status) return null;
    return Object.freeze({
      essayId,
      reviewId,
      status,
      studentEmail: nullableText(row.student_email),
      taskType: nullableText(row.task_type),
      submittedAt: nullableText(row.submitted_at),
    });
  });
}

/**
 * PC-J36 — the "Chấm bài" row's second line: short essay id + submit time
 * ("ad8db313 · 28/10/2026 14:05", Vietnam time), so two essays from the same
 * student are distinguishable. Data only — no extra label.
 */
export function queueRowIdentity(item) {
  const shortId = text(item?.essayId).slice(0, 8);
  const when = vietnamDateTime(item?.submittedAt);
  return [shortId, when].filter(Boolean).join(' · ');
}

export function normalizeInstructorSummary(value) {
  const row = objectRow(value);
  const student = objectRow(row?.student);
  const stats = objectRow(row?.stats);
  const id = text(student?.id);
  if (!id || !stats || !Array.isArray(row?.recent_essays)) return null;
  const recentEssays = normalizeList(row.recent_essays, (item) => {
    const essay = objectRow(item);
    const essayId = text(essay?.id);
    if (!essay || !essayId) return null;
    return Object.freeze({
      id: essayId,
      taskType: text(essay.task_type) || '—',
      status: text(essay.status) || '—',
    });
  });
  if (!recentEssays) return null;
  const totalEssays = count(stats.total_essays);
  const gradedCount = count(stats.graded_count);
  const flaggedCount = count(stats.flagged_count);
  const average = stats.average_band_last5 == null ? null : finite(stats.average_band_last5);
  if ([totalEssays, gradedCount, flaggedCount].some((value) => value == null)
      || (average != null && (average < 0 || average > 9))) return null;
  return Object.freeze({
    student: Object.freeze({
      id,
      fullName: text(student.full_name) || 'Học viên',
      studentCode: text(student.student_code),
      targetBand: nullableNumberText(student.target_band),
    }),
    stats: Object.freeze({
      totalEssays,
      gradedCount,
      flaggedCount,
      averageBandLast5: average,
    }),
    recentEssays: Object.freeze(recentEssays),
  });
}

/**
 * @param {string} path
 * @param {string | null} [asInstructor]
 */
export function instructorApiPath(path, asInstructor = null) {
  if (typeof path !== 'string' || (path !== '/instructor' && !path.startsWith('/instructor/'))) {
    throw new TypeError('instructor-api-path-required');
  }
  const target = nullableText(asInstructor);
  if (!target) return path;
  const url = new URL(path, 'https://aver.invalid');
  if (url.origin !== 'https://aver.invalid') throw new TypeError('instructor-api-path-required');
  url.searchParams.set('as_instructor', target);
  return `${url.pathname}${url.search}`;
}

/**
 * @param {unknown} essayId
 * @param {unknown} reviewId
 * @param {string | null} [asInstructor]
 */
export function instructorGradeHref(essayId, reviewId, asInstructor = null) {
  const params = new URLSearchParams({
    essay_id: text(essayId),
    review_id: text(reviewId),
  });
  const target = nullableText(asInstructor);
  if (target) params.set('as_instructor', target);
  return `/instructor/grade?${params.toString()}`;
}

export function assignmentTone(assignment, now = Date.now()) {
  if (!assignment) return Object.freeze({ label: '—', tone: 'muted' });
  // A-S3 — `isLate` is the backend's shared rule (handed in after `deadline`).
  if (assignment.status === 'delivered') {
    return Object.freeze(assignment.isLate
      ? { label: 'Đã trả · nộp trễ', tone: 'success' } : { label: 'Đã trả', tone: 'success' });
  }
  if (assignment.essayId || ['submitted', 'grading', 'graded', 'reviewed'].includes(assignment.status)) {
    return Object.freeze(assignment.isLate
      ? { label: 'Nộp trễ', tone: 'warning' } : { label: 'Đã nộp', tone: 'success' });
  }
  const deadline = assignment.deadline ? Date.parse(assignment.deadline) : Number.NaN;
  if (Number.isFinite(deadline) && deadline < now) return Object.freeze({ label: 'Trễ', tone: 'danger' });
  return Object.freeze({ label: 'Chưa nộp', tone: 'neutral' });
}

export function buildInstructorMatrix(students, prompts, assignments) {
  const promptById = new Map(prompts.map((prompt) => [prompt.id, prompt]));
  const columnIds = [];
  const seen = new Set();
  const byCell = new Map();
  for (const assignment of assignments) {
    if (!seen.has(assignment.promptId)) {
      seen.add(assignment.promptId);
      columnIds.push(assignment.promptId);
    }
    const key = `${assignment.studentId}\u0000${assignment.promptId}`;
    const current = byCell.get(key);
    // A-07: the newest give wins by created_at (names may repeat or be empty);
    // ties and missing dates keep the first-seen row (API order is created_at desc).
    if (!current || timestamp(assignment.createdAt) > timestamp(current.createdAt)) byCell.set(key, assignment);
  }
  return Object.freeze({
    columns: Object.freeze(columnIds.map((id) => Object.freeze({
      id,
      title: promptById.get(id)?.title || 'Đề bài',
    }))),
    rows: Object.freeze(students.map((student) => Object.freeze({
      student,
      cells: Object.freeze(columnIds.map((promptId) => byCell.get(`${student.id}\u0000${promptId}`) || null)),
    }))),
  });
}

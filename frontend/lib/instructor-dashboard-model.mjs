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
    });
  });
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
    });
  });
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
      targetBand: nullableText(student.target_band),
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
  return `/pages/instructor/grade.html?${params.toString()}`;
}

export function assignmentTone(assignment, now = Date.now()) {
  if (!assignment) return Object.freeze({ label: '—', tone: 'muted' });
  if (assignment.status === 'delivered') return Object.freeze({ label: 'Đã trả', tone: 'success' });
  if (assignment.essayId || ['submitted', 'grading', 'graded', 'reviewed'].includes(assignment.status)) {
    return Object.freeze({ label: 'Đã nộp', tone: 'success' });
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
    byCell.set(`${assignment.studentId}\u0000${assignment.promptId}`, assignment);
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

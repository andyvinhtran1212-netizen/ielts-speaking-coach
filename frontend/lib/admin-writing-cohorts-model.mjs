const STATUSES = new Set([
  'not_submitted', 'pending', 'submitted', 'grading', 'graded',
  'reviewed', 'delivered', 'failed', 'flagged',
]);
const FILTERS = new Set(['all', 'needs_grade', 'needs_review', 'delivered', 'overdue', 'issues']);
const ACTIVITIES = new Set(['all', 'active', 'idle']);
const objectOf = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const textOf = (value) => typeof value === 'string' ? value.trim() : '';
const optionalText = (value) => textOf(value) || null;
const integerOf = (value) => Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const dateOf = (value) => {
  const text = optionalText(value);
  return text && !Number.isNaN(Date.parse(text)) ? text : null;
};

function cohortOf(raw) {
  const row = objectOf(raw);
  const id = textOf(row?.id); const name = textOf(row?.name);
  const studentCount = integerOf(row?.student_count); const activeAssignments = integerOf(row?.active_assignments);
  const essaysPending = integerOf(row?.essays_pending); const essaysDelivered = integerOf(row?.essays_delivered);
  if (!id || !name || [studentCount, activeAssignments, essaysPending, essaysDelivered].some((value) => value == null)) return null;
  return { id, name, description: optionalText(row?.description), studentCount, activeAssignments, essaysPending, essaysDelivered };
}

export function normalizeCohortList(raw) {
  const payload = objectOf(raw);
  if (!payload || !Array.isArray(payload.cohorts)) return null;
  const seen = new Set();
  const rows = payload.cohorts.map(cohortOf).filter((row) => row && !seen.has(row.id) && seen.add(row.id));
  return { rows, malformedCount: payload.cohorts.length - rows.length };
}

function studentOf(raw) {
  const row = objectOf(raw); const id = textOf(row?.id);
  if (!id) return null;
  return { id, name: optionalText(row?.full_name), code: optionalText(row?.student_code) };
}

function columnOf(raw) {
  const row = objectOf(raw); const id = textOf(row?.id); const promptId = textOf(row?.prompt_id); const title = textOf(row?.title);
  if (!id || !promptId || !title) return null;
  return { id, promptId, groupId: optionalText(row?.group_id), name: optionalText(row?.name), title, taskType: optionalText(row?.task_type), assignedAt: dateOf(row?.assigned_at) };
}

function cellOf(raw) {
  const row = objectOf(raw); const assignmentId = textOf(row?.assignment_id); const status = textOf(row?.status);
  if (!assignmentId || !STATUSES.has(status)) return null;
  const band = row?.band == null ? null : Number(row.band);
  if (band != null && (!Number.isFinite(band) || band < 0 || band > 9)) return null;
  return { assignmentId, status, essayId: optionalText(row?.essay_id), deadline: dateOf(row?.deadline), updatedAt: dateOf(row?.updated_at), band };
}

export function normalizeCohortDetail(raw) {
  const payload = objectOf(raw); const cohort = objectOf(payload?.cohort); const matrixRaw = objectOf(payload?.matrix); const stats = objectOf(payload?.stats);
  if (!payload || !cohort || !matrixRaw || !stats || !Array.isArray(payload.students) || !Array.isArray(payload.assignments)) return null;
  const cohortId = textOf(cohort.id); const cohortName = textOf(cohort.name);
  const studentCount = integerOf(cohort.student_count);
  if (!cohortId || !cohortName || studentCount == null) return null;
  const studentSeen = new Set(); const columnSeen = new Set();
  const students = payload.students.map(studentOf).filter((row) => row && !studentSeen.has(row.id) && studentSeen.add(row.id));
  const columns = payload.assignments.map(columnOf).filter((row) => row && !columnSeen.has(row.id) && columnSeen.add(row.id));
  let malformedCount = (payload.students.length - students.length) + (payload.assignments.length - columns.length);
  const matrix = {};
  for (const student of students) {
    matrix[student.id] = {};
    const source = objectOf(matrixRaw[student.id]) || {};
    for (const column of columns) {
      if (!(column.id in source)) continue;
      const cell = cellOf(source[column.id]);
      if (cell) matrix[student.id][column.id] = cell; else malformedCount += 1;
    }
  }
  const normalizedStats = {
    students: integerOf(stats.students), assignments: integerOf(stats.assignments),
    essaysPending: integerOf(stats.essays_pending), essaysDelivered: integerOf(stats.essays_delivered), overdue: integerOf(stats.overdue),
  };
  if (Object.values(normalizedStats).some((value) => value == null)) return null;
  return { cohort: { id: cohortId, name: cohortName, description: optionalText(cohort.description), studentCount }, students, columns, matrix, stats: normalizedStats, malformedCount };
}

export function cohortFilters(raw = {}) {
  const status = textOf(raw.status); const activity = textOf(raw.activity);
  return { cohort: textOf(raw.cohort), status: FILTERS.has(status) ? status : 'all', activity: ACTIVITIES.has(activity) ? activity : 'all', q: textOf(raw.q).slice(0, 100) };
}

export function cohortHref(raw) {
  const filters = cohortFilters(raw); const params = new URLSearchParams();
  if (filters.cohort) params.set('cohort', filters.cohort);
  if (filters.status !== 'all') params.set('status', filters.status);
  if (filters.activity !== 'all') params.set('activity', filters.activity);
  if (filters.q) params.set('q', filters.q);
  const query = params.toString(); return `/admin/writing/cohorts${query ? `?${query}` : ''}`;
}

export function cohortMatches(row, filters) {
  const normalized = cohortFilters(filters);
  if (normalized.activity === 'active' && row.activeAssignments === 0) return false;
  if (normalized.activity === 'idle' && row.activeAssignments !== 0) return false;
  const needle = normalized.q.toLocaleLowerCase('vi');
  return !needle || [row.name, row.description].filter(Boolean).join(' ').toLocaleLowerCase('vi').includes(needle);
}

export function isOverdue(cell, now = Date.now()) {
  return Boolean(cell?.deadline && !['delivered', 'flagged'].includes(cell.status) && Date.parse(cell.deadline) < now);
}

export function cellMatchesFilter(cell, filter, now = Date.now()) {
  if (!cell) return filter === 'all';
  if (filter === 'all') return true;
  if (filter === 'needs_grade') return ['pending', 'submitted', 'grading'].includes(cell.status);
  if (filter === 'needs_review') return ['graded', 'reviewed'].includes(cell.status);
  if (filter === 'delivered') return cell.status === 'delivered';
  if (filter === 'overdue') return isOverdue(cell, now);
  if (filter === 'issues') return ['failed', 'flagged'].includes(cell.status);
  return true;
}

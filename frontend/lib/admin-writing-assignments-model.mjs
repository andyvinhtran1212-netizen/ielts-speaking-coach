const STATUSES = new Set(['pending', 'in_progress', 'submitted', 'graded', 'delivered']);
const TASK_TYPES = new Set(['task1_academic', 'task1_general', 'task2']);
const objectOf = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const textOf = (value) => typeof value === 'string' ? value.trim() : '';
const optionalText = (value) => textOf(value) || null;
const dateOf = (value) => {
  const text = optionalText(value);
  return text && !Number.isNaN(Date.parse(text)) ? text : null;
};

export function normalizeAssignment(raw) {
  const row = objectOf(raw);
  if (!row) return null;
  const id = textOf(row.id);
  const promptId = textOf(row.prompt_id);
  const studentId = textOf(row.student_id);
  const status = textOf(row.status);
  if (!id || !promptId || !studentId || !STATUSES.has(status)) return null;
  const promptRaw = Array.isArray(row.writing_prompts) ? row.writing_prompts[0] : row.writing_prompts;
  const studentRaw = Array.isArray(row.students) ? row.students[0] : row.students;
  const prompt = objectOf(promptRaw);
  const student = objectOf(studentRaw);
  const taskType = optionalText(prompt?.task_type);
  if (taskType && !TASK_TYPES.has(taskType)) return null;
  const minutes = row.time_limit_minutes == null ? null : Number(row.time_limit_minutes);
  if (minutes != null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 180)) return null;
  if (Boolean(row.is_timed) !== (minutes != null)) return null;
  return {
    id, promptId, studentId, status,
    groupId: optionalText(row.assignment_group_id),
    name: optionalText(row.name),
    deadline: dateOf(row.deadline),
    instructions: optionalText(row.instructions),
    createdAt: dateOf(row.created_at),
    submittedAt: dateOf(row.submitted_at),
    gradedAt: dateOf(row.graded_at),
    deliveredAt: dateOf(row.delivered_at),
    essayId: optionalText(row.essay_id),
    allowSoftCheck: Boolean(row.allow_soft_check),
    isTimed: Boolean(row.is_timed),
    timeLimitMinutes: minutes,
    autoSubmitted: Boolean(row.auto_submitted),
    promptTitle: optionalText(prompt?.title),
    taskType,
    difficulty: optionalText(prompt?.difficulty),
    studentName: optionalText(student?.full_name),
    studentCode: optionalText(student?.student_code),
  };
}

export function normalizeAssignmentList(raw) {
  const payload = objectOf(raw);
  if (!payload || !Array.isArray(payload.assignments) || typeof payload.capped !== 'boolean') return null;
  const seen = new Set();
  const rows = payload.assignments.map(normalizeAssignment).filter((row) => row && !seen.has(row.id) && seen.add(row.id));
  return { rows, capped: payload.capped, malformedCount: payload.assignments.length - rows.length };
}

export function normalizePromptOptions(raw) {
  const payload = objectOf(raw);
  if (!payload || !Array.isArray(payload.prompts)) return null;
  const rows = payload.prompts.map((item) => {
    const row = objectOf(item); const id = textOf(row?.id); const title = textOf(row?.title); const taskType = textOf(row?.task_type);
    return id && title && TASK_TYPES.has(taskType) ? { id, title, taskType, difficulty: optionalText(row?.difficulty) } : null;
  }).filter(Boolean);
  return { rows, malformedCount: payload.prompts.length - rows.length, capped: payload.prompts.length >= 500 };
}

export function normalizeStudentOptions(raw) {
  if (!Array.isArray(raw)) return null;
  const rows = raw.map((item) => {
    const row = objectOf(item); const id = textOf(row?.id);
    return id ? { id, name: optionalText(row?.full_name), code: optionalText(row?.student_code), cohortId: optionalText(row?.cohort_id) } : null;
  }).filter(Boolean);
  return { rows, malformedCount: raw.length - rows.length };
}

export function normalizeCohortOptions(raw) {
  const payload = objectOf(raw);
  if (!payload || !Array.isArray(payload.cohorts)) return null;
  const rows = payload.cohorts.map((item) => {
    const row = objectOf(item); const id = textOf(row?.id); const name = textOf(row?.name); const studentCount = Number(row?.student_count);
    return id && name && Number.isInteger(studentCount) && studentCount >= 0 ? { id, name, studentCount } : null;
  }).filter(Boolean);
  return { rows, malformedCount: payload.cohorts.length - rows.length };
}

export function assignmentFilters(raw = {}) {
  const status = STATUSES.has(textOf(raw.status)) ? textOf(raw.status) : 'all';
  return { status, cohort: textOf(raw.cohort), q: textOf(raw.q).slice(0, 120) };
}

export function assignmentHref(filters) {
  const normalized = assignmentFilters(filters); const params = new URLSearchParams();
  if (normalized.status !== 'all') params.set('status', normalized.status);
  if (normalized.cohort) params.set('cohort', normalized.cohort);
  if (normalized.q) params.set('q', normalized.q);
  const query = params.toString(); return `/admin/writing/assignments${query ? `?${query}` : ''}`;
}

export function assignmentMatches(row, query) {
  const needle = textOf(query).toLocaleLowerCase('vi');
  if (!needle) return true;
  return [row.name, row.promptTitle, row.studentName, row.studentCode].filter(Boolean).join(' ').toLocaleLowerCase('vi').includes(needle);
}

export function groupAssignments(rows) {
  const groups = []; const byKey = new Map();
  for (const row of rows || []) {
    const key = row.groupId ? `group:${row.groupId}` : `single:${row.id}`;
    if (!byKey.has(key)) { const group = { key, groupId: row.groupId, name: row.name, createdAt: row.createdAt, rows: [] }; byKey.set(key, group); groups.push(group); }
    byKey.get(key).rows.push(row);
  }
  return groups;
}

export function validateAssignmentDraft(draft, promptCount, studentCount, cohortStudentCount) {
  if (!Number.isInteger(promptCount) || promptCount < 1) return { ok: false, error: 'Chọn ít nhất một đề Writing.' };
  if (promptCount > 20) return { ok: false, error: 'Mỗi lần chỉ được giao tối đa 20 đề.' };
  if (draft.mode === 'cohort') {
    if (!textOf(draft.cohortId)) return { ok: false, error: 'Chọn một lớp để tiếp tục.' };
    if (!Number.isInteger(cohortStudentCount) || cohortStudentCount < 1) return { ok: false, error: 'Lớp này chưa có học viên; không thể giao bài.' };
  } else {
    if (!Number.isInteger(studentCount) || studentCount < 1) return { ok: false, error: 'Chọn ít nhất một học viên.' };
    if (studentCount > 100) return { ok: false, error: 'Mỗi lần chỉ được giao tối đa 100 học viên.' };
  }
  const minutes = draft.isTimed ? Number(draft.timeLimitMinutes) : null;
  if (draft.isTimed && (!Number.isInteger(minutes) || minutes < 1 || minutes > 180)) return { ok: false, error: 'Thời gian IELTS-mode phải từ 1 đến 180 phút.' };
  const deadline = textOf(draft.deadline);
  if (deadline && Number.isNaN(new Date(deadline).getTime())) return { ok: false, error: 'Hạn nộp không hợp lệ.' };
  return { ok: true, expectedCount: promptCount * (draft.mode === 'cohort' ? cohortStudentCount : studentCount), timeLimitMinutes: minutes, deadline: deadline ? new Date(deadline).toISOString() : null };
}

export function normalizeCreateReceipt(raw, expectedCount, requestId = '') {
  const payload = objectOf(raw); const count = Number(payload?.count); const groupId = textOf(payload?.group_id);
  if (!payload || !Number.isInteger(count) || count !== expectedCount || !groupId || !Array.isArray(payload.created) || payload.created.length !== count || !Array.isArray(payload.duplicates_warning)) return null;
  const ids = payload.created.map((item) => textOf(objectOf(item)?.id));
  if (ids.some((id) => !id) || new Set(ids).size !== count) return null;
  return { requestId: optionalText(requestId), firstId: ids[0], groupId, createdCount: count, duplicateStudentIds: payload.duplicates_warning.map(textOf).filter(Boolean) };
}

export function normalizeFanoutReceipt(raw, expectedStudents, expectedCount, requestId = '') {
  const payload = objectOf(raw); const students = Number(payload?.student_count); const count = Number(payload?.created_count); const groupId = textOf(payload?.group_id);
  if (!payload || students !== expectedStudents || count !== expectedCount || !groupId || !Array.isArray(payload.assignment_ids) || payload.assignment_ids.length !== count || !Array.isArray(payload.duplicates_warning)) return null;
  const ids = payload.assignment_ids.map(textOf);
  if (ids.some((id) => !id) || new Set(ids).size !== count) return null;
  return { requestId: optionalText(requestId), firstId: ids[0], groupId, createdCount: count, duplicateStudentIds: payload.duplicates_warning.map(textOf).filter(Boolean) };
}

export function receiptMatchesDetail(raw, receipt) {
  const row = normalizeAssignment(raw);
  return row && row.id === receipt?.firstId && row.groupId === receipt?.groupId && row.status === 'pending' ? row : null;
}

export function normalizeStoredAssignmentReceipt(raw) {
  const value = objectOf(raw); const firstId = textOf(value?.firstId); const groupId = textOf(value?.groupId); const createdCount = Number(value?.createdCount);
  if (!firstId || !groupId || !Number.isInteger(createdCount) || createdCount < 1 || !Array.isArray(value?.duplicateStudentIds)) return null;
  return { requestId: optionalText(value.requestId), firstId, groupId, createdCount, duplicateStudentIds: value.duplicateStudentIds.map(textOf).filter(Boolean) };
}

export function normalizeStoredAssignmentRequest(raw) {
  const value = objectOf(raw); const requestId = textOf(value?.requestId); const path = textOf(value?.path); const body = objectOf(value?.body); const mode = textOf(value?.mode); const expectedStudents = Number(value?.expectedStudents); const expectedCount = Number(value?.expectedCount);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) return null;
  if (body?.request_id !== requestId || !['individual', 'cohort'].includes(mode)) return null;
  if ((mode === 'individual' && path !== '/admin/writing/assignments') || (mode === 'cohort' && path !== '/admin/writing/assignments/fan-out')) return null;
  if (!Number.isInteger(expectedStudents) || expectedStudents < 1 || expectedStudents > 10000 || !Number.isInteger(expectedCount) || expectedCount < 1 || expectedCount > 200000) return null;
  if (!Array.isArray(body.prompt_ids) || body.prompt_ids.length < 1 || body.prompt_ids.length > 20) return null;
  if (mode === 'individual' && (!Array.isArray(body.student_ids) || body.student_ids.length !== expectedStudents || expectedStudents > 100)) return null;
  if (mode === 'cohort' && !textOf(body.cohort_id)) return null;
  return { requestId, path, body, mode, expectedStudents, expectedCount };
}

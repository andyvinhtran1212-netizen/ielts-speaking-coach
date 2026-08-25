function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function text(value) {
  return typeof value === 'string' ? value : '';
}

function nullableText(value) {
  const normalized = text(value).trim();
  return normalized || null;
}

function nullableCount(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function normalizeCourse(value) {
  const row = object(value);
  const id = text(row.id);
  if (!id) return null;
  return {
    id,
    code: text(row.code),
    name: text(row.name) || 'Khoá chưa đặt tên',
    is_active: row.is_active !== false,
    sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : 0,
  };
}

export function normalizeCoursesPayload(value) {
  const rows = Array.isArray(value) ? value : object(value).courses;
  return (Array.isArray(rows) ? rows : []).map(normalizeCourse).filter(Boolean);
}

export function normalizeCohort(value) {
  const row = object(value);
  const id = text(row.id);
  if (!id) return null;
  return {
    id,
    name: text(row.name) || 'Lớp chưa đặt tên',
    code_prefix: nullableText(row.code_prefix),
    description: nullableText(row.description),
    course_id: nullableText(row.course_id),
    course: normalizeCourse(row.course),
    member_count: nullableCount(row.member_count),
    unactivated_count: nullableCount(row.unactivated_count),
    is_active: row.is_active !== false,
    created_at: nullableText(row.created_at),
    updated_at: nullableText(row.updated_at),
  };
}

export function normalizeCohortsPayload(value) {
  const payload = object(value);
  const rows = Array.isArray(value) ? value : payload.cohorts;
  return {
    cohorts: (Array.isArray(rows) ? rows : []).map(normalizeCohort).filter(Boolean),
    rollup_failed: Boolean(payload.rollup_failed),
    course_lookup_failed: Boolean(payload.course_lookup_failed),
  };
}

export function foldVietnamese(value) {
  return text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLocaleLowerCase('vi');
}

export function selectCohorts(cohorts, filters = {}) {
  const status = text(filters.status) || 'all';
  const courseId = text(filters.courseId);
  const search = foldVietnamese(text(filters.search).trim());
  return (Array.isArray(cohorts) ? cohorts : []).filter((cohort) => {
    if (status === 'active' && !cohort.is_active) return false;
    if (status === 'archived' && cohort.is_active) return false;
    if (courseId && cohort.course_id !== courseId) return false;
    if (!search) return true;
    return foldVietnamese(`${cohort.name || ''} ${cohort.code_prefix || ''}`).includes(search);
  });
}

export function cohortSummary(cohorts, rollupFailed = false) {
  const rows = Array.isArray(cohorts) ? cohorts : [];
  const active = rows.filter((cohort) => cohort.is_active);
  const membersKnown = !rollupFailed
    && active.every((cohort) => cohort.member_count != null);
  const unactivatedKnown = !rollupFailed
    && active.every((cohort) => cohort.unactivated_count != null);
  return {
    active: active.length,
    total: rows.length,
    students: membersKnown
      ? active.reduce((sum, cohort) => sum + cohort.member_count, 0)
      : null,
    unactivated: unactivatedKnown
      ? active.reduce((sum, cohort) => sum + cohort.unactivated_count, 0)
      : null,
  };
}

export function courseOptionLabel(course) {
  const prefix = course.code ? `${course.code} — ` : '';
  return `${prefix}${course.name}${course.is_active ? '' : ' (đã lưu trữ)'}`;
}

/** @param {Record<string, any> | null} [cohort] */
export function cohortDraft(cohort = null) {
  return {
    id: cohort?.id || null,
    name: cohort?.name || '',
    codePrefix: cohort?.code_prefix || '',
    description: cohort?.description || '',
    courseId: cohort?.course_id || '',
    error: '',
  };
}

export function validateCohortDraft(draft) {
  const name = text(draft?.name).trim();
  const codePrefix = text(draft?.codePrefix).trim();
  const description = text(draft?.description).trim();
  const courseId = text(draft?.courseId).trim();
  if (!name) return { ok: false, error: 'Nhập tên lớp để tiếp tục.' };
  if (name.length > 200) return { ok: false, error: 'Tên lớp không được vượt quá 200 ký tự.' };
  if (codePrefix.length > 20) return { ok: false, error: 'Tiền tố mã không được vượt quá 20 ký tự.' };
  return {
    ok: true,
    body: {
      name,
      course_id: courseId || null,
      code_prefix: codePrefix || null,
      description: description || null,
    },
  };
}

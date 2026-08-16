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

function nullableNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeStudent(value) {
  const row = object(value);
  const id = text(row.id);
  if (!id) return null;
  return {
    ...row,
    id,
    student_code: text(row.student_code) || 'Chưa có mã',
    full_name: text(row.full_name) || 'Học viên chưa đặt tên',
    user_id: nullableText(row.user_id),
    cohort_id: nullableText(row.cohort_id),
    cohort_name: nullableText(row.cohort_name),
    cohort_lookup_failed: Boolean(row.cohort_lookup_failed),
    target_band: nullableNumber(row.target_band),
    current_band_estimate: nullableNumber(row.current_band_estimate),
    target_date: nullableText(row.target_date),
    persona_notes: nullableText(row.persona_notes),
  };
}

export function normalizeStudentsPayload(value) {
  return (Array.isArray(value) ? value : []).map(normalizeStudent).filter(Boolean);
}

export function normalizeCohortPicker(value) {
  const payload = object(value);
  return (Array.isArray(payload.cohorts) ? payload.cohorts : [])
    .map((item) => {
      const row = object(item);
      const id = text(row.id);
      return id ? { id, name: text(row.name) || 'Lớp chưa đặt tên', is_active: row.is_active !== false } : null;
    })
    .filter(Boolean);
}

export function mergeStudentDetail(detail, fallback) {
  if (!detail) return null;
  if (!fallback || detail.cohort_id !== fallback.cohort_id || detail.cohort_name) return detail;
  return {
    ...detail,
    cohort_name: fallback.cohort_name || null,
    cohort_lookup_failed: Boolean(fallback.cohort_lookup_failed),
  };
}

export function studentSummary(students, now = new Date()) {
  const rows = Array.isArray(students) ? students : [];
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const end = new Date(today);
  end.setDate(end.getDate() + 90);
  return {
    total: rows.length,
    unassigned: rows.filter((row) => !row.cohort_id).length,
    upcoming: rows.filter((row) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.target_date || '')) return false;
      const date = new Date(`${row.target_date}T00:00:00`);
      return !Number.isNaN(date.getTime()) && date >= today && date <= end;
    }).length,
  };
}

export function cohortTruth(student) {
  if (!student?.cohort_id) return { kind: 'unassigned', label: 'Chưa xếp lớp' };
  if (student.cohort_name) return { kind: 'assigned', label: student.cohort_name };
  return student.cohort_lookup_failed
    ? { kind: 'unknown', label: 'Không đọc được tên lớp' }
    : { kind: 'missing', label: 'Lớp không còn trong danh mục' };
}

/** @param {Record<string, any> | null} [student] */
export function studentDraft(student = null) {
  return {
    id: student?.id || null,
    studentCode: student?.student_code || '',
    fullName: student?.full_name || '',
    targetBand: student?.target_band == null ? '' : String(student.target_band),
    currentBand: student?.current_band_estimate == null ? '' : String(student.current_band_estimate),
    targetDate: student?.target_date || '',
    notes: student?.persona_notes || '',
    error: '',
  };
}

export function validateStudentDraft(draft) {
  const studentCode = text(draft?.studentCode).trim();
  const fullName = text(draft?.fullName).trim();
  if (!studentCode) return { ok: false, error: 'Nhập mã học viên để tiếp tục.' };
  if (!fullName) return { ok: false, error: 'Nhập họ tên học viên để tiếp tục.' };
  const parseBand = (raw, label) => {
    if (text(raw).trim() === '') return { value: null };
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 && value <= 9
      ? { value }
      : { error: `${label} phải nằm trong khoảng 0–9.` };
  };
  const target = parseBand(draft.targetBand, 'Band mục tiêu');
  if (target.error) return { ok: false, error: target.error };
  const current = parseBand(draft.currentBand, 'Band hiện tại');
  if (current.error) return { ok: false, error: current.error };
  return {
    ok: true,
    body: {
      student_code: studentCode,
      full_name: fullName,
      target_band: target.value,
      current_band_estimate: current.value,
      target_date: nullableText(draft.targetDate),
      persona_notes: nullableText(draft.notes),
    },
  };
}

export function formatBandGoal(student) {
  if (student.current_band_estimate == null && student.target_band == null) return 'Chưa đặt';
  return `${student.current_band_estimate ?? '?'} → ${student.target_band ?? '?'}`;
}

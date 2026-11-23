function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function count(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function cost(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function normalizeInstructor(value) {
  if (!value || typeof value !== 'object') return null;
  const instructorId = text(value.instructor_id);
  const students = count(value.students);
  const prompts = count(value.prompts);
  const graded = count(value.graded);
  const regraded = count(value.regraded);
  const regradeEvents = count(value.regrade_events);
  const tokens = count(value.tokens);
  const costUsd = cost(value.cost_usd);
  if (!instructorId
      || [students, prompts, graded, regraded, regradeEvents, tokens, costUsd].some((item) => item == null)
      || regraded > regradeEvents) return null;
  return {
    instructorId,
    email: text(value.email),
    displayName: text(value.display_name),
    students,
    prompts,
    graded,
    regraded,
    regradeEvents,
    tokens,
    costUsd,
  };
}

export function normalizeInstructorsPayload(value) {
  if (!Array.isArray(value)) return null;
  const rows = [];
  const seen = new Set();
  let malformedCount = 0;
  for (const raw of value) {
    const row = normalizeInstructorProfile(raw);
    if (!row || seen.has(row.instructorId)) {
      malformedCount += 1;
      continue;
    }
    seen.add(row.instructorId);
    rows.push(row);
  }
  return { rows, malformedCount };
}

export function instructorLabel(row) {
  return row?.displayName || row?.email || row?.instructorId || 'Không rõ giảng viên';
}

export function filterInstructors(rows, query) {
  const needle = text(query)?.toLocaleLowerCase('vi-VN');
  if (!needle) return rows || [];
  return (rows || []).filter((row) => [row.displayName, row.email, row.instructorId]
    .some((value) => value?.toLocaleLowerCase('vi-VN').includes(needle)));
}

export function summarizeInstructors(rows) {
  return (rows || []).reduce((summary, row) => ({
    instructors: summary.instructors + 1,
    students: summary.students + row.students,
    graded: summary.graded + row.graded,
    costUsd: summary.costUsd + row.costUsd,
  }), { instructors: 0, students: 0, graded: 0, costUsd: 0 });
}

export function formatInstructorCount(value) {
  const number = count(value);
  return number == null ? '—' : number.toLocaleString('vi-VN');
}

export function formatInstructorCost(value) {
  const number = cost(value);
  return number == null ? '—' : `$${number.toFixed(4)}`;
}

export function instructorWorkspaceHref(instructorId) {
  const id = text(instructorId);
  return id ? `/instructor?as_instructor=${encodeURIComponent(id)}` : null;
}

// ── ADMINIA-0074 FR-106 (G09-T40): teacher table and profile ──────────────
// The backend sends null for a number it could not read; the page writes
// "chưa có", never 0. Missing fields (an older backend) read the same way.

function hours(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function normalizeTeacherClass(value) {
  if (!value || typeof value !== 'object') return null;
  const id = text(value.id);
  if (!id) return null;
  return {
    id,
    name: text(value.name) || id,
    writingPending: count(value.writing_pending),
    writingOverdue: count(value.writing_overdue),
    speakingMockPending: count(value.speaking_mock_pending),
  };
}

/** Teacher fields of one /admin/instructors row (all nullable). */
export function normalizeTeacherOverview(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const classes = Array.isArray(raw.classes)
    ? raw.classes.map(normalizeTeacherClass).filter(Boolean)
    : null;
  return {
    classes,
    writingPending: count(raw.writing_pending),
    writingOverdue: count(raw.writing_overdue),
    delivered30d: count(raw.delivered_30d),
    inProgress: count(raw.in_progress),
    avgReviewHours: hours(raw.avg_review_hours),
  };
}

export function normalizeInstructorProfile(value) {
  const base = normalizeInstructor(value);
  return base ? { ...base, ...normalizeTeacherOverview(value) } : null;
}

export const TEACHER_SORT_KEYS = ['name', 'classes', 'pending', 'speed'];

export function parseTeacherSort(search) {
  const params = new URLSearchParams(search || '');
  const key = TEACHER_SORT_KEYS.includes(params.get('sort')) ? params.get('sort') : 'name';
  const dir = params.get('dir') === 'desc' ? 'desc' : 'asc';
  return { key, dir };
}

function sortValue(row, key) {
  if (key === 'classes') return row.classes ? row.classes.length : null;
  if (key === 'pending') return row.writingPending;
  if (key === 'speed') return row.avgReviewHours;
  return instructorLabel(row).toLocaleLowerCase('vi-VN');
}

/** Sorted copy; an unknown value ("chưa có") always goes last. */
export function sortTeachers(rows, { key = 'name', dir = 'asc' } = {}) {
  const sign = dir === 'desc' ? -1 : 1;
  return [...(rows || [])].sort((a, b) => {
    const left = sortValue(a, key);
    const right = sortValue(b, key);
    if (left == null && right == null) return instructorLabel(a).localeCompare(instructorLabel(b), 'vi');
    if (left == null) return 1;
    if (right == null) return -1;
    const order = typeof left === 'string' ? left.localeCompare(right, 'vi') : left - right;
    return order ? order * sign : instructorLabel(a).localeCompare(instructorLabel(b), 'vi');
  });
}

export function nextTeacherSort(current, key) {
  if (current.key !== key) return { key, dir: key === 'name' ? 'asc' : 'desc' };
  return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
}

export function formatMaybeCount(value) {
  return value == null ? 'chưa có' : Number(value).toLocaleString('vi-VN');
}

/** "Duyệt trung bình": blank below the backend's minimum of reviews. */
export function formatReviewHours(value) {
  if (value == null) return '';
  if (value < 1) return 'dưới 1 giờ';
  if (value < 48) return `${value.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} giờ`;
  return `${(value / 24).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} ngày`;
}

export function instructorProfileHref(instructorId) {
  const id = text(instructorId);
  return id ? `/admin/instructors/${encodeURIComponent(id)}` : null;
}

/** Body of the "Gỡ khỏi lớp" confirm (FR-106): what moves to the admin queue. */
export function removeTeacherSummary(cls) {
  const writing = cls?.writingPending == null
    ? 'Chưa đếm được số bài Writing chờ duyệt'
    : `${cls.writingPending.toLocaleString('vi-VN')} bài Writing chờ duyệt`;
  const speaking = cls?.speakingMockPending == null
    ? 'số bài Speaking thi thử chờ chấm: chưa có'
    : `${cls.speakingMockPending.toLocaleString('vi-VN')} bài Speaking thi thử chờ chấm`;
  return `Lớp sẽ không còn giáo viên. ${writing} và ${speaking} sẽ chuyển về hàng chờ của admin.`;
}

/** Active classes from GET /admin/cohorts, for "Chuyển lớp sang giáo viên này". */
export function normalizeCohortChoices(value) {
  const rows = Array.isArray(value?.cohorts) ? value.cohorts : null;
  if (!rows) return null;
  return rows
    .filter((row) => row && typeof row === 'object' && text(row.id) && row.is_active !== false)
    .map((row) => ({
      id: text(row.id),
      name: text(row.name) || text(row.id),
      teacherId: text(row.instructor?.id) || text(row.instructor_id),
      teacherName: text(row.instructor?.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}

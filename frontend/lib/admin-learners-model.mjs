// Learner directory page model (ADMINIA-0074 FR-020, FR-021, FR-028, FR-034,
// FR-035; plan 5.4; G09-T10). Plain ES module: URL state, filters the API can
// answer today, column text, CSV and the hand-off to "Gửi thông báo".

export const PAGE_SIZE = 25;
export const ROLE_OPTIONS = Object.freeze([
  { value: 'user,student', label: 'Học viên' },
  { value: 'instructor', label: 'Giáo viên' },
  { value: 'admin', label: 'Quản trị' },
  { value: 'user,student,instructor,admin', label: 'Mọi vai trò' },
]);
export const STATUS_OPTIONS = Object.freeze([
  { value: '', label: 'Tất cả trạng thái' },
  { value: 'active', label: 'Đang học', needsCourses: true },
  { value: 'expiring', label: 'Sắp hết hạn', needsCourses: true },
  { value: 'expired', label: 'Hết hạn', needsCourses: true },
  { value: 'archived', label: 'Lưu trữ' },
]);
export const ATTENTION_OPTIONS = Object.freeze([
  { value: '', label: 'Không lọc' },
  { value: 'any', label: 'Có ít nhất một lý do' },
  { value: 'late_streak', label: 'Trễ liên tiếp' },
  { value: 'inactive', label: 'Không hoạt động' },
  { value: 'expiring', label: 'Khoá sắp hết hạn', needsCourses: true },
  { value: 'low_credits', label: 'Còn ít lượt chấm', needsCourses: true },
]);
export const KIND_OPTIONS = Object.freeze([
  { value: '', label: 'Tất cả dạng' },
  { value: 'offline', label: 'Lớp offline' },
  { value: 'online', label: 'Khoá online' },
  { value: 'both', label: 'Cả hai' },
  { value: 'none', label: 'Chưa có khoá' },
]);
export const CREDITS_OPTIONS = Object.freeze([
  { value: '', label: 'Mọi mức' }, { value: '1', label: 'Còn ≤ 1 lượt' }, { value: '3', label: 'Còn ≤ 3 lượt' },
  { value: '5', label: 'Còn ≤ 5 lượt' }, { value: '10', label: 'Còn ≤ 10 lượt' },
]);
/** Until G04 has a read API, these filters answer 422 filter_unavailable: drawn disabled. */
export const COURSES_PENDING_TEXT = 'Chưa có: cần dữ liệu khoá học (G04)';
export const NOT_YET = 'chưa có';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const allowed = (options) => options.filter((o) => o.value && !o.needsCourses).map((o) => o.value);

/**
 * `{ q, cohort, status, attention, role, page }` from the query string; unknown values fall back.
 * @returns {{ q: string, cohort: string, status: string, attention: string, role: string, page: number }}
 */
export function parseDirectoryQuery(search = '') {
  const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  const page = Number.parseInt(params.get('page') || '1', 10);
  const cohort = params.get('cohort') || '';
  const pick = (key, values) => { const v = params.get(key) || ''; return values.includes(v) ? v : ''; };
  return {
    q: (params.get('q') || '').slice(0, 128),
    cohort: UUID.test(cohort) ? cohort : '',
    status: pick('status', allowed(STATUS_OPTIONS)),
    attention: pick('attention', allowed(ATTENTION_OPTIONS)),
    role: pick('role', ROLE_OPTIONS.map((o) => o.value)) || 'user,student',
    page: Number.isFinite(page) && page >= 1 ? page : 1,
  };
}

/** The page URL query for a state; defaults are left out. */
export function directoryQueryString(state) {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.cohort) params.set('cohort', state.cohort);
  if (state.status) params.set('status', state.status);
  if (state.attention) params.set('attention', state.attention);
  if (state.role && state.role !== 'user,student') params.set('role', state.role);
  if (state.page > 1) params.set('page', String(state.page));
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** The API query (`GET /admin/learners?…`). */
export function directoryApiQuery(state) {
  const params = new URLSearchParams({ role: state.role || 'user,student', page: String(state.page || 1) });
  if (state.q) params.set('q', state.q);
  if (state.cohort) params.set('cohort_id', state.cohort);
  if (state.status) params.set('status', state.status);
  if (state.attention) params.set('attention', state.attention);
  return params;
}

export function profileHref(ref) {
  return `/admin/learners/${encodeURIComponent(ref)}`;
}

/** FR-020: the Dạng column; a missing half of the person is said, not hidden. */
export function kindText(row) {
  if (row.account_state === 'none') return 'Chưa có tài khoản';
  if (row.profile_state === 'none') return 'Chưa có hồ sơ học viên';
  const labels = { offline: 'Lớp offline', online: 'Khoá online', both: 'Cả hai', none: 'Chưa có khoá' };
  return row.kind ? labels[row.kind] || NOT_YET : NOT_YET;
}

export function coursesText(row) {
  if (!Array.isArray(row.courses)) return NOT_YET;
  if (!row.courses.length) return 'Không có khoá';
  return row.courses.map((c) => [c.title || c.name || c.code, c.expires_at ? `hết hạn ${formatDay(c.expires_at)}` : '']
    .filter(Boolean).join(' · ')).join('; ');
}

export function cohortsText(row) {
  if (row.cohorts === null || row.cohorts === undefined) return 'Không đọc được lớp';
  if (!row.cohorts.length) return 'Không thuộc lớp';
  return row.cohorts.map((c) => c.name || 'Lớp không tên').join(', ');
}

export function creditsText(row) {
  return Number.isInteger(row.credits_left) ? String(row.credits_left) : NOT_YET;
}

export function attentionText(row) {
  return Array.isArray(row.attention) && row.attention.length ? row.attention.map((a) => a.text).join(' · ') : '';
}

const VN = { timeZone: 'Asia/Ho_Chi_Minh' };

function partsOf(date, opts) {
  return Object.fromEntries(new Intl.DateTimeFormat('vi-VN', { ...VN, ...opts }).formatToParts(date).map((p) => [p.type, p.value]));
}

/** "16/11/2026"; "—" when unknown. */
export function formatDay(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const p = partsOf(date, { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${p.day}/${p.month}/${p.year}`;
}

/** "Hôm nay", "Hôm qua", "N ngày trước", else the date; "Chưa hoạt động" when never seen. */
export function lastActiveText(iso, now = new Date()) {
  if (!iso) return 'Chưa hoạt động';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Chưa hoạt động';
  const day = (d) => { const p = partsOf(d, { year: 'numeric', month: '2-digit', day: '2-digit' }); return Date.UTC(+p.year, +p.month - 1, +p.day); };
  const days = Math.round((day(now) - day(date)) / 86_400_000);
  if (days <= 0) return 'Hôm nay';
  if (days === 1) return 'Hôm qua';
  if (days < 30) return `${days} ngày trước`;
  return formatDay(iso);
}

/** FR-035: CSV of the visible columns only, for the selected rows. */
export const CSV_COLUMNS = Object.freeze([
  ['Học viên', (r) => r.name], ['Email', (r) => r.email || ''], ['Mã học viên', (r) => r.student_code || ''],
  ['Dạng', kindText], ['Khoá và hạn', coursesText], ['Lớp', cohortsText],
  ['Lượt chấm còn', creditsText], ['Hoạt động gần nhất', (r) => lastActiveText(r.last_active_at)],
  ['Cần chú ý', attentionText],
]);

const cell = (value) => {
  const text = String(value ?? '');
  // Leading =+-@ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function directoryCsv(rows) {
  const lines = [CSV_COLUMNS.map(([h]) => h), ...rows.map((r) => CSV_COLUMNS.map(([, f]) => f(r)))];
  return `﻿${lines.map((line) => line.map(cell).join(',')).join('\r\n')}\r\n`;
}

/**
 * FR-035 "Gửi nhắc đăng ký lại": the notifications page gets refs only (never
 * emails) in the URL; names travel in sessionStorage for its recipient line.
 */
export const NOTIFY_HANDOFF_KEY = 'av-notify-from-learners';
export function notifyHref(rows) {
  const params = new URLSearchParams({ from: 'learners', template: 'renewal', ids: rows.map((r) => r.ref).join(',') });
  return `/admin/notifications?${params}`;
}
export function notifyHandoff(rows) {
  return JSON.stringify(rows.map((r) => ({ ref: r.ref, name: r.name })));
}

/** Bulk "Gán vào lớp" takes learner profile ids; people without a profile are left out and named. */
export function assignableIds(rows) {
  return {
    ids: rows.map((r) => r.student_id).filter(Boolean),
    skipped: rows.filter((r) => !r.student_id).map((r) => r.name),
  };
}

const GOAL_SOURCE = { conflict: 'Hai nguồn lệch nhau', none: '' };

/** CHUAN-ADMIN mục H, the seven fields of the shared learner block (FR-034). */
export function summaryLines(summary) {
  const s = summary || {};
  const goal = s.goal || {};
  const target = typeof goal.target_band === 'number' ? `Band ${goal.target_band}` : '';
  const exam = goal.exam_date ? `thi ${formatDay(goal.exam_date)}` : '';
  const bands = s.recent_bands || {};
  const bandText = (list) => (list === null || list === undefined ? NOT_YET : list.length ? list.join(' · ') : 'Chưa có bài đã trả');
  return {
    where: [
      Array.isArray(s.cohorts) ? (s.cohorts.length ? s.cohorts.map((c) => c.name || 'Lớp không tên').join(', ') : 'Không thuộc lớp') : 'Không đọc được lớp',
      Array.isArray(s.courses) ? (s.courses.length ? s.courses.map((c) => c.title || c.name || c.code).join(', ') : 'Không có khoá') : `Khoá: ${NOT_YET}`,
    ].join(' · '),
    status: s.status?.level === 'ok' ? 'Đang ổn' : s.status?.level === 'attention'
      ? `Cần chú ý: ${(s.status.reasons || []).map((r) => r.text).join(' · ')}` : 'Chưa xác định được (một nguồn chưa đọc được)',
    goal: [target, exam].filter(Boolean).join(', ') || 'Chưa đặt', goalNote: GOAL_SOURCE[goal.source] || '',
    overdue: s.overdue === null || s.overdue === undefined ? NOT_YET
      : s.overdue.count ? `${s.overdue.count} bài${s.overdue.latest_title ? ` · mới nhất: ${s.overdue.latest_title}` : ''}` : 'Không có',
    bandW: `Writing: ${bandText(bands.writing)}`, bandS: `Speaking: ${bandText(bands.speaking)}`,
    last: lastActiveText(s.last_active_at),
    note: s.latest_note ? `${s.latest_note.text}${s.latest_note.author ? ` (${s.latest_note.author}, ${formatDay(s.latest_note.at)})` : ''}` : 'Chưa có ghi chú',
  };
}

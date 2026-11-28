// Learner profile (ADMINIA-0074 FR-022…FR-024, FR-030, FR-031; plan 5.4;
// G09-T11a). Pure helpers for the page: tabs in the URL, and the text of each
// block of the Tổng quan tab from GET /admin/learners/{ref}/overview (G09-T04).
// A block the API could not read is null; a field with no source yet is null
// too and reads "chưa có", never 0 or "Đang ổn".
import { NOT_YET, formatDay, profileHref } from './admin-learners-model.mjs';

/** FR-023: five tabs, each with its own URL. */
export const PROFILE_TABS = [
  { id: 'tong-quan', label: 'Tổng quan' },
  { id: 'hoc-tap', label: 'Học tập' },
  { id: 'ghi-chu', label: 'Ghi chú chăm sóc' },
  { id: 'khoa-va-quyen', label: 'Khoá và quyền' },
  { id: 'nhat-ky', label: 'Nhật ký hệ thống' },
];
const TAB_IDS = PROFILE_TABS.map((t) => t.id);

/**
 * What a tab not built in this task waits on, in plain words.
 * @type {Record<string, string>}
 */
export const TAB_PENDING = {
  'hoc-tap': 'Bảng bài làm mọi kỹ năng, lỗi lặp lại ở Writing và nhóm ngữ pháp yếu sẽ hiện ở đây khi có API bài làm của học viên.',
  'ghi-chu': 'Ghi chú chăm sóc và việc đã hẹn sẽ hiện ở đây khi có bảng ghi chú chăm sóc.',
  'khoa-va-quyen': 'Khoá, hạn, quyền luyện lại và lượt chấm cần dữ liệu khoá học (G04); chi phí AI của học viên cần API chi phí.',
  'nhat-ky': 'Nhật ký các thao tác trên tài khoản này sẽ hiện ở đây khi có API nhật ký.',
};

/** @returns {string} a tab id; an unknown or missing `?tab=` is Tổng quan. */
export function parseTab(search = '') {
  const tab = new URLSearchParams(String(search || '').replace(/^\?/, '')).get('tab') || '';
  return TAB_IDS.includes(tab) ? tab : 'tong-quan';
}

/** @returns {string} the tab's URL; Tổng quan has no `?tab=`. */
export function tabHref(ref, tab) {
  return tab === 'tong-quan' || !TAB_IDS.includes(tab) ? profileHref(ref) : `${profileHref(ref)}?tab=${tab}`;
}

/** FR-022: an `s-…` ref of a person with an account is shown under `u-…`. */
export function canonicalHref(ref, canonicalRef, search = '') {
  if (!canonicalRef || String(canonicalRef).toLowerCase() === String(ref || '').toLowerCase()) return null;
  const query = String(search || '').replace(/^\?/, '');
  return `${profileHref(canonicalRef)}${query ? `?${query}` : ''}`;
}

/** "Gửi nhắc" for one person: the refs travel in the URL, the name in sessionStorage. */
export function notifyOneHref(ref) {
  return `/admin/notifications?${new URLSearchParams({ from: 'learner', ids: ref })}`;
}

/** @type {Record<string, string>} */
export const BLOCK_LABEL = {
  alerts: 'Cảnh báo',
  goal: 'Mục tiêu',
  continuity: 'Độ liên tục',
  assigned: 'Bài được giao',
  scores: 'Điểm theo thời gian',
  assignments: 'Bài được giao (có bài chưa xác định được)',
};

/** @type {Record<string, string>} */
export const ALERT_LABEL = {
  late_streak: 'nộp trễ liên tiếp',
  inactive: 'không hoạt động',
  course_expiring: 'quyền khoá sắp hết hạn',
  low_credits: 'sắp hết lượt chấm',
};

/**
 * @param {any} alerts
 * @returns {{ open: { code: string, text: string, action: string }[], off: string, undecided: string } | null}
 */
export function alertsView(alerts) {
  if (!alerts) return null;
  const names = (codes) => (codes || []).map((c) => ALERT_LABEL[c] || c).join(' · ');
  return {
    open: alerts.open || [],
    off: alerts.checked_off?.length ? `Không bật: ${names(alerts.checked_off)}.` : '',
    undecided: alerts.undecided?.length ? `Chưa xác định được: ${names(alerts.undecided)}.` : '',
  };
}

const DAY = 86_400_000;
function daysUntil(iso, now) {
  if (!iso) return null;
  const at = Date.parse(`${String(iso).slice(0, 10)}T00:00:00+07:00`);
  if (Number.isNaN(at)) return null;
  const today = Date.parse(`${new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10)}T00:00:00+07:00`);
  return Math.round((at - today) / DAY);
}
function leftText(days) {
  if (days === null) return '';
  if (days > 0) return `còn ${days} ngày`;
  if (days === 0) return 'hôm nay';
  return `đã qua ${-days} ngày`;
}

/**
 * FR-030: both sources with their label; "Dùng giá trị này" only when they disagree.
 * @returns {{ rows: { use: 'admin' | 'learner', source: string, band: string, date: string, left: string }[], conflict: boolean, estimated: string } | null}
 */
export function goalView(goal, now = new Date()) {
  if (!goal) return null;
  const band = (v) => (typeof v === 'number' ? v.toFixed(1) : 'Chưa nhập');
  const row = (use, source, b, d) => ({
    use, source, band: band(b), date: d ? formatDay(d) : 'Chưa nhập', left: leftText(daysUntil(d, now)),
  });
  return {
    rows: [
      row('admin', 'Admin nhập', goal.admin?.target_band, goal.admin?.target_date),
      row('learner', 'Học viên khai', goal.learner?.target_band, goal.learner?.exam_date),
    ],
    conflict: Boolean(goal.conflict),
    estimated: typeof goal.estimated_band === 'number'
      ? `Band ước tính hiện tại: ${goal.estimated_band.toFixed(1)} (Overall của kỳ thi thử gần nhất đủ bốn kỹ năng).`
      : 'Chưa có band ước tính: cần một kỳ thi thử đã trả đủ bốn kỹ năng.',
  };
}

/** The goals exactly as the page showed them (POST …/goal/resolve compares them under lock). */
export function goalSeen(goal) {
  return {
    admin: { target_band: goal?.admin?.target_band ?? null, target_date: goal?.admin?.target_date ?? null },
    learner: { target_band: goal?.learner?.target_band ?? null, exam_date: goal?.learner?.exam_date ?? null },
  };
}

/** The confirm line before the goal is written into both places. */
export function goalConfirmText(view, use) {
  const row = view?.rows.find((r) => r.use === use);
  if (!row) return '';
  return `Ghi band ${row.band}, ngày thi ${row.date} (${row.source.toLowerCase()}) vào cả hồ sơ lớp và trang Tài khoản của học viên? Giá trị cũ ghi vào Nhật ký hệ thống.`;
}

// Only a 409 refusal says for sure that nothing was written. A 5xx reaches the
// client as `internal_error` (safe_detail() drops the route's own code), and a
// network failure says nothing, so the write may have committed: say the
// outcome is unknown and let the reload show the canonical goal.
const GOAL_REFUSED = new Set(['goal_changed', 'learner_not_linked', 'no_conflict']);
/** The API's own sentence for a refused write; outcome-unknown wording otherwise. */
export function goalErrorText(caught) {
  const err = /** @type {any} */ (caught) || {};
  if (GOAL_REFUSED.has(err.code) && err.message) return err.message;
  return `Chưa chắc mục tiêu đã được lưu (${err.message || 'lỗi không xác định'}). Đã tải lại hồ sơ để xem giá trị hiện tại; kiểm tra lại trước khi thử lần nữa.`;
}

const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
/**
 * FR-031: 8 weeks × 7 days, the current week last; a day after today is empty.
 * @returns {{ weekdays: string[], weeks: { cells: ('on' | 'off' | 'future')[] }[], activeDays: number, pastDays: number, streak: string, minutes: string } | null}
 */
export function continuityView(continuity) {
  if (!continuity) return null;
  const weeks = (continuity.weeks || []).map((week) => ({
    cells: week.map((day) => (day === null ? 'future' : day ? 'on' : 'off')),
  }));
  const all = weeks.flatMap((w) => w.cells);
  const diff = continuity.minutes_this_week - continuity.minutes_last_week;
  return {
    weekdays: WEEKDAYS,
    weeks,
    activeDays: all.filter((c) => c === 'on').length,
    pastDays: all.filter((c) => c !== 'future').length,
    streak: continuity.streak_days > 0 ? `Chuỗi ngày học hiện tại: ${continuity.streak_days} ngày.` : 'Hôm nay chưa có chuỗi ngày học.',
    minutes: `Tuần này ${continuity.minutes_this_week} phút, tuần trước ${continuity.minutes_last_week} phút (${diff >= 0 ? 'tăng' : 'giảm'} ${Math.abs(diff)} phút).`,
  };
}

/** @returns {{ counts: { label: string, value: number }[], undecided: string, open: any[], overdue: any[] } | null} */
export function assignedView(assigned) {
  if (!assigned) return null;
  return {
    counts: [
      { label: 'nộp đúng hạn', value: assigned.on_time },
      { label: 'nộp trễ', value: assigned.late },
      { label: 'quá hạn chưa nộp', value: assigned.missing },
    ],
    undecided: assigned.undecided ? `${assigned.undecided} bài của buổi học chưa xác định được đã nộp hay chưa, không tính vào số trên.` : '',
    open: assigned.open || [],
    overdue: assigned.overdue || [],
  };
}

/** "Hạn 19/11/2026", or "Không có hạn". */
export function dueText(iso) {
  return iso ? `Hạn ${formatDay(iso)}` : 'Không có hạn';
}

/**
 * FR-024 block 5 as rows (the G03 chart is not in this stack yet): one row per series.
 * A series with no point says so; a line needs at least two points.
 * @returns {{ series: { label: string, points: string }[], milestones: string } | null}
 */
export function scoresView(scores) {
  if (!scores) return null;
  const band = (list) => (list || []).map((p) => `${p.band.toFixed(1)}${p.at ? ` (${formatDay(p.at)})` : ''}`);
  const grammar = (scores.grammar || []).map((p) => `${p.lesson_no ? `B${p.lesson_no} ` : ''}${p.pct}%`);
  const line = (items) => (items.length ? items.join(' · ') : 'Chưa có bài đã trả');
  return {
    series: [
      { label: 'Bài ngữ pháp (% câu đúng)', points: line(grammar) },
      { label: 'Writing', points: line(band(scores.writing)) },
      { label: 'Speaking', points: line(band(scores.speaking)) },
      { label: 'Thi thử Overall', points: line(band(scores.mock)) },
    ],
    milestones: scores.milestones === null || scores.milestones === undefined
      ? `Mốc giữa kỳ, cuối kỳ: ${NOT_YET}.`
      : scores.milestones.length ? `Mốc: ${scores.milestones.map((m) => `${m.label} ${formatDay(m.at)}`).join(' · ')}.` : '',
  };
}

/**
 * The right column: due notes (G09-T35), courses and credits (G04). No source yet → "chưa có".
 * FR-056: carried credits are one more line, with their own end date.
 * @returns {{ dueNotes: string, notes: { body?: string }[], courses: string, credits: string, carried: string }}
 */
export function sideView(side) {
  const s = side || {};
  const notes = Array.isArray(s.due_notes) ? s.due_notes : null;
  return {
    dueNotes: notes === null ? `Việc đã hẹn: ${NOT_YET}.` : notes.length ? '' : 'Không có việc đã hẹn tới hạn.',
    notes: notes || [],
    courses: Array.isArray(s.courses)
      ? (s.courses.length ? s.courses.map((c) => c.title || c.name || c.code).join(', ') : 'Không có khoá')
      : `${NOT_YET} (cần dữ liệu khoá học)`,
    credits: typeof s.credits_left === 'number' ? `${s.credits_left} lượt` : `${NOT_YET} (cần dữ liệu khoá học)`,
    carried: s.credits_carried
      ? `trong đó ${s.credits_carried.amount} lượt chuyển từ khoá trước, dùng tới ${formatDay(s.credits_carried.expires_at)}`
      : '',
  };
}

/** The read-failure line above a block, from `sources_failed`. */
export function failedText(sourcesFailed) {
  const names = (sourcesFailed || []).map((s) => BLOCK_LABEL[s] || s);
  return names.length ? `Chưa đọc được: ${names.join(', ')}. Các khối khác vẫn đúng.` : '';
}

// ── Khoá và quyền: role change and danger zone (FR-033; G09-T11b) ────────────

/** The roles `PATCH /admin/users/{id}/role` accepts, in Vietnamese. */
export const ROLE_OPTIONS = [
  { value: 'student', label: 'Học viên' },
  { value: 'instructor', label: 'Giảng viên' },
  { value: 'admin', label: 'Quản trị viên' },
];

/** `user` is the role of an account that signed up on its own: a learner too. */
export function roleLabel(role) {
  if (role === 'user') return 'Học viên (tự đăng ký)';
  return ROLE_OPTIONS.find((o) => o.value === role)?.label || (role ? String(role) : 'Chưa rõ');
}

/**
 * Why the role cannot be changed here, or '' when it can.
 * @returns {string}
 */
export function roleChangeBlocked(account, selfId) {
  if (!account) return 'Người này chưa có tài khoản, nên chưa có vai trò để đổi.';
  if (selfId && account.user_id === selfId) return 'Không đổi vai trò của chính mình ở đây.';
  // No block on is_active: for a learner it is the activation flag, not a
  // suspension (users.suspended_at, mig 336). The role route refuses a
  // suspended account itself (account_suspended) and the dialog shows why.
  return '';
}

const STAFF = new Set(['admin', 'instructor']);
/** The confirm line: what changes, and that taking staff rights away signs the person out. */
export function roleConfirmText(name, from, to) {
  const out = `Đổi vai trò của ${name} từ ${roleLabel(from)} sang ${roleLabel(to)}?`;
  if (STAFF.has(from) && !STAFF.has(to)) return `${out} Mọi phiên đăng nhập của người này bị thu hồi ngay. Thay đổi ghi vào nhật ký bảo mật.`;
  if (to === 'admin') return `${out} Người này sẽ vào được toàn bộ khu quản trị. Thay đổi ghi vào nhật ký bảo mật.`;
  return `${out} Thay đổi ghi vào nhật ký bảo mật.`;
}

/**
 * The answer of the role change, said truthfully: a revocation that failed is a warning, not a success.
 * @returns {{ kind: 'success' | 'error', text: string }}
 */
export function roleResultText(response, to, userId) {
  if (response?.ok !== true || response.id !== userId || response.role !== to || typeof response.changed !== 'boolean') {
    throw new Error('Chưa nhận được xác nhận đổi vai trò từ máy chủ. Kiểm tra hồ sơ trước khi thử lại.');
  }
  // Checked first: a retried demotion can answer changed:false with
  // sessions_revoked:false (the route retries revocation when the role
  // already matches), and that failure must not read as "nothing changed".
  if (response.sessions_revoked === false) {
    const head = response.changed === false ? `Vai trò đã là ${roleLabel(to)}` : `Đã đổi vai trò sang ${roleLabel(to)}`;
    return { kind: 'error', text: `${head} nhưng chưa thu hồi được phiên đăng nhập. Thu hồi phiên ở trang Người dùng.` };
  }
  if (!response.changed) return { kind: 'success', text: `Vai trò đã là ${roleLabel(to)}; không có gì thay đổi.` };
  return { kind: 'success', text: `Đã đổi vai trò sang ${roleLabel(to)}.` };
}

/** A refused role change keeps the API's own sentence (last admin, suspended, step-up not done). */
export function roleErrorText(caught) {
  const err = /** @type {any} */ (caught) || {};
  // A factor added or changed under 24 h ago: a fresh code does not help,
  // so the server's sentence (with the wait) is shown as is (FR-020a).
  if (err.code === 'step_up_required' && err.reason === 'new_factor_cooloff') {
    return `Chưa đổi vai trò: ${err.message || 'cần chờ hết thời gian chờ sau khi đổi mã hai bước.'}`;
  }
  if (err.code === 'step_up_required') return 'Chưa đổi vai trò: cần xác minh mã hai bước. Bấm Đổi vai trò lần nữa để nhập mã.';
  return `Chưa đổi vai trò: ${err.message || 'lỗi không xác định'}`;
}

/** "Gỡ khỏi lớp" confirm: what goes and what stays (CHUAN-ADMIN vùng nguy hiểm). */
export function removeConfirmText(name, cohortName) {
  return `Gỡ ${name} khỏi lớp ${cohortName}? Người này không nhận bài giao mới và không có trong bảng điểm của lớp. Quyền khoá học và lịch sử bài làm giữ nguyên. Thêm lại được từ trang Lớp; bài giao trong thời gian bị gỡ không tự giao lại.`;
}

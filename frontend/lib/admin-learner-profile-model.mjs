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
  'khoa-va-quyen': 'Khoá, hạn, quyền luyện lại và lượt chấm cần dữ liệu khoá học (G04); chi phí AI của học viên cần API chi phí. Chưa có thao tác nào ở thẻ này.',
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
  if (!canonicalRef || canonicalRef === ref) return null;
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

const GOAL_ERRORS = new Set(['goal_changed', 'learner_not_linked', 'no_conflict', 'goal_write_failed', 'goal_saved_unreadable']);
/** The API's own sentence for a refused or failed write; never "đã lưu" unless it was. */
export function goalErrorText(caught) {
  const err = /** @type {any} */ (caught) || {};
  if (GOAL_ERRORS.has(err.code) && err.message) return err.message;
  return `Chưa lưu được mục tiêu: ${err.message || 'lỗi không xác định'}. Không có gì được ghi; thử lại.`;
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

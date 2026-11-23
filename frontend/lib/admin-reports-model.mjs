// Báo cáo /admin/reports (ADMINIA-0074 FR-164; sheet AdminBaoCao; G09-T41).
// Plain ES module: the page and its tests read it. Every number comes from an
// API that already exists (GOI-09 T41 "không viết API báo cáo mới"); a number
// the API cannot give is `null` with a reason and is drawn as "chưa có", never
// as 0 or an empty fraction.

import { normalizeAiUsagePayload, serviceLabel, serviceRows } from './admin-ai-usage-model.mjs';
import { normalizeFootTrafficPayload } from './admin-foot-traffic-model.mjs';
import { routeFor } from './route-registry.mjs';

export const REPORT_TABS = Object.freeze([
  { id: 'hoat-dong', label: 'Hoạt động học viên' },
  { id: 'luu-luong', label: 'Lưu lượng' },
  { id: 'chi-phi-ai', label: 'Chi phí AI' },
  { id: 'chat-luong', label: 'Chất lượng nội dung' },
]);
export const REPORT_RANGES = Object.freeze([7, 30, 90]);
const DEFAULT_TAB = 'hoat-dong';
const DEFAULT_RANGE = 30;
const DAY_MS = 86_400_000;

/** `?tab=&range=` → state; anything unknown falls back to the defaults. */
export function parseReportsQuery(query = '') {
  const params = new URLSearchParams(String(query || '').replace(/^\?/, ''));
  const tab = REPORT_TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : DEFAULT_TAB;
  const range = Number(params.get('range'));
  return { tab, range: REPORT_RANGES.includes(range) ? range : DEFAULT_RANGE };
}

export function reportsHref({ tab, range }) {
  return `/admin/reports?${new URLSearchParams({ tab, range: String(range) })}`;
}

export function tabLabel(tab) {
  return REPORT_TABS.find((t) => t.id === tab)?.label ?? REPORT_TABS[0].label;
}

/** A link only when its page is live in the route registry. */
export function liveAdminHref(href) {
  return routeFor(href)?.status === 'live' ? href : null;
}

const vnDate = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' });
const utcDay = (date) => date.toISOString().slice(0, 10);
const dmy = (day) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;

/** The window ending today: `{ from, to }` as UTC days (the APIs bucket by UTC). */
export function rangeDays(range, now = new Date()) {
  const end = new Date(now);
  const start = new Date(end.getTime() - (range - 1) * DAY_MS);
  return { from: utcDay(start), to: utcDay(end) };
}

export function rangeText(range, now = new Date()) {
  const start = new Date(now.getTime() - (range - 1) * DAY_MS);
  return `${range} ngày gần nhất · ${vnDate.format(start)} – ${vnDate.format(now)}`;
}

export function footTrafficQuery(range, now = new Date()) {
  const { from, to } = rangeDays(range, now);
  return new URLSearchParams({ date_from: from, date_to: to });
}

// ── Formatting ─────────────────────────────────────────────────────────────

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function formatCell(value, kind = 'text') {
  if (value == null || (kind !== 'text' && !isNum(value))) return 'chưa có';
  if (kind === 'count') return value.toLocaleString('vi-VN');
  if (kind === 'usd') return `${value.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} US$`;
  if (kind === 'usd4') return `${value.toLocaleString('vi-VN', { minimumFractionDigits: 4, maximumFractionDigits: 4 })} US$`;
  if (kind === 'pct') return `${(value * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`;
  return String(value);
}

// A text cell that starts like a formula (=, +, -, @, tab, CR) would be run by
// a spreadsheet; a leading apostrophe makes it plain text (OWASP CSV injection).
const FORMULA_START = /^[=+\-@\t\r]/;

/** CSV cell: dot decimals, US$ with two digits, a missing value is an empty cell. */
function csvCell(value, kind = 'text') {
  if (value == null || (kind !== 'text' && !isNum(value))) return '';
  let out;
  if (kind === 'usd') out = value.toFixed(2);
  else if (kind === 'usd4') out = value.toFixed(4);
  else if (kind === 'pct') out = (value * 100).toFixed(1);
  else if (kind === 'count') out = String(value);
  else {
    out = String(value);
    if (FORMULA_START.test(out)) out = `'${out}`;
  }
  return /[",\r\n]/.test(out) ? `"${out.replace(/"/g, '""')}"` : out;
}

/** One file for the open tab: each data table is a block with its title. */
export function reportCsv(tables) {
  const blocks = tables.map((t) => {
    const lines = [csvCell(t.title), t.columns.map((c) => csvCell(c.label)).join(',')];
    for (const row of t.rows) lines.push(row.map((cell, i) => csvCell(cell, t.columns[i].kind)).join(','));
    return lines.join('\r\n');
  });
  return `${blocks.join('\r\n\r\n')}\r\n`;
}

export function csvFileName(tab, range, now = new Date()) {
  const { from, to } = rangeDays(range, now);
  return `bao-cao-${tab}-${from}-${to}.csv`;
}

const share = (part, whole) => (isNum(part) && isNum(whole) && whole > 0 ? part / whole : null);

// ── Hoạt động học viên: GET /admin/overview ────────────────────────────────

const ACTIVE_SOURCES = ['students', 'sessions_recent', 'essays_recent', 'listening_recent', 'reading_recent', 'dictation_recent'];

function num(v) {
  return Number.isSafeInteger(v) && v >= 0 ? v : null;
}

/**
 * `GET /admin/overview` → the Activity tab. The endpoint has fixed 7 and 30
 * day windows: 90 days has no active-learner number, and the per-skill table
 * is always the last 7 days. A block listed in `partial_failures` is not read
 * as a real zero. Null when the body is not the overview shape.
 */
export function activityReport(raw, range) {
  if (!raw || typeof raw !== 'object' || !raw.students || !raw.skills) return null;
  const failed = new Set(Array.isArray(raw.partial_failures) ? raw.partial_failures : []);
  const ok = (...blocks) => blocks.every((b) => !failed.has(b));
  const s = raw.students;
  const k = raw.skills;
  const anyActiveFailed = ACTIVE_SOURCES.some((b) => failed.has(b));
  let active = null;
  let activeReason = null;
  if (range === 90) activeReason = 'nguồn chỉ tính sẵn 7 và 30 ngày';
  else if (anyActiveFailed) activeReason = 'một nguồn bài làm không đọc được';
  else active = num(range === 7 ? s.active_7d : s.active_30d);

  const tiles = [
    {
      id: 'active', label: 'Học viên hoạt động', value: active, kind: 'count',
      reason: activeReason,
      note: active == null ? null : `có ít nhất một bài làm trong ${range} ngày`,
    },
    {
      id: 'students', label: 'Học viên có hồ sơ', value: ok('students') ? num(s.total) : null, kind: 'count',
      reason: ok('students') ? null : 'danh sách học viên không đọc được',
      note: 'tính cả học viên chưa vào lớp',
    },
    {
      id: 'pending', label: 'Bài Writing chờ giáo viên lúc này',
      value: ok('essays_pending') ? num(k.writing?.feedback_pending) : null, kind: 'count',
      reason: ok('essays_pending') ? null : 'hàng chờ Writing không đọc được',
      note: 'bài chưa trả cho học viên',
    },
  ];

  const skillRow = (label, recent, total, recentBlocks, totalBlock) => [
    label,
    ok(...recentBlocks) ? num(recent) : null,
    ok(totalBlock) ? num(total) : null,
  ];
  const skills = {
    id: 'skills',
    title: 'Bảng 1 · Bài làm theo kỹ năng',
    caption: 'Cột "7 ngày gần nhất" luôn là 7 ngày: nguồn chưa nhận khoảng thời gian khác.',
    source: 'Nguồn: tổng quan quản trị (/admin/overview), mọi tài khoản.',
    columns: [
      { label: 'Kỹ năng', kind: 'text' },
      { label: '7 ngày gần nhất', kind: 'count' },
      { label: 'Từ trước tới nay', kind: 'count' },
    ],
    rows: [
      skillRow('Speaking · phiên', k.speaking?.sessions_7d, k.speaking?.sessions_total, ['sessions_recent'], 'sessions_total'),
      skillRow('Writing · bài', k.writing?.essays_7d, k.writing?.essays_total, ['essays_recent'], 'essays_total'),
      skillRow('Reading · lượt', k.reading?.attempts_7d, k.reading?.attempts_total, ['reading_recent'], 'reading_total'),
      skillRow('Listening · lượt', k.listening?.attempts_7d, k.listening?.attempts_total, ['listening_recent'], 'listening_total'),
      skillRow('Chép chính tả · lượt', k.listening?.dictation_7d, k.listening?.dictation_total, ['dictation_recent'], 'dictation_total'),
    ],
  };

  const cohortRows = Array.isArray(s.by_cohort)
    ? s.by_cohort
      .filter((c) => c && num(c.count) != null)
      .map((c) => [typeof c.cohort_name === 'string' && c.cohort_name.trim() ? c.cohort_name.trim() : 'Chưa vào lớp', c.count])
    : [];
  const cohortsOk = ok('students', 'cohorts');
  const cohorts = cohortsOk && cohortRows.length ? {
    id: 'cohorts',
    title: 'Bảng 2 · Học viên theo lớp',
    caption: 'Số học viên đang thuộc mỗi lớp còn hoạt động.',
    source: 'Nguồn: tổng quan quản trị (/admin/overview).',
    columns: [{ label: 'Lớp', kind: 'text' }, { label: 'Học viên', kind: 'count' }],
    rows: cohortRows,
  } : null;
  const cohortsReason = cohortsOk ? 'chưa có học viên nào trong lớp' : 'danh sách lớp không đọc được';

  return { tiles, tables: cohorts ? [skills, cohorts] : [skills], cohortsReason };
}

// ── Lưu lượng: GET /admin/analytics/foot-traffic ───────────────────────────

function axis(from, to) {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY_MS) out.push(utcDay(new Date(t)));
  return out;
}

/**
 * Foot traffic → the Traffic tab. A complete read has no row for a day with
 * no views, so that day is a real 0; a partial read leaves it empty.
 * `unavailable` carries no numbers at all. Null for a foreign shape.
 */
export function trafficReport(raw, range, now = new Date()) {
  const data = normalizeFootTrafficPayload(raw);
  if (!data) return null;
  const partial = data.status === 'partial';
  if (data.status === 'unavailable') {
    return { status: 'unavailable', partial: false, tiles: [], tables: [] };
  }
  const tiles = [
    { id: 'views', label: 'Lượt xem trang', value: data.totalViews, kind: 'count', atLeast: partial, note: 'mọi trang có ghi lượt xem' },
    { id: 'visitors', label: 'Người xem khác nhau', value: data.uniqueVisitors, kind: 'count', atLeast: partial, note: 'tài khoản đã đăng nhập, cộng lượt ẩn danh' },
    { id: 'anonymous', label: 'Lượt xem ẩn danh', value: data.anonymousHits, kind: 'count', atLeast: partial, note: 'chưa đăng nhập' },
  ];
  const { from, to } = rangeDays(range, now);
  const byDay = new Map(data.daily.map((d) => [d.date, d.views]));
  const daily = {
    id: 'daily',
    title: 'Hình 3 · Lượt xem trang theo ngày',
    caption: `Ngày theo giờ UTC, như nguồn chia ngày.${partial ? ' Dữ liệu chưa đủ: ô trống là không có dữ liệu, không phải 0.' : ''}`,
    source: 'Nguồn: lượt xem trang (/admin/analytics/foot-traffic).',
    columns: [{ label: 'Ngày', kind: 'text' }, { label: 'Lượt xem', kind: 'count' }],
    rows: axis(from, to).map((day) => [dmy(day), byDay.has(day) ? byDay.get(day) : (partial ? null : 0)]),
  };
  const tables = [daily];
  if (data.topPages.length) {
    tables.push({
      id: 'pages',
      title: 'Bảng 4 · Trang xem nhiều nhất',
      caption: 'Tỉ trọng tính trên tổng lượt xem của khoảng.',
      source: 'Nguồn: lượt xem trang (/admin/analytics/foot-traffic).',
      columns: [{ label: 'Trang', kind: 'text' }, { label: 'Lượt xem', kind: 'count' }, { label: 'Tỉ trọng', kind: 'pct' }],
      rows: data.topPages.map((p) => [p.path, p.views, share(p.views, data.totalViews)]),
    });
  }
  return { status: data.status, partial, tiles, tables };
}

// ── Chi phí AI: GET /admin/ai-usage?days= ──────────────────────────────────

/**
 * AI usage → the AI cost tab. Calls without a unit price are never folded
 * into the cost as 0: their count is a tile of its own. Null for a foreign shape.
 */
export function aiCostReport(raw) {
  const data = normalizeAiUsagePayload(raw);
  if (!data) return null;
  const o = data.overall;
  const tiles = [
    {
      id: 'cost', label: 'Chi phí trong kỳ', value: o.cost, kind: 'usd', atLeast: data.meta.truncated,
      note: o.unpricedCalls ? 'không gồm lượt gọi chưa có chi phí đơn vị' : 'từ chi phí đơn vị đã khai',
    },
    { id: 'calls', label: 'Lượt gọi AI', value: o.calls, kind: 'count', atLeast: data.meta.truncated, note: 'mọi dịch vụ' },
    {
      id: 'unpriced', label: 'Lượt gọi chưa có chi phí đơn vị', value: o.unpricedCalls, kind: 'count',
      reason: o.unpricedCalls == null ? 'nguồn không tách số này' : null, note: 'không cộng vào chi phí',
    },
    {
      id: 'failed', label: 'Lượt gọi lỗi', value: o.failedCalls, kind: 'count',
      reason: o.failedCalls == null ? 'nguồn không tách số này' : null, note: 'vẫn tính vào lượt gọi',
    },
  ];
  const services = {
    id: 'services',
    title: 'Hình 7 · Chi phí AI theo dịch vụ',
    caption: 'Tổng trong khoảng đã chọn. US$ / lượt chỉ tính khi dịch vụ có lượt gọi.',
    source: 'Nguồn: nhật ký lượt gọi AI (/admin/ai-usage).',
    columns: [
      { label: 'Dịch vụ', kind: 'text' },
      { label: 'Lượt gọi', kind: 'count' },
      { label: 'Chi phí US$', kind: 'usd' },
      { label: 'US$ / lượt', kind: 'usd4' },
      { label: 'Tỉ trọng', kind: 'pct' },
    ],
    rows: serviceRows(o.services).map(([name, s]) => [
      serviceLabel(name), s.calls, s.cost, s.calls > 0 ? s.cost / s.calls : null, share(s.cost, o.cost),
    ]),
  };
  return { truncated: data.meta.truncated, tiles, tables: services.rows.length ? [services] : [] };
}

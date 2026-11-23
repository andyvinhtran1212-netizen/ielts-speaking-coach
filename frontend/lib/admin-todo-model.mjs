// Việc cần làm on /admin (ADMINIA-0074 FR-090…093; sheet AdminViecCanLam;
// G09-T18 part B). Reads `GET /admin/attention` (G09-T06). Plain ES module:
// the page and its tests read it. A count the API could not give is null and
// is drawn as "chưa có", never as 0.

import { routeFor } from './route-registry.mjs';

/**
 * FR-090: the fixed order by urgency. `href` is the row's way in; it is a
 * link only while its page is live in the route registry.
 */
export const QUEUE_ROWS = Object.freeze([
  { key: 'exams_today', label: 'Kỳ thi hôm nay', href: '/admin/mock-tests', onlyWhenActive: true },
  { key: 'writing_review', label: 'Bài chờ duyệt', href: '/admin/writing/queue' },
  { key: 'speaking_mock_pending', label: 'Bài Speaking thi thử chờ chấm', href: '/admin/speaking/grading' },
  { key: 'course_tests_awaiting_release', label: 'Bài kiểm tra chờ công bố', href: null },
  { key: 'assignments_overdue', label: 'Bài giao quá hạn còn người chưa nộp', href: '/admin/classes' },
  { key: 'regrade_new', label: 'Yêu cầu chấm lại', href: '/admin/writing/regrade-requests' },
  { key: 'enrollments_reported', label: 'Đơn đăng ký', href: '/admin/enrollments' },
  { key: 'care_due_today', label: 'Cần liên hệ hôm nay', href: '/admin/learners' },
  { key: 'incident_groups_open', label: 'Sự cố', href: '/admin/incidents' },
  { key: 'feedback_open', label: 'Phản hồi', href: '/admin/feedback' },
  { key: 'entitlements_expiring', label: 'Quyền sắp hết hạn', href: '/admin/learners' },
  { key: 'classes_unmetered', label: 'Lớp chưa chuyển sang đo lượt', href: '/admin/classes?metering=legacy' },
]);

/** A link only when its page is live. */
export function liveHref(href) {
  if (!href) return null;
  return routeFor(href.split('?')[0])?.status === 'live' ? href : null;
}

const record = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const count = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : null);
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const when = (v) => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null);

function queue(raw) {
  const q = record(raw);
  if (!q) return { state: 'error', count: null, oldestAt: null, overdue: false, aiFailed: null };
  const state = q.unavailable ? 'unavailable' : q.error ? 'error' : 'ok';
  const n = state === 'ok' ? count(q.count) : null;
  return {
    state: state === 'ok' && n == null ? 'error' : state,
    count: n,
    oldestAt: state === 'ok' ? when(q.oldest_at) : null,
    overdue: state === 'ok' && q.overdue === true,
    aiFailed: state === 'ok' ? count(q.ai_failed) : null,
  };
}

function lesson(raw) {
  const l = record(raw);
  if (!l || !text(l.date) || !/^\d{4}-\d{2}-\d{2}$/.test(l.date)) return null;
  return { id: text(l.lesson_id), no: count(l.lesson_no), date: l.date, startsAt: text(l.starts_at) };
}

/**
 * `GET /admin/attention` → the page. Null when the body is not that shape.
 * A block the API could not read (`null`) stays null here: the page says
 * "chưa có", never an empty list.
 */
export function normalizeAttention(raw) {
  const body = record(raw);
  if (!body || !record(body.queues) || !record(body.ops_week)) return null;
  const queues = Object.fromEntries(QUEUE_ROWS.map((r) => [r.key, queue(body.queues[r.key])]));
  const classes = Array.isArray(body.classes_week)
    ? body.classes_week.flatMap((raw) => {
      const c = record(raw);
      const next = lesson(c?.next_lesson);
      if (!c || !text(c.cohort_id) || !next) return [];
      return [{
        id: c.cohort_id,
        name: text(c.name),
        next,
        following: lesson(c.following_lesson),
        hasAssignment: c.has_assignment === true,
        pendingReview: count(c.pending_review) ?? 0,
        lastAssignmentId: text(c.last_assignment_id),
      }];
    })
    : null;
  const learners = Array.isArray(body.attention_learners)
    ? body.attention_learners.flatMap((raw) => {
      const l = record(raw);
      if (!l || !text(l.ref) || !text(l.name)) return [];
      const reasons = (Array.isArray(l.reasons) ? l.reasons : []).map((r) => text(record(r)?.text)).filter(Boolean);
      const cohort = record(l.cohort);
      return [{ ref: l.ref, name: l.name.trim(), cohort: cohort && text(cohort.id) ? { id: cohort.id, name: text(cohort.name) } : null, reasons }];
    })
      // FR-092: by number of reasons, then by name; at most 8.
      .sort((a, b) => b.reasons.length - a.reasons.length || a.name.localeCompare(b.name, 'vi'))
      .slice(0, 8)
    : null;
  const ops = body.ops_week;
  const rate = record(ops.on_time_rate);
  const failed = Array.isArray(body.sources_failed) ? body.sources_failed.filter((s) => typeof s === 'string') : [];
  return {
    queues,
    classes,
    learners,
    ops: {
      onTimeRate: rate && typeof rate.value === 'number' && rate.value >= 0 && rate.value <= 1 ? rate.value : null,
      lowestCohortId: rate ? text(rate.lowest_cohort_id) : null,
      inactiveLearners: count(ops.inactive_learners),
      reviewWaitHours: typeof ops.review_wait_median_hours === 'number' && ops.review_wait_median_hours >= 0 ? ops.review_wait_median_hours : null,
    },
    thresholdsFailed: failed.includes('thresholds'),
    generatedAt: when(body.generated_at),
  };
}

/** Rows to draw: "Kỳ thi hôm nay" only on a day with an exam (or when its read failed). */
export function visibleRows(data) {
  return QUEUE_ROWS.filter((r) => {
    if (!r.onlyWhenActive) return true;
    const q = data.queues[r.key];
    return q.state === 'error' || (q.count ?? 0) > 0;
  });
}

/** "N loại việc đang chờ[, K nguồn chưa tải được]". */
export function summaryText(data) {
  const rows = visibleRows(data);
  const waiting = rows.filter((r) => (data.queues[r.key].count ?? 0) > 0).length;
  const failed = rows.filter((r) => data.queues[r.key].state === 'error').length;
  const head = waiting ? `${waiting} loại việc đang chờ` : 'Không còn việc nào đang chờ';
  return failed ? `${head}, ${failed} nguồn chưa tải được` : head;
}

const VN = 'Asia/Ho_Chi_Minh';
const weekday = new Intl.DateTimeFormat('vi-VN', { timeZone: VN, weekday: 'long' });
const dmyFmt = new Intl.DateTimeFormat('en-GB', { timeZone: VN, day: '2-digit', month: '2-digit', year: 'numeric' });
const hmFmt = new Intl.DateTimeFormat('en-GB', { timeZone: VN, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Thứ Ba, 17/11/2026" in Vietnam time. */
export function dayText(date) {
  return `${cap(weekday.format(date))}, ${dmyFmt.format(date)}`;
}

export function timeText(date) {
  return hmFmt.format(date);
}

/** How long the oldest item has waited: "45 phút", "3 giờ", "2 ngày". */
export function waitedText(oldestAt, now = new Date()) {
  if (!oldestAt) return null;
  const minutes = Math.max(0, Math.floor((now.getTime() - Date.parse(oldestAt)) / 60000));
  if (minutes < 60) return `${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} giờ`;
  return `${Math.floor(hours / 24)} ngày`;
}

/** A lesson day as "Thứ Ba 17/11" (+ ", 19:30"); "hôm nay" for today. */
export function lessonText(l, now = new Date()) {
  const date = new Date(`${l.date}T12:00:00+07:00`);
  const today = dmyFmt.format(now) === dmyFmt.format(date);
  const day = `${cap(weekday.format(date))} ${dmyFmt.format(date).slice(0, 5)}`;
  const parts = [l.no != null ? `Buổi ${l.no}` : null, today ? `hôm nay, ${day}` : day].filter(Boolean);
  return `${parts.join(' · ')}${l.startsAt ? `, ${l.startsAt.slice(0, 5)}` : ''}`;
}

export function percentText(value) {
  return `${Math.round(value * 100)}%`;
}

export function hoursText(value) {
  return value.toLocaleString('vi-VN', { maximumFractionDigits: 1 });
}

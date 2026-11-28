// Pure logic of the new Today page (LEARNERCORE-0063 T14). Kept out of the
// `.tsx` tree so `node --test` checks the real behaviour, like
// `home-metrics.mjs` and `my-class-model.mjs`.
//
// The page never derives `state`/`banner` itself (FR-019): it reads what
// `GET /api/student/today` returns and only turns it into copy.

const STATES = new Set(['learning', 'first_day', 'order_pending', 'no_course']);
const BANNERS = new Set(['expiring', 'expired', 'out_of_credits']);
const ORDER_STATUSES = new Set(['awaiting_transfer', 'transfer_reported', 'needs_info']);
const RESUME_KINDS = new Set(['speaking', 'reading', 'listening', 'dictation']);
const RESULT_KINDS = new Set(['writing', 'speaking']);

function objectOf(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}
function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}
function countOf(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}
function listOf(value) {
  return Array.isArray(value) ? value : [];
}
/** Same-origin path only: a block never links off-site or to `javascript:`. */
export function safePath(value) {
  const path = textOf(value);
  return path.startsWith('/') && !path.startsWith('//') && !path.includes('\\') ? path : null;
}

function normalizeResume(value) {
  const row = objectOf(value);
  const href = safePath(row?.href);
  const title = textOf(row?.title);
  if (!row || !RESUME_KINDS.has(row.kind) || !href || !title) return null;
  const progress = objectOf(row.progress);
  const done = countOf(progress?.done);
  const total = countOf(progress?.total);
  return {
    kind: row.kind, title, href,
    progress: done !== null && total ? { done, total } : null,
  };
}

export function normalizeTodayResume(value) {
  const row = objectOf(value);
  if (!row || !Array.isArray(row.resume) || !Array.isArray(row.degraded)) return null;
  return {
    resume: row.resume.map(normalizeResume).filter(Boolean),
    degraded: row.degraded.includes('resume'),
  };
}

function normalizeResult(value) {
  const row = objectOf(value);
  const href = safePath(row?.href);
  const title = textOf(row?.title);
  const key = textOf(row?.key);
  if (!row || !RESULT_KINDS.has(row.kind) || !href || !title || !key) return null;
  return { kind: row.kind, title, href, key, returnedAt: textOf(row.returned_at) };
}

function normalizeGoal(value) {
  const row = objectOf(value);
  const band = typeof row?.target_band === 'number' && Number.isFinite(row.target_band)
    && row.target_band > 0 && row.target_band <= 9 ? row.target_band : null;
  if (band === null) return null;
  return { targetBand: band, weeksLeft: countOf(row.weeks_left) };
}

function normalizeCredits(value) {
  const row = objectOf(value);
  const total = countOf(row?.total);
  if (total === null) return null;
  const byKind = objectOf(row.by_kind) || {};
  const rows = [];
  const online = countOf(byKind.online);
  const klass = countOf(byKind.class);
  if (online !== null) rows.push({ kind: 'online', remaining: online });
  if (klass !== null) rows.push({ kind: 'class', remaining: klass });
  return { total, rows };
}

function normalizeOrder(value) {
  const row = objectOf(value);
  const code = textOf(row?.order_code);
  if (!row || !code || !ORDER_STATUSES.has(row.status)) return null;
  return {
    code,
    status: row.status,
    productTitle: textOf(row.product_title) || null,
    supplementBy: textOf(row.supplement_by) || null,
  };
}

function normalizeRepeatError(value) {
  const row = objectOf(value);
  const label = textOf(row?.label);
  const count = countOf(row?.count);
  const of = countOf(row?.of);
  const total = countOf(row?.total_errors);
  if (!row || !label || !count || !of || total === null) return null;
  return { label, count, of, totalErrors: total, reviewHref: safePath(row.review_href) };
}

function normalizeNextLesson(value) {
  const row = objectOf(value);
  const href = safePath(row?.href);
  const title = textOf(row?.title);
  if (!row || !href || !title) return null;
  return {
    courseName: textOf(row.course_name) || null,
    stageNo: countOf(row.stage_no),
    lessonNo: countOf(row.lesson_no),
    lessonCount: countOf(row.lesson_count),
    title,
    videoSeconds: countOf(row.video_seconds),
    practiceItems: countOf(row.practice_items),
    resumeSeconds: countOf(row.resume_seconds),
    href,
  };
}

function normalizeMockExam(value) {
  const row = objectOf(value);
  const href = safePath(row?.href);
  const title = textOf(row?.title);
  if (!row || !href || !title) return null;
  return { title, href, state: textOf(row.state), closesAt: textOf(row.closes_at) || null };
}

/**
 * Strict boundary for `GET /api/student/today`. `null` = the response is not
 * the contract (the page shows its error notice). Rows inside a list that do
 * not match are dropped; `assigned` rows stay raw for `my-class-model`.
 */
export function normalizeToday(value) {
  const row = objectOf(value);
  if (!row || !STATES.has(row.state)) return null;
  if (row.banner != null && !BANNERS.has(row.banner)) return null;
  const degraded = listOf(row.degraded).filter((item) => typeof item === 'string');
  const cursor = objectOf(row.new_results_cursor);
  return {
    name: textOf(objectOf(row.student)?.name),
    state: row.state,
    banner: row.banner ?? null,
    nextLesson: normalizeNextLesson(row.next_lesson),
    assigned: listOf(row.assigned),
    dueSoon: countOf(row.assigned_due_soon) ?? 0,
    dueLater: countOf(row.assigned_due_later) ?? 0,
    resume: listOf(row.resume).map(normalizeResume).filter(Boolean),
    credits: normalizeCredits(row.credits),
    orders: listOf(row.orders_open).map(normalizeOrder).filter(Boolean),
    goal: normalizeGoal(row.goal),
    newResults: listOf(row.new_results).map(normalizeResult).filter(Boolean),
    seenCursor: textOf(cursor?.seen_until) && textOf(cursor?.seen_key)
      ? { seen_until: textOf(cursor.seen_until), seen_key: textOf(cursor.seen_key) } : null,
    repeatError: normalizeRepeatError(row.repeat_error),
    trialTodayLeft: countOf(row.trial_today_left),
    mockExams: listOf(row.mock_exams).map(normalizeMockExam).filter(Boolean),
    degraded: new Set(degraded),
  };
}

/** N of FR-020: due-soon assigned work (counted before the cap) + the next course lesson. */
export function todayCount(today) {
  return today.dueSoon + (today.nextLesson ? 1 : 0);
}

/** FR-020 heading; never "0 việc". */
export function headingCopy(name, count) {
  const who = name || 'bạn';
  return count > 0 ? `Chào ${who}. Hôm nay bạn có ${count} việc.` : 'Hôm nay không có bài đến hạn.';
}

/** FR-070: "Mục tiêu 6.5 · còn 17 tuần tới ngày thi", or just the target. */
export function goalCopy(goal) {
  if (!goal) return null;
  const band = goal.targetBand.toFixed(1);
  return goal.weeksLeft ? `Mục tiêu ${band} · còn ${goal.weeksLeft} tuần tới ngày thi` : `Mục tiêu ${band}`;
}

/** FR-021 action: resume from a whole minute, else start. */
export function lessonActionCopy(lesson) {
  const minute = lesson.resumeSeconds ? Math.floor(lesson.resumeSeconds / 60) : 0;
  return minute > 0 ? `Học tiếp từ phút ${minute}` : 'Bắt đầu bài';
}

/** "12 phút" for a video length; null when unknown. */
export function minutesCopy(seconds) {
  if (!seconds) return null;
  return `${Math.max(1, Math.round(seconds / 60))} phút`;
}

const CREDIT_LABELS = {
  online: 'Lượt chấm AI của khoá',
  class: 'Lượt chấm AI lớp cấp cho bạn · cấp kèm mã lớp',
};

/** FR-024 rows: one per source the server named, each with its label. */
export function creditRows(credits) {
  if (!credits) return [];
  if (credits.rows.length) {
    return credits.rows.map((row) => ({ ...row, label: CREDIT_LABELS[row.kind] }));
  }
  return [{ kind: 'total', remaining: credits.total, label: 'Lượt chấm AI còn' }];
}

/** True when the class source is present (class wording under the number). */
export function hasClassCredits(credits) {
  return Boolean(credits?.rows.some((row) => row.kind === 'class'));
}

const ORDER_LABELS = {
  awaiting_transfer: 'Chờ chuyển khoản',
  transfer_reported: 'Đã báo chuyển khoản · chờ xác nhận',
  needs_info: 'Cần bổ sung thông tin',
};

export function orderStatusCopy(status) {
  return ORDER_LABELS[status] || null;
}

const VN_DATE = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric',
});

/** dd/mm/yyyy in Vietnam time; null for an unreadable value. */
export function vnDateCopy(value) {
  const time = Date.parse(textOf(value));
  return Number.isFinite(time) ? VN_DATE.format(new Date(time)) : null;
}

const RESUME_LABELS = {
  speaking: 'Speaking', reading: 'Reading', listening: 'Listening', dictation: 'Chép chính tả',
};

export function resumeKindCopy(kind) {
  return RESUME_LABELS[kind] || '';
}

/**
 * The rows of FR-022's block, from rows already normalized by
 * `my-class-model` (a row the class boundary refused is null and dropped).
 * Overdue uses the server's rule: missing, or the deadline has passed. The
 * server already sorted (overdue first, then nearest deadline) and capped.
 */
export function assignedRows(rows, now = Date.now()) {
  return rows.filter(Boolean).map((row) => {
    const due = Date.parse(row.assignment?.dueAt || '');
    return { row, overdue: Boolean(row.isMissing) || (Number.isFinite(due) && due < now) };
  });
}

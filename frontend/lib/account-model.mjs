// Pure helpers for /account (LEARNERCORE-0063 FR-060, FR-087).
//
// The page only prints what G04 returns: course rows from `GET /api/me/courses`,
// the credit history from `GET /api/me/credits` (labels are the server's
// `label_vi`, the balance column is the server's `balance_after`). Nothing here
// adds or subtracts credits, and nothing invents a value G04 did not send: a
// missing field means the line is left out, never a 0 or a dash.

const VN_DATE = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/** dd/mm/yyyy in Vietnam time, or null for a missing or unreadable value. */
export function formatVnDate(iso) {
  if (typeof iso !== 'string' || !iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return VN_DATE.format(new Date(ms));
}

const int = (v) => (Number.isInteger(v) ? v : null);

function normalizeCourse(row) {
  if (!row || typeof row !== 'object') return null;
  const credits = row.credits && typeof row.credits === 'object' ? row.credits : {};
  return {
    code: typeof row.course_code === 'string' ? row.course_code : '',
    title: String(row.title || row.short_title || row.course_code || ''),
    kind: row.kind ?? null,
    state: row.state,
    expiresAt: typeof row.expires_at === 'string' ? row.expires_at : null,
    daysLeft: int(row.days_left),
    canRenew: row.can_renew === true,
    renewOrderCode: typeof row.renew_order_code === 'string' ? row.renew_order_code : null,
    balance: int(credits.balance),
    carryBalance: int(credits.carry_balance),
    carryExpiresAt: typeof credits.carry_expires_at === 'string' ? credits.carry_expires_at : null,
  };
}

// Active first (fewest days left first, unlimited last), then expired (most
// recently expired first). Revoked rows are not the learner's any more.
function byUrgency(a, b) {
  const rank = (c) => (c.state === 'active' ? 0 : 1);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (a.state === 'active') {
    const da = a.daysLeft ?? Number.POSITIVE_INFINITY;
    const db = b.daysLeft ?? Number.POSITIVE_INFINITY;
    return da - db;
  }
  return (Date.parse(b.expiresAt || '') || 0) - (Date.parse(a.expiresAt || '') || 0);
}

/**
 * `GET /api/me/courses` → the two groups of /account, or null when the payload
 * is not G04's shape (the API is not there yet, or the read failed).
 */
export function normalizeMyCourses(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items)) return null;
  const rows = raw.items
    .map(normalizeCourse)
    .filter((c) => c && (c.state === 'active' || c.state === 'expired'));
  const credits = raw.credits && typeof raw.credits === 'object' ? raw.credits : {};
  const byKind = credits.by_kind && typeof credits.by_kind === 'object' ? credits.by_kind : {};
  return {
    online: rows.filter((c) => c.kind === 'online').sort(byUrgency),
    // `kind: null` is G04's class membership or a legacy class code: a class
    // course, never an online purchase (online rows always carry `kind`).
    classes: rows.filter((c) => c.kind === 'class' || c.kind === 'repractice' || c.kind === null).sort(byUrgency),
    total: int(credits.total),
    byKind: { online: int(byKind.online), class: int(byKind.class) },
    contentVisibleUntil: typeof raw.content_visible_until === 'string' ? raw.content_visible_until : null,
  };
}

/** "còn N ngày" / "Đã hết hạn ngày …"; null when G04 sent no date to print. */
export function courseTimeLine(course) {
  if (course.state === 'active') {
    if (course.daysLeft === null) return null;
    return course.daysLeft <= 0 ? 'Hết hạn hôm nay' : `Còn ${course.daysLeft} ngày`;
  }
  const date = formatVnDate(course.expiresAt);
  return date ? `Đã hết hạn ngày ${date}` : 'Đã hết hạn';
}

/** The carried-credit line (FR-060); null when nothing was carried. */
export function carryLine(course) {
  if (!course.carryBalance || course.carryBalance <= 0) return null;
  const until = formatVnDate(course.carryExpiresAt);
  return until
    ? `Trong đó ${course.carryBalance} lượt chuyển từ kỳ trước, dùng đến hết ${until}.`
    : `Trong đó ${course.carryBalance} lượt chuyển từ kỳ trước.`;
}

/** FR-087: printed only when G04 set a cut-off date. */
export function contentVisibleLine(courses) {
  const until = formatVnDate(courses?.contentVisibleUntil ?? null);
  return until ? `Bài đã nộp và nhận xét xem được đến hết ${until}.` : null;
}

/** One line per credit source the learner actually has (`credits.by_kind`). */
export function creditSourceLines(courses) {
  const lines = [];
  const { online, class: cls } = courses.byKind;
  if (online !== null && (online > 0 || courses.online.length)) lines.push({ key: 'online', label: 'Từ khoá online', value: online });
  if (cls !== null && (cls > 0 || courses.classes.length)) lines.push({ key: 'class', label: 'Từ khoá của lớp', value: cls });
  return lines;
}

/** `GET /api/me/credits` page → rows to print, or null when unreadable. */
export function normalizeCreditPage(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items)) return null;
  const items = raw.items
    .filter((r) => r && typeof r === 'object' && typeof r.label_vi === 'string' && r.label_vi)
    .map((r) => ({
      at: typeof r.at === 'string' ? r.at : null,
      label: r.label_vi,
      delta: int(r.delta),
      balanceAfter: int(r.balance_after),
    }));
  return { items, nextCursor: typeof raw.next_cursor === 'string' && raw.next_cursor ? raw.next_cursor : null };
}

/** "+4" / "−1" for the change column. */
export function formatDelta(delta) {
  if (delta === null) return '';
  return delta > 0 ? `+${delta}` : delta < 0 ? `−${Math.abs(delta)}` : '0';
}

/**
 * Fallback for the "Khoá của lớp" group while G04 is not there: the learner's
 * classes from `GET /api/class/me?summary=true`. A class whose name could not
 * be read is left out rather than printed as an id.
 */
export function classesFromClassMe(raw) {
  if (!raw || typeof raw !== 'object' || raw.has_class !== true || !Array.isArray(raw.classes)) return [];
  return raw.classes
    .filter((c) => c && typeof c.name === 'string' && c.name.trim())
    .map((c) => ({
      id: String(c.id ?? c.name),
      name: c.name.trim(),
      course: c.course && typeof c.course.name === 'string' && c.course.name.trim() ? c.course.name.trim() : null,
    }));
}

/**
 * True when `/api/class/me` says the learner is in a class but could not name
 * every one (`degraded` contains 'class', a row without a name, or no list):
 * the page must warn instead of printing "Bạn chưa ở lớp nào".
 */
export function classMeIncomplete(raw) {
  if (!raw || typeof raw !== 'object' || raw.has_class !== true) return false;
  if (Array.isArray(raw.degraded) && raw.degraded.includes('class')) return true;
  if (!Array.isArray(raw.classes)) return true;
  return raw.classes.some((c) => !c || typeof c.name !== 'string' || !c.name.trim());
}

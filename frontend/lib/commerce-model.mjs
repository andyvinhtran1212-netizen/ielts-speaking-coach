// PUBLICSITE-0059 §5.3 (G05-T02) — pure helpers over the G04 commerce API
// (types: lib/commerce-types.ts). No fetch, no React: node --test checks them.

/** FR-023: the "trọn bộ" section shows only from this many open courses. */
export const COURSE_BUNDLE_MIN_OPEN = 2;

export const COURSE_ROW_LABELS = Object.freeze({
  open: 'Đang mở đăng ký',
  upcoming: 'Sắp mở',
  // Andy 23/11: a `closed` course reads "Tạm đóng đăng ký", never "Sắp mở".
  closed: 'Tạm đóng đăng ký',
  expired: 'Hết hạn',
});

/**
 * Row state on /courses and the course page (FR-005, FR-008).
 * @param {{ status?: unknown, viewer?: { state?: unknown, days_left?: unknown } | null }} item
 * @returns {'open' | 'upcoming' | 'learning' | 'expired'}
 */
export function courseRowState(item) {
  const viewer = item?.viewer || null;
  if (viewer?.state === 'enrolled') {
    return typeof viewer.days_left === 'number' && viewer.days_left <= 0 ? 'expired' : 'learning';
  }
  if (viewer?.state === 'expired') return 'expired';
  return item?.status === 'open' ? 'open' : 'upcoming';
}

/**
 * The one status label shared by /courses and /courses/[slug].
 * @param {Parameters<typeof courseRowState>[0]} item
 */
export function courseRowLabel(item) {
  const state = courseRowState(item);
  if (state === 'upcoming' && item?.status === 'closed') return COURSE_ROW_LABELS.closed;
  if (state !== 'learning') return COURSE_ROW_LABELS[state];
  const days = item?.viewer?.days_left;
  return typeof days === 'number' ? `Bạn đang học · còn ${days} ngày` : 'Bạn đang học';
}

/**
 * ENROLL-0060 FR-037: which screen of /enroll/[orderCode] an order shows.
 * @param {{ status?: unknown }} order
 * @returns {2 | 3 | 4 | 5 | null} null for an unknown status (render an error, never guess)
 */
export function orderScreen(order) {
  switch (order?.status) {
    case 'awaiting_transfer': return 2;
    case 'transfer_reported':
    case 'needs_info': return 3;
    case 'confirmed': return 4;
    case 'expired':
    case 'cancelled': return 5;
    default: return null;
  }
}

/**
 * Extra blocks an order screen draws (FR-037): the "cần bổ sung" block, the
 * overpaid block of a confirmed order, the cancel reason. Missing fields stay
 * null so the screen hides that line instead of guessing.
 * @param {Record<string, any>} order
 */
export function orderBlocks(order) {
  const status = order?.status;
  const knownKind = ['underpaid', 'not_found', 'other'].includes(order?.info_kind) ? order.info_kind : null;
  return {
    needsInfo: status === 'needs_info'
      ? {
          kind: knownKind,
          receivedVnd: knownKind === 'underpaid' && typeof order.received_vnd === 'number' ? order.received_vnd : null,
          tuitionVnd: knownKind === 'underpaid' && typeof order.tuition_vnd === 'number' ? order.tuition_vnd : null,
          supplementBy: order.supplement_by || null,
          adminMessage: order.admin_message || null,
        }
      : null,
    overpaidVnd: status === 'confirmed' && typeof order.overpaid_vnd === 'number' && order.overpaid_vnd > 0
      ? order.overpaid_vnd : null,
    cancel: status === 'cancelled'
      ? {
          by: order.cancel_reason === 'admin' || order.cancel_reason === 'learner' ? order.cancel_reason : null,
          note: order.cancel_reason === 'admin' ? order.cancel_note || null : null,
        }
      : null,
  };
}

/** ENROLL-0060 FR-037 learner labels. */
export const ORDER_STATUS_LABELS = Object.freeze({
  awaiting_transfer: 'Chờ chuyển khoản',
  transfer_reported: 'Chờ xác nhận',
  needs_info: 'Cần bổ sung',
  confirmed: 'Đã mở khoá',
  expired: 'Hết hạn',
  cancelled: 'Đã huỷ',
});

/**
 * The one next step for an order row on /account/orders.
 * @param {Record<string, any>} order
 * @returns {{ label: string, href: string } | null}
 */
export function nextActionForOrder(order) {
  const code = typeof order?.order_code === 'string' ? order.order_code : null;
  const slug = typeof order?.product?.slug === 'string' ? order.product.slug : null;
  const page = code ? orderHref(code) : null;
  switch (order?.status) {
    case 'awaiting_transfer': return page && { label: 'Chuyển khoản', href: page };
    case 'transfer_reported': return page && { label: 'Xem đơn', href: page };
    case 'needs_info': return page && { label: 'Bổ sung thông tin', href: page };
    case 'confirmed': return { label: 'Vào học', href: '/course' };
    case 'expired':
    case 'cancelled': return slug && { label: 'Tạo đơn mới', href: `/courses/${encodeURIComponent(slug)}/enroll` };
    default: return null;
  }
}

const VND = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });

/**
 * @param {unknown} n
 * @returns {string | null} "1.200.000 đ", or null when there is no amount
 */
export function formatVnd(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return `${VND.format(n)} đ`;
}

/**
 * FR-023: "N khoá đang mở đăng ký · M khoá sắp mở", counted from the data;
 * `closed` courses are counted apart ("K khoá tạm đóng đăng ký").
 * @param {Array<{ status?: unknown }>} items
 */
export function catalogCounts(items) {
  let open = 0;
  let upcoming = 0;
  let closed = 0;
  for (const item of Array.isArray(items) ? items : []) {
    if (item?.status === 'open') open += 1;
    else if (item?.status === 'closed') closed += 1;
    else upcoming += 1;
  }
  return { open, upcoming, closed };
}

/**
 * FR-024 — the one sentence about unused AI credits when a course ends.
 * Both numbers come from G04 (`credit_carry_percent`, `credit_carry_valid_days`);
 * this file holds the wording, never a number. Null or 0 percent: no carry
 * clause, only the expiry sentence. Reused by the order screens (0060 T12).
 * @param {{ credit_carry_percent?: number | null, credit_carry_valid_days?: number | null } | null | undefined} course
 * @returns {string}
 */
export function carryOverSentence(course) {
  const percent = course?.credit_carry_percent;
  const days = course?.credit_carry_valid_days;
  if (typeof percent !== 'number' || !Number.isFinite(percent) || percent <= 0) {
    return 'Lượt chấm AI chưa dùng hết hiệu lực khi khoá hết hạn.';
  }
  const what = percent >= 100 ? 'toàn bộ lượt chưa dùng' : `${Math.round(percent)}% số lượt chưa dùng`;
  const when = typeof days === 'number' && Number.isFinite(days) && days > 0
    ? `, dùng được trong ${Math.round(days)} ngày kể từ ngày kỳ mới bắt đầu`
    : '';
  return `Bạn đăng ký lại khoá này thì ${what} được chuyển sang kỳ mới${when}; không đăng ký lại thì lượt còn lại hết hiệu lực khi khoá hết hạn.`;
}

/**
 * "Đăng ký khoá này" / "Đăng ký lại" target (tasks.md T05): a guest signs in
 * first and comes back to the same enrol step.
 * @param {string} slug @param {boolean} signedIn @returns {string}
 */
export function enrollHref(slug, signedIn) {
  const step = `/courses/${encodeURIComponent(slug)}/enroll`;
  return signedIn ? step : `/login?next=${encodeURIComponent(step)}`;
}

/**
 * A G04 date or timestamp as dd/mm/yyyy in Vietnam time; null when absent or unreadable.
 * A bare date (`2027-01-15`) is that calendar day in Vietnam.
 * @param {string | null | undefined} iso @returns {string | null}
 */
export function formatViDate(iso) {
  if (typeof iso !== 'string' || !iso) return null;
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00+07:00` : iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' });
}

/**
 * A link taken from course data (`preview_href`), kept only when it is a path
 * on this site (CR #2637): starts with one `/`, not `//` or `/\`, no control
 * characters. Anything else (`javascript:`, another host) gives null and the
 * page shows the lesson name as plain text.
 * @param {unknown} raw @returns {string | null}
 */
export function internalHref(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('/')) return null;
  if (raw.startsWith('//') || raw.startsWith('/\\')) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return null;
  return raw;
}

/**
 * Page of one order (ENROLL-0060 FR-036/037, G05-T12a `/enroll/[orderCode]`).
 * The one place that builds the link, so "đơn đang mở" on the course page,
 * the enrol step and the order list all agree with the order route.
 * @param {string} orderCode as G04 returns it (`order.order_code`) @returns {string}
 */
export function orderHref(orderCode) {
  return `/enroll/${encodeURIComponent(orderCode)}`;
}

/** The G04 create-order refusals the enrol step words itself (FR-035). */
const ENROLL_ERRORS = Object.freeze({
  orders_paused: 'Đăng ký khoá đang tạm dừng. Bạn quay lại sau nhé.',
  course_not_found: 'Không tìm thấy khoá học này.',
  course_not_open: 'Khoá này chưa mở đăng ký.',
  already_enrolled: 'Bạn đang học khoá này. Bạn đăng ký lại được khi khoá gần hết hạn.',
  account_suspended: 'Tài khoản đang tạm khoá nên chưa tạo được đơn đăng ký.',
  sign_in_again: 'Vui lòng đăng nhập lại bằng Google hoặc mã gửi qua email.',
  request_key_conflict: 'Yêu cầu này đã dùng cho một khoá khác. Bạn bấm tạo đơn lại nhé.',
});
const ENROLL_RETRY = 'Chưa tạo được đơn đăng ký. Thông tin bạn đã điền vẫn còn, bạn thử lại sau ít phút nhé.';

/**
 * What the enrol step says when creating the order fails (FR-035: the form keeps
 * what was filled in). `final`: retrying the same request cannot help.
 * `newKey`: the next try must carry a fresh request_key.
 * @param {unknown} error thrown by window.api (`.status`, `.detail.error_code`)
 * @returns {{ code: string, message: string, final: boolean, newKey: boolean }}
 */
export function enrollErrorView(error) {
  const e = /** @type {{ status?: unknown, detail?: { error_code?: unknown } | null } | null} */ (error);
  const code = typeof e?.detail?.error_code === 'string' ? e.detail.error_code : '';
  if (code && Object.hasOwn(ENROLL_ERRORS, code)) {
    return {
      code,
      message: ENROLL_ERRORS[/** @type {keyof typeof ENROLL_ERRORS} */ (code)],
      final: code === 'course_not_found' || code === 'course_not_open' || code === 'already_enrolled' || code === 'account_suspended',
      newKey: code === 'request_key_conflict',
    };
  }
  return { code: code || 'unavailable', message: ENROLL_RETRY, final: false, newKey: false };
}

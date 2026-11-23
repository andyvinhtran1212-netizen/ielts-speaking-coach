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
  const orderHref = code ? `/enroll/${encodeURIComponent(code)}` : null;
  switch (order?.status) {
    case 'awaiting_transfer': return orderHref && { label: 'Chuyển khoản', href: orderHref };
    case 'transfer_reported': return orderHref && { label: 'Xem đơn', href: orderHref };
    case 'needs_info': return orderHref && { label: 'Bổ sung thông tin', href: orderHref };
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

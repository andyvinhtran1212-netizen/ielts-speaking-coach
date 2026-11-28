// ENROLL-0060 FR-041 (sheet ThanhToan màn 7): "Đơn đăng ký của tôi".
// Reads G04's `GET /api/enrollment-orders/me` (COURSEACCESS-0055 plan 5.9,
// #2526): `{items: Order[], next_cursor}`, newest first.

/** FR-037: the learner-side status labels. */
export const ORDER_STATUS_LABELS = Object.freeze({
  awaiting_transfer: 'Chờ chuyển khoản',
  transfer_reported: 'Chờ xác nhận',
  needs_info: 'Cần bổ sung',
  confirmed: 'Đã mở khoá',
  expired: 'Hết hạn',
  cancelled: 'Đã huỷ',
});

/** FR-041: exactly one next step per row, by status. */
const NEXT_STEP = Object.freeze({
  awaiting_transfer: { label: 'Tiếp tục thanh toán', target: 'order' },
  transfer_reported: { label: 'Xem trạng thái', target: 'order' },
  needs_info: { label: 'Xem hướng dẫn', target: 'order' },
  confirmed: { label: 'Vào học', target: 'course' },
  expired: { label: 'Xem chi tiết', target: 'order' },
  cancelled: { label: 'Xem chi tiết', target: 'order' },
});

const own = (map, key) => (typeof key === 'string' && Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null);
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

function normalizeOrder(row) {
  if (!row || typeof row !== 'object') return null;
  const code = str(row.order_code);
  if (!code || !own(ORDER_STATUS_LABELS, row.status)) return null;
  const product = row.product && typeof row.product === 'object' ? row.product : {};
  return {
    code,
    status: row.status,
    title: str(product.title) ?? code,
    shortTitle: str(product.short_title),
    tuition: Number.isInteger(row.tuition_vnd) && row.tuition_vnd >= 0 ? row.tuition_vnd : null,
    createdAt: str(row.created_at),
  };
}

/** One page of orders, or null for another shape. Unknown rows are dropped. */
export function normalizeOrderPage(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items)) return null;
  const items = raw.items.map(normalizeOrder).filter(Boolean);
  const next = str(raw.next_cursor);
  return { items, nextCursor: next };
}

export function orderStatusLabel(status) {
  return own(ORDER_STATUS_LABELS, status);
}

/**
 * The row's next step: `{label, href}`. `href` is null when the page it
 * leads to is not live yet (the caller resolves it through liveHref), so the
 * label never points at a planned page.
 */
export function orderNextStep(order, resolve) {
  const step = own(NEXT_STEP, order?.status);
  if (!step) return null;
  const href = step.target === 'order'
    ? resolve(`/enroll/${encodeURIComponent(order.code)}`)
    : resolve('/course') ?? resolve('/home');
  return { label: step.label, href };
}

const VND = new Intl.NumberFormat('vi-VN');
/** "1.200.000 đ", or null. */
export function formatVnd(amount) {
  return Number.isInteger(amount) && amount >= 0 ? `${VND.format(amount)} đ` : null;
}

const VN_DATE = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' });
/** "23/11/2026" in Vietnam time, or null. */
export function orderDateText(iso) {
  if (typeof iso !== 'string') return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? VN_DATE.format(new Date(ms)) : null;
}

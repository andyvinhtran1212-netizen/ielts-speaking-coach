// ENROLL-0060 FR-037…FR-040, FR-055, FR-056 (sheet ThanhToan screens 2–6):
// the order page `/enroll/[orderCode]`. Reads G04's
// `GET /api/enrollment-orders/{code}` (COURSEACCESS-0055 plan 5.9, #2526):
// `{order: Order}`. Pure functions only; the page owns the requests.

export const STATUSES = Object.freeze(['awaiting_transfer', 'transfer_reported', 'needs_info', 'confirmed', 'expired', 'cancelled']);
const INFO_KINDS = Object.freeze(['underpaid', 'not_found', 'other']);

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const int = (v) => (Number.isInteger(v) ? v : null);
const nonNeg = (v) => (Number.isInteger(v) && v >= 0 ? v : null);
const iso = (v) => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null);

function normalizeTransfer(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const accountNo = str(raw.account_no);
  const amount = int(raw.amount_vnd);
  const memo = str(raw.memo);
  if (!accountNo || amount === null || amount <= 0 || !memo) return null;
  return {
    bankName: str(raw.bank_name),
    accountNo,
    accountName: str(raw.account_name),
    amount,
    memo,
    payload: str(raw.vietqr_payload),
  };
}

/** The `Order` of `{order}`, or null for another shape. */
export function normalizeOrder(raw) {
  const o = raw && typeof raw === 'object' && raw.order && typeof raw.order === 'object' ? raw.order : null;
  if (!o) return null;
  const code = str(o.order_code);
  if (!code || !STATUSES.includes(o.status)) return null;
  const product = o.product && typeof o.product === 'object' ? o.product : {};
  return {
    code,
    status: o.status,
    title: str(product.title) ?? code,
    slug: str(product.slug),
    tuition: nonNeg(o.tuition_vnd),
    accessDays: nonNeg(o.access_days),
    aiCredits: nonNeg(o.ai_credits),
    creditValidDays: nonNeg(o.credit_valid_days),
    payBy: iso(o.pay_by),
    createdAt: iso(o.created_at),
    transferReportedAt: iso(o.transfer_reported_at),
    lateTransferReportedAt: iso(o.late_transfer_reported_at),
    confirmedAt: iso(o.confirmed_at),
    infoKind: INFO_KINDS.includes(o.info_kind) ? o.info_kind : null,
    received: nonNeg(o.received_vnd),
    overpaid: nonNeg(o.overpaid_vnd),
    adminMessage: str(o.admin_message),
    supplementBy: iso(o.supplement_by),
    cancelReason: o.cancel_reason === 'learner' || o.cancel_reason === 'admin' ? o.cancel_reason : null,
    cancelNote: str(o.cancel_note),
    cancelledAt: iso(o.cancelled_at),
    entitlementExpiresAt: iso(o.entitlement_expires_at),
    creditsGranted: nonNeg(o.credits_granted),
    transfer: normalizeTransfer(o.transfer),
  };
}

/**
 * FR-037: which screen an order shows. `transfer` (2), `waiting` (3, with
 * the screen-6 block when `needs_info`), `unlocked` (4), `closed` (5).
 */
export function screenFor(order) {
  switch (order?.status) {
    case 'awaiting_transfer': return 'transfer';
    case 'transfer_reported':
    case 'needs_info': return 'waiting';
    case 'confirmed': return 'unlocked';
    case 'expired':
    case 'cancelled': return 'closed';
    default: return null;
  }
}

/** FR-040: only screen 3 asks again. */
export function pollsStatus(order) {
  return screenFor(order) === 'waiting';
}

/** FR-038: "Sao chép" writes the raw value. */
export function rawAccountNo(value) {
  return String(value ?? '').replace(/\s+/g, '');
}
export function rawAmount(value) {
  return String(value ?? '').replace(/\D+/g, '');
}

const VND = new Intl.NumberFormat('vi-VN');
export function vnd(amount) {
  return Number.isInteger(amount) && amount >= 0 ? `${VND.format(amount)} đ` : null;
}

const TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const DATE = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' });
/** "14:30, ngày 23/11/2026" in Vietnam time, or null. */
export function whenText(value) {
  if (!iso(value)) return null;
  const d = new Date(value);
  return `${TIME.format(d)}, ngày ${DATE.format(d)}`;
}
/** "23/11/2026", or null. */
export function dateText(value) {
  return iso(value) ? DATE.format(new Date(value)) : null;
}

/** Hours the order was held (pay_by − created_at), rounded, or null. */
export function holdHours(order) {
  if (!order?.payBy || !order?.createdAt) return null;
  const hours = Math.round((Date.parse(order.payBy) - Date.parse(order.createdAt)) / 3_600_000);
  return hours > 0 ? hours : null;
}

/** Screen 6 numbers for an underpaid order: received, needed, missing. */
export function shortfall(order) {
  if (order?.infoKind !== 'underpaid' || order.received === null || order.tuition === null) return null;
  const missing = order.tuition - order.received;
  return missing > 0 ? { received: order.received, tuition: order.tuition, missing } : null;
}

/**
 * FR-055: the carried credits of this course from `GET /api/me/courses`
 * (`items[].product_slug`, `credits.carry_balance`, `carry_expires_at`).
 * Null when there is nothing carried or the course is not in the list.
 */
export function carryFor(rawCourses, slug) {
  if (!slug || !rawCourses || typeof rawCourses !== 'object' || !Array.isArray(rawCourses.items)) return null;
  const row = rawCourses.items.find((item) => item && typeof item === 'object' && item.product_slug === slug);
  const credits = row?.credits && typeof row.credits === 'object' ? row.credits : null;
  const balance = nonNeg(credits?.carry_balance);
  if (!balance) return null;
  return { balance, until: dateText(credits.carry_expires_at) };
}

/** The sentence of FR-055 for a carry, or null. */
export function carryText(carry) {
  if (!carry) return null;
  return carry.until
    ? `Chuyển từ kỳ trước: ${carry.balance} lượt, dùng đến ${carry.until}`
    : `Chuyển từ kỳ trước: ${carry.balance} lượt`;
}

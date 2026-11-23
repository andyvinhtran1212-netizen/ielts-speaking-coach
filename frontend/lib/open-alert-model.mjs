// ENROLL-0060 FR-060 (G05-T22) — "Báo cho tôi khi mở": pure logic shared by
// OpenAlertToggle and the mail-link unsubscribe on /courses/[slug].
// Kept in a .mjs so `node --test` checks behaviour, not source strings.

// Mirrors backend/routers/course_open_alerts.py `_EMAIL_RE` (the server stays
// the judge; this only lets the form say "Email chưa đúng." before sending).
const EMAIL_RE = /^[^@\s]{1,64}@[^@\s]+\.[^@\s]+$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{1,128}$/;
const HASH_PREFIX = '#bo-nhan=';

export const OPEN_ALERT_COPY = Object.freeze({
  subscribe: 'Báo cho tôi khi mở',
  sending: 'Đang gửi…',
  subscribed: 'Đã đăng ký nhận báo',
  unsubscribe: 'Bỏ nhận',
  emailLabel: 'Email nhận báo',
  guestMailNote: 'Thư sẽ có liên kết bỏ nhận.',
  note: 'Chỉ gửi một thư khi khoá mở đăng ký. Bạn bỏ nhận được bất cứ lúc nào.',
  emailInvalid: 'Email chưa đúng.',
  unavailable: 'Chưa đăng ký nhận báo được lúc này. Bạn thử lại sau ít phút nhé.',
  network: 'Chưa gửi được. Bạn kiểm tra mạng rồi thử lại nhé.',
  unsubscribedNotice: 'Bạn đã bỏ nhận thông báo về khoá này.',
  unsubscribeFailed: 'Chưa bỏ nhận được, thử lại',
  retry: 'Thử lại',
});

/** @param {unknown} value @returns {string} trimmed email, or '' when invalid */
export function normalizeEmail(value) {
  const email = typeof value === 'string' ? value.trim() : '';
  return email.length <= 254 && EMAIL_RE.test(email) ? email : '';
}

/**
 * Token from a mail link hash `#bo-nhan=<token>`; null for any other hash.
 * @param {unknown} hash @returns {string | null}
 */
export function parseUnsubscribeHash(hash) {
  if (typeof hash !== 'string' || !hash.startsWith(HASH_PREFIX)) return null;
  let token;
  try { token = decodeURIComponent(hash.slice(HASH_PREFIX.length)).trim(); } catch { return null; }
  return TOKEN_RE.test(token) ? token : null;
}

/** @param {string} slug */
export function openAlertPath(slug) {
  return `/api/courses/${encodeURIComponent(slug)}/open-alerts`;
}

/**
 * What to show under the field for a rejected call. A server answer carries
 * its own Vietnamese message (detail.message); a thrown fetch has no status.
 * @param {unknown} error
 * @returns {{ message: string, field: boolean }} field: the email is at fault
 */
export function openAlertErrorMessage(error) {
  const e = /** @type {{ status?: unknown, detail?: unknown } | null} */ (error && typeof error === 'object' ? error : null);
  const status = typeof e?.status === 'number' ? e.status : null;
  if (status === null) return { message: OPEN_ALERT_COPY.network, field: false };
  const detail = e?.detail && typeof e.detail === 'object' ? /** @type {Record<string, unknown>} */ (e.detail) : null;
  const code = typeof detail?.error_code === 'string' ? detail.error_code : null;
  const text = typeof detail?.message === 'string' && detail.message ? detail.message : null;
  if (code === 'email_invalid') return { message: text || OPEN_ALERT_COPY.emailInvalid, field: true };
  if (status >= 500 || !text) return { message: OPEN_ALERT_COPY.unavailable, field: false };
  return { message: text, field: false };
}

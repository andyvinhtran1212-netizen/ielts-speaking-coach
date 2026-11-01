// ADMINAAL2-0032 T010 — pure decisions for the admin MFA gate and /admin/mfa.
//
// The backend is the authority: `require_admin` answers 403 `mfa_required` to
// an AAL1 admin while ADMIN_AAL2_ENFORCE is on, and `GET /admin/mfa/status`
// (the only admin route an AAL1 admin may call, FR-004) reports the caller's
// own assurance. These helpers only decide what the browser shows so admin
// data never renders to an admin without AAL2 under enforcement (FR-013).
// Kept as `.mjs` so `node --test` exercises the real behaviour.

export const ADMIN_MFA_PATH = '/admin/mfa';
export const ADMIN_DEFAULT_NEXT = '/admin';

// Backend `services/activation_gate.INACTIVE_DETAIL`, used by both staff guards.
export const INACTIVE_DETAIL = 'Tài khoản chưa được kích hoạt';

// Dispatched by public/js/api.js on an inactive 403 from any call, so a page
// that already rendered can replace its content with the denied state.
export const ACCOUNT_INACTIVE_EVENT = 'aver:account-inactive';

// GoTrue gives no retry time on a 429, so the submit stays disabled this long.
export const MFA_RATE_LIMIT_WAIT_MS = 30_000;

export const ADMIN_MFA_COPY = Object.freeze({
  checking: 'Đang kiểm tra trạng thái xác thực…',
  redirecting: 'Đang chuyển tới xác thực 2 bước…',
  inactive: 'Tài khoản chưa được kích hoạt — liên hệ admin',
  reportOnlyBanner: 'Hãy bật xác thực 2 bước — sắp bắt buộc',
  enrolled: 'Đã bật xác thực 2 bước',
  wrongCode: 'Mã không đúng hoặc đã hết hạn — thử lại',
  rateLimited: 'Thử quá nhiều lần — đợi một lát rồi thử lại',
  network: 'Không kết nối được máy chủ xác thực — kiểm tra mạng rồi bấm Thử lại.',
  needsAal2: 'Cần xác thực lại trước khi gỡ',
  backupWarning: 'Nên thêm một yếu tố dự phòng lưu ngoại tuyến',
  lastFactorRemoved: 'Lần đăng nhập sau sẽ phải thiết lập lại',
  listFailed: '⚠ không tải được danh sách',
  qrAlt: 'Mã QR thiết lập xác thực 2 bước',
});

const AAL = new Set(['aal1', 'aal2']);
const NEXT_STEP = new Set(['none', 'enroll', 'challenge']);

function recordOf(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/** `GET /admin/mfa/status` → `{aal, enforce, verified_factor_count, next_step}` or null. */
export function normalizeAdminMfaStatus(value) {
  const record = recordOf(value);
  if (!record) return null;
  if (!AAL.has(record.aal) || typeof record.enforce !== 'boolean') return null;
  if (!Number.isInteger(record.verified_factor_count) || record.verified_factor_count < 0) return null;
  if (!NEXT_STEP.has(record.next_step)) return null;
  return {
    aal: record.aal,
    enforce: record.enforce,
    verified_factor_count: record.verified_factor_count,
    next_step: record.next_step,
  };
}

/**
 * FR-012: return only to a same-origin path under `/admin/`, `/admin` otherwise.
 * `/admin/mfa` itself is refused so a crafted `next` cannot loop the page.
 */
export function sanitizeAdminNext(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//')) return ADMIN_DEFAULT_NEXT;
  // Backslashes and control characters are normalised differently by browsers.
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return ADMIN_DEFAULT_NEXT;
  let url;
  try { url = new URL(raw, 'https://admin-next.invalid'); } catch { return ADMIN_DEFAULT_NEXT; }
  if (url.origin !== 'https://admin-next.invalid') return ADMIN_DEFAULT_NEXT;
  if (!url.pathname.startsWith('/admin/')) return ADMIN_DEFAULT_NEXT;
  if (url.pathname === ADMIN_MFA_PATH || url.pathname.startsWith(`${ADMIN_MFA_PATH}/`)) return ADMIN_DEFAULT_NEXT;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** `/admin/mfa?next=<path+search>` for the current location. */
export function adminMfaUrl(pathname, search = '') {
  const next = `${typeof pathname === 'string' && pathname ? pathname : ADMIN_DEFAULT_NEXT}${search || ''}`;
  return `${ADMIN_MFA_PATH}?next=${encodeURIComponent(next)}`;
}

export function isAdminMfaPath(pathname) {
  return pathname === ADMIN_MFA_PATH || (typeof pathname === 'string' && pathname.startsWith(`${ADMIN_MFA_PATH}/`));
}

/**
 * AdminAccessGate decision after `/auth/me` and `/admin/mfa/status`.
 *   'denied'   → not an admin
 *   'inactive' → `is_active` is false (normally caught earlier by the phase-0 redirect)
 *   'redirect' → enforced and not satisfied: children never mount
 *   'banner'   → report-only and not satisfied: children render under a banner
 *   'ready'    → satisfied (see `isAdminAssuranceSatisfied`)
 * `is_active: null` means the payload did not report it; the status probe
 * already required an active admin (it answers 403 otherwise).
 */
export function adminGateDecision(identity, status) {
  if (!identity || identity.role !== 'admin') return 'denied';
  if (identity.is_active === false) return 'inactive';
  if (!status) return 'denied';
  if (isAdminAssuranceSatisfied(status)) return 'ready';
  return status.enforce ? 'redirect' : 'banner';
}

/**
 * The backend's `next_step` decides, not the `aal` claim alone: an AAL2
 * session whose TOTP verification is older than 12 hours (or carries no TOTP
 * timestamp) reports `next_step: 'challenge'` and is refused like AAL1.
 */
export function isAdminAssuranceSatisfied(status) {
  return status?.aal === 'aal2' && status.next_step === 'none';
}

/** api.js / FastAPI error with the 403 `{code: "mfa_required"}` detail. */
export function isMfaRequiredError(error) {
  return Boolean(error && error.status === 403 && recordOf(error.detail)?.code === 'mfa_required');
}

/** api.js / FastAPI error for an inactive staff account. */
export function isInactiveError(error) {
  return Boolean(error && error.status === 403 && error.detail === INACTIVE_DETAIL);
}

/**
 * Which part of /admin/mfa to show. The backend status owns the assurance;
 * the factor list owns factor ids.
 */
export function adminMfaMode(status, factors) {
  if (isAdminAssuranceSatisfied(status)) return 'manage';
  return verifiedTotpFactors(factors).length > 0 ? 'challenge' : 'enroll';
}

function factorList(factors) {
  return Array.isArray(factors) ? factors.filter((factor) => recordOf(factor) && typeof factor.id === 'string' && factor.id) : [];
}

export function verifiedTotpFactors(factors) {
  return factorList(factors).filter((factor) => factor.factor_type === 'totp' && factor.status === 'verified');
}

/** Unverified TOTP factors left by an abandoned enrollment; unenrolled before a new enroll. */
export function abandonedTotpFactors(factors) {
  return factorList(factors).filter((factor) => factor.factor_type === 'totp' && factor.status !== 'verified');
}

/**
 * GoTrue refuses a friendly name already used by another factor of the same
 * user (`mfa_factor_name_conflict`), so pick the first free one.
 */
export function nextFactorName(base, factors) {
  const used = new Set(factorList(factors).map((factor) => factor.friendly_name).filter(Boolean));
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) if (!used.has(`${base} ${n}`)) return `${base} ${n}`;
}

/** A 6-digit TOTP code, digits only. */
export function normalizeTotpCode(raw) {
  return String(raw ?? '').replace(/\D/g, '').slice(0, 6);
}

export function isCompleteTotpCode(code) {
  return /^\d{6}$/.test(code);
}

/**
 * Classify a Supabase Auth MFA error.
 *   'wrong_code'   → refused or expired code
 *   'rate_limited' → GoTrue 429
 *   'needs_aal2'   → unenroll refused for an AAL1 session
 *   'network'      → no response, or a retryable 5xx
 *   'other'
 */
export function mfaErrorKind(error) {
  if (!error) return 'other';
  const code = typeof error.code === 'string' ? error.code : '';
  const status = Number(error.status) || 0;
  if (status === 429 || code === 'over_request_rate_limit') return 'rate_limited';
  if (code === 'insufficient_aal') return 'needs_aal2';
  if (code === 'mfa_verification_failed' || code === 'mfa_challenge_expired'
    || code === 'mfa_verification_rejected' || (status === 422 && !code)) return 'wrong_code';
  if (error.name === 'AuthRetryableFetchError' || error.name === 'TypeError' || status === 0 || status >= 500) return 'network';
  return 'other';
}

export function bannerDismissKey(userId) {
  return `aver-admin-mfa-banner-dismissed:${userId}`;
}

/** Vietnam-time date for the factor list (`created_at` from Supabase Auth). */
export function formatFactorDate(value) {
  const date = typeof value === 'string' ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(date);
}

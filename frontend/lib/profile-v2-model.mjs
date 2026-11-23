// Pure helpers for the new Hồ sơ tree (LEARNERCORE-0063 FR-063, FR-064, FR-088).
//
// "Lần đăng nhập gần đây" prints G04-T16's `GET /api/account/login-events`
// rows with the exact sentences of GOI-07 FR-07-064; anything the API does not
// send (or sends with a value we do not know) is left out, never guessed.
// There is no place column: G04 does not store network addresses.

const VN_TIME = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const DEVICE_KIND = Object.freeze({
  desktop: 'Máy tính',
  phone: 'Điện thoại',
  tablet: 'Máy tính bảng',
  unknown: 'Thiết bị khác',
});

const METHOD = Object.freeze({ google: 'Google', email_code: 'Mã qua email' });

export const OUTCOME_TEXT = Object.freeze({
  signed_in: 'Đã đăng nhập',
  pending: 'Chờ chọn thiết bị',
  claimed: 'Đã chuyển sang thiết bị này',
  claim_refused_timed: 'Bị từ chối: bạn đang làm bài có giờ',
  displaced: 'Đã đăng xuất vì đăng nhập ở thiết bị khác',
  signed_out_all: 'Đã đăng xuất khỏi mọi thiết bị',
});

/** "HH:mm, dd/mm/yyyy" in Vietnam time, or null. */
export function formatVnDateTime(iso) {
  if (typeof iso !== 'string' || !iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const part = Object.fromEntries(VN_TIME.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return `${part.hour}:${part.minute}, ${part.day}/${part.month}/${part.year}`;
}

const own = (map, key) => (typeof key === 'string' && Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null);

/**
 * `GET /api/account/login-events?limit=3` → rows to print, or null when the
 * block must be hidden (`enabled=false`, no rows, another shape).
 */
export function loginEventRows(raw) {
  if (!raw || typeof raw !== 'object' || raw.enabled !== true || !Array.isArray(raw.items)) return null;
  const rows = raw.items
    .filter((r) => r && typeof r === 'object')
    .slice(0, 3)
    .map((r) => ({
      device: (typeof r.device_label === 'string' && r.device_label.trim()) || own(DEVICE_KIND, r.device_kind) || DEVICE_KIND.unknown,
      at: formatVnDateTime(r.at),
      method: own(METHOD, r.method),
      outcome: own(OUTCOME_TEXT, r.outcome),
      current: r.is_current === true,
    }));
  return rows.length ? rows : null;
}

/**
 * "Cách đăng nhập đang dùng" from the Supabase user's providers. Never a
 * password: the product has none. Null when the providers cannot be read.
 */
export function signInMethodLine(user) {
  const meta = user && typeof user === 'object' ? user.app_metadata : null;
  const providers = Array.isArray(meta?.providers)
    ? meta.providers
    : typeof meta?.provider === 'string' ? [meta.provider] : null;
  if (!providers) return null;
  return providers.includes('google') ? 'Google hoặc mã qua email' : 'Mã qua email';
}

/** Weekly goal choices of the profile form ("buổi mỗi tuần", FR-088). */
export const WEEKLY_GOALS = Object.freeze(Array.from({ length: 14 }, (_, i) => i + 1));

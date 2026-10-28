const record = (value) => value && typeof value === 'object' && !Array.isArray(value)
  ? value
  : null;

/**
 * Keep login routing fail-closed. The page must not infer activation or
 * onboarding truth from a mutation ACK, a Supabase user, or truthy strings.
 * `/auth/me` is the only canonical profile snapshot.
 */
export function normalizeLoginProfile(value) {
  const row = record(value);
  if (!row
    || typeof row.id !== 'string'
    || !row.id.trim()
    || typeof row.is_active !== 'boolean'
    || typeof row.onboarding_completed !== 'boolean') return null;

  return {
    id: row.id.trim(),
    isActive: row.is_active,
    onboardingCompleted: row.onboarding_completed,
  };
}

export function loginDestination(profile) {
  if (!profile?.isActive) return 'activate';
  if (!profile.onboardingCompleted) return '/onboarding';
  return '/home';
}

export function normalizeAccessCode(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

const ACTIVATION_ERROR_MESSAGES = Object.freeze({
  activate_rate_limited: 'Quá nhiều lần thử kích hoạt. Vui lòng đợi vài phút rồi thử lại.',
  activation_unavailable: 'Chưa kiểm tra được lượt kích hoạt. Mã CHƯA được sử dụng — vui lòng thử lại sau ít phút.',
});

/**
 * Learner-facing text for a refused POST /auth/activate. Known `error_code`s
 * (F09 rate limit 429, fail-closed 503) map to fixed copy; other structured
 * details fall back to their `message`, plain-string details pass through.
 * @param {number} status
 * @param {unknown} payload
 * @returns {string}
 */
export function activationErrorMessage(status, payload) {
  const detail = record(payload)?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  const structured = record(detail);
  const known = structured && ACTIVATION_ERROR_MESSAGES[structured.error_code];
  if (typeof known === 'string') return known;
  if (typeof structured?.message === 'string' && structured.message.trim()) return structured.message;
  return `Kích hoạt thất bại (HTTP ${status}).`;
}

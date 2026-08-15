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

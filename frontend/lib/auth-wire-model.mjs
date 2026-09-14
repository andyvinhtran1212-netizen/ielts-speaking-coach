function recordOf(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function nullableString(value) {
  return value === null || typeof value === 'string';
}

function nullableNumber(value) {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function stringList(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function profileBase(record) {
  return typeof record.id === 'string' && record.id.length > 0
    && nullableString(record.email)
    && nullableString(record.display_name)
    && nullableString(record.avatar_url)
    && typeof record.role === 'string' && record.role.length > 0
    && typeof record.is_active === 'boolean'
    && typeof record.onboarding_completed === 'boolean'
    && nullableNumber(record.target_band)
    && nullableString(record.exam_date)
    && nullableString(record.self_level)
    && stringList(record.preferred_topics);
}

export function normalizeAuthRoleIdentity(value) {
  const record = recordOf(value);
  if (!record) return null;
  return typeof record.id === 'string' && record.id.length > 0
    && nullableString(record.email)
    && typeof record.role === 'string' && record.role.length > 0
    ? { id: record.id, email: record.email, role: record.role }
    : null;
}

export function normalizeAuthMe(value) {
  const record = recordOf(value);
  if (!record || !profileBase(record)) return null;
  if (!stringList(record.permissions)) return null;
  for (const key of [
    'vocab_bank_enabled',
    'd1_enabled',
    'd3_enabled',
    'flashcard_enabled',
    'vocab_curated_enabled',
  ]) {
    if (typeof record[key] !== 'boolean') return null;
  }
  return record;
}

export function normalizeAuthProfile(value) {
  const record = recordOf(value);
  const stats = recordOf(record?.stats);
  if (!record || !stats || !profileBase(record)) return null;
  if (typeof record.timezone !== 'string' || !record.timezone) return null;
  if (!Number.isInteger(record.weekly_goal) || record.weekly_goal < 1) return null;
  if (typeof record.notification_email !== 'boolean') return null;
  if (!nullableString(record.joined_at)) return null;
  if (!Number.isInteger(stats.total_sessions) || stats.total_sessions < 0) return null;
  if (!nullableNumber(stats.avg_band) || !nullableString(stats.joined_at)) return null;
  return record;
}

export function normalizeAuthActiveStatus(value) {
  const record = recordOf(value);
  return record && typeof record.is_active === 'boolean' ? record : null;
}

const record = (value) => value && typeof value === 'object' && !Array.isArray(value)
  ? value
  : null;

export const TARGET_BANDS = Object.freeze(['5.0', '5.5', '6.0', '6.5', '7.0', '7.5', '8.0']);
export const SELF_LEVELS = Object.freeze([
  'beginner',
  'intermediate',
  'upper_intermediate',
  'advanced',
]);
export const FIRST_TOPICS = Object.freeze(['work', 'technology', 'education']);

export function normalizeOnboardingProfile(value) {
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

export function onboardingDestination(profile) {
  if (!profile?.isActive) return '/login';
  if (profile.onboardingCompleted) return '/home';
  return null;
}

function validIsoDate(value) {
  if (value === '') return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function validateOnboardingStep(step, draft) {
  if (step === 1) {
    if (!TARGET_BANDS.includes(String(draft?.targetBand || ''))) {
      return { ok: false, step: 1, error: 'Vui lòng chọn band score mục tiêu.' };
    }
    if (!validIsoDate(draft?.examDate || '')) {
      return { ok: false, step: 1, error: 'Ngày thi dự kiến không hợp lệ.' };
    }
  }
  if (step === 2 && !SELF_LEVELS.includes(draft?.selfLevel)) {
    return { ok: false, step: 2, error: 'Vui lòng chọn trình độ của bạn.' };
  }
  if (step === 3 && !FIRST_TOPICS.includes(draft?.topic)) {
    return { ok: false, step: 3, error: 'Vui lòng chọn ít nhất một chủ đề.' };
  }
  return { ok: true };
}

export function buildOnboardingPayload(draft) {
  for (const step of [1, 2, 3]) {
    const result = validateOnboardingStep(step, draft);
    if (!result.ok) return result;
  }
  return {
    ok: true,
    payload: {
      target_band: Number(draft.targetBand),
      exam_date: draft.examDate || null,
      self_level: draft.selfLevel,
      preferred_topics: [draft.topic],
      onboarding_completed: true,
    },
  };
}

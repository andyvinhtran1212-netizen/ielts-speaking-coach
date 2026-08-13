const STATUSES = new Set(['draft', 'published', 'archived']);
const EXERCISE_TYPES = ['dictation', 'gist', 'true_false', 'mcq'];

const objectOf = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const textOf = (value) => typeof value === 'string' ? value.trim() : '';
const nullableText = (value) => textOf(value) || null;
const finiteNumber = (value) => value === null || value === undefined || value === '' || typeof value === 'boolean'
  ? null
  : Number.isFinite(Number(value)) ? Number(value) : null;
const integer = (value) => {
  const number = finiteNumber(value);
  return number != null && Number.isInteger(number) ? number : null;
};

export const LISTENING_STATUS_LABEL = Object.freeze({
  all: 'Tất cả', draft: 'Bản nháp', published: 'Đã phát hành', archived: 'Đã lưu trữ',
});

export const LISTENING_EXERCISE_LABEL = Object.freeze({
  dictation: 'Dictation', gist: 'Gist', true_false: 'T/F', mcq: 'MCQ',
});

export function normalizeListeningContentFilters(input = {}) {
  const status = STATUSES.has(input.status) ? input.status : 'all';
  const page = integer(input.page);
  return { status, page: page != null && page >= 1 ? page : 1 };
}

export function listeningContentListHref(status = 'all', page = 1) {
  const filters = normalizeListeningContentFilters({ status, page });
  const query = new URLSearchParams();
  if (filters.status !== 'all') query.set('status', filters.status);
  if (filters.page > 1) query.set('page', String(filters.page));
  return `/admin/listening${query.size ? `?${query}` : ''}`;
}

export function normalizeListeningContentItem(raw) {
  const value = objectOf(raw);
  const id = textOf(value?.id);
  const status = textOf(value?.status);
  if (!value || !id || !STATUSES.has(status)) return null;
  const section = integer(value.ielts_section);
  const sectionNum = integer(value.section_num);
  const duration = finiteNumber(value.audio_duration_seconds);
  return {
    id,
    title: textOf(value.title) || id,
    status,
    sourceType: nullableText(value.source_type),
    accent: nullableText(value.accent_tag),
    cefr: nullableText(value.cefr_level),
    ieltsSection: section != null && section >= 1 && section <= 4 ? section : null,
    sectionNum: sectionNum != null && sectionNum >= 1 && sectionNum <= 4 ? sectionNum : null,
    durationSeconds: duration != null && duration >= 0 ? duration : null,
    audioStoragePath: nullableText(value.audio_storage_path),
    topicTags: Array.isArray(value.topic_tags) ? value.topic_tags.map(textOf).filter(Boolean) : [],
    isPremium: value.is_premium === true,
    createdAt: nullableText(value.created_at),
    updatedAt: nullableText(value.updated_at),
  };
}

export function normalizeListeningContentList(raw, expected = {}) {
  const value = objectOf(raw);
  if (!value || !Array.isArray(value.items)) return null;
  const limit = integer(value.limit);
  const offset = integer(value.offset);
  const total = integer(value.total);
  if (limit == null || limit < 1 || limit > 100 || offset == null || offset < 0 || total == null || total < 0) return null;
  if (expected.limit != null && limit !== expected.limit) return null;
  if (expected.offset != null && offset !== expected.offset) return null;
  if (value.items.length > limit || (value.items.length && total < offset + value.items.length)) return null;
  const rows = [];
  let malformedCount = 0;
  for (const item of value.items) {
    const row = normalizeListeningContentItem(item);
    if (row && (!expected.status || expected.status === 'all' || row.status === expected.status)) rows.push(row);
    else malformedCount += 1;
  }
  return { rows, malformedCount, limit, offset, total };
}

export function normalizeListeningExerciseCoverage(raw, contentId) {
  const value = objectOf(raw);
  if (!value || !Array.isArray(value.exercises)) return null;
  const byType = new Map();
  let malformedCount = 0;
  let duplicateCount = 0;
  for (const candidate of value.exercises) {
    const row = objectOf(candidate);
    const type = textOf(row?.exercise_type);
    const status = textOf(row?.status);
    const owner = textOf(row?.content_id);
    if (!row || !EXERCISE_TYPES.includes(type) || !STATUSES.has(status) || owner !== contentId) {
      malformedCount += 1;
      continue;
    }
    if (byType.has(type)) {
      duplicateCount += 1;
      continue;
    }
    byType.set(type, status);
  }
  return {
    items: EXERCISE_TYPES.map((type) => ({ type, status: byType.get(type) || null })),
    readyCount: EXERCISE_TYPES.filter((type) => byType.get(type) === 'published').length,
    presentCount: byType.size,
    malformedCount,
    duplicateCount,
  };
}

export function listeningAudioState(row) {
  if (row?.audioStoragePath && row?.durationSeconds != null) return 'ready';
  if (row?.sourceType === 'ai_elevenlabs' && row?.status === 'archived') return 'failed';
  if (row?.sourceType === 'ai_elevenlabs' && !row?.audioStoragePath) return 'rendering';
  return 'missing';
}

export function formatListeningDuration(seconds) {
  const value = finiteNumber(seconds);
  if (value == null || value < 0) return '—';
  const rounded = Math.round(value);
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return minutes ? `${minutes}:${String(remainder).padStart(2, '0')}` : `${remainder}s`;
}

export function formatListeningContentDate(value) {
  const raw = textOf(value);
  if (!raw) return '—';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

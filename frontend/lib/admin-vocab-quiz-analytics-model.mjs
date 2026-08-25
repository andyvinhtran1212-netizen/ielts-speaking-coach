const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const isString = (value) => typeof value === 'string';
const isNullableString = (value) => value == null || isString(value);
const isCount = (value) => Number.isInteger(value) && value >= 0;
const isRatio = (value) => value == null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1);

export const QUIZ_SCOPES = ['vocab', 'course'];

export function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

export function normalizeQuizStudentRollup(value) {
  if (!isObject(value) || !isObject(value.overview) || !Array.isArray(value.students)) return null;
  const overview = value.overview;
  if (!isCount(overview.active_learners)
    || !isCount(overview.total_sessions)
    || !isCount(overview.total_time_sec)
    || !isCount(overview.total_words_mastered)
    || !isRatio(overview.avg_accuracy)) return null;
  const students = value.students.map((row) => {
    if (!isObject(row)
      || !isUuid(row.user_id)
      || !isString(row.name)
      || !isString(row.email)
      || !isCount(row.sessions)
      || !isCount(row.graded_sessions)
      || !isCount(row.time_sec)
      || !isRatio(row.avg_accuracy)
      || !isCount(row.words_mastered)
      || !isNullableString(row.last_active)) return null;
    return {
      userId: row.user_id,
      name: row.name,
      email: row.email,
      sessions: row.sessions,
      gradedSessions: row.graded_sessions,
      timeSec: row.time_sec,
      avgAccuracy: row.avg_accuracy,
      wordsMastered: row.words_mastered,
      lastActive: row.last_active ?? '',
    };
  }).filter(Boolean);
  return {
    overview: {
      activeLearners: overview.active_learners,
      totalSessions: overview.total_sessions,
      totalTimeSec: overview.total_time_sec,
      totalWordsMastered: overview.total_words_mastered,
      avgAccuracy: overview.avg_accuracy,
    },
    students,
  };
}

export function normalizeQuizStudentDetail(value, expectedUserId) {
  if (!isObject(value) || !isObject(value.user) || !Array.isArray(value.banks) || !Array.isArray(value.recent_sessions)) return null;
  if (value.user.user_id !== expectedUserId || !isString(value.user.name) || !isString(value.user.email)) return null;
  const banks = value.banks.map((row) => {
    if (!isObject(row)
      || !isUuid(row.bank_id)
      || !isNullableString(row.code)
      || !isNullableString(row.title)
      || !isNullableString(row.skill_area)
      || !(row.words_count == null || isCount(row.words_count))
      || !isCount(row.mastered)
      || !isCount(row.in_progress)) return null;
    return {
      bankId: row.bank_id,
      code: row.code ?? '',
      title: row.title ?? '',
      skillArea: row.skill_area ?? '',
      wordsCount: row.words_count,
      mastered: row.mastered,
      inProgress: row.in_progress,
    };
  }).filter(Boolean);
  const recentSessions = value.recent_sessions.map((row) => {
    if (!isObject(row)
      || !isNullableString(row.code)
      || !isRatio(row.accuracy)
      || !isCount(row.words_mastered)
      || !isCount(row.total_questions)
      || !isCount(row.total_correct)
      || !(row.duration_sec == null || isCount(row.duration_sec))
      || !isNullableString(row.ended_at)
      || !isNullableString(row.ended_by)) return null;
    return {
      code: row.code ?? '',
      accuracy: row.accuracy,
      wordsMastered: row.words_mastered,
      totalQuestions: row.total_questions,
      totalCorrect: row.total_correct,
      // duration_sec is nullable for sessions created before they are finalized.
      // The canonical service deliberately includes those rows in drill-down.
      durationSec: row.duration_sec ?? 0,
      endedAt: row.ended_at ?? '',
      endedBy: row.ended_by ?? '',
    };
  }).filter(Boolean);
  return { user: { userId: expectedUserId, name: value.user.name, email: value.user.email }, banks, recentSessions };
}

export function normalizeQuizBanks(value, expectedScope) {
  if (!Array.isArray(value) || !QUIZ_SCOPES.includes(expectedScope)) return null;
  return value.map((row) => {
    if (!isObject(row)
      || !isUuid(row.id)
      || !isNullableString(row.topic_id)
      || !isString(row.code)
      || !isNullableString(row.title)
      || row.skill_area !== expectedScope
      || !isCount(row.words_count)
      || !isNullableString(row.source)
      || !(typeof row.version === 'string' || typeof row.version === 'number')
      || typeof row.is_published !== 'boolean'
      || !isNullableString(row.updated_at)) return null;
    return { id: row.id, code: row.code, title: row.title ?? '', wordsCount: row.words_count, published: row.is_published };
  }).filter(Boolean);
}

function normalizeErrorRows(rows, key) {
  if (!Array.isArray(rows)) return null;
  return rows.map((row) => {
    if (!isObject(row)
      || !isString(row[key])
      || !isCount(row.total)
      || !isCount(row.wrong)
      || !isRatio(row.error_rate)
      || row.wrong > row.total) return null;
    return { label: row[key], total: row.total, wrong: row.wrong, errorRate: row.error_rate };
  }).filter(Boolean);
}

export function normalizeQuizBankAnalytics(value) {
  if (!isObject(value) || !isCount(value.session_count)) return null;
  const items = normalizeErrorRows(value.items, 'item_key');
  const skills = normalizeErrorRows(value.skills, 'skill');
  return items && skills ? { items, skills, sessionCount: value.session_count } : null;
}

export function quizScopeQuery(scope) {
  return QUIZ_SCOPES.includes(scope) ? `skill_area=${encodeURIComponent(scope)}` : null;
}

export function formatDuration(seconds) {
  if (!isCount(seconds)) return '—';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours) return `${hours}h${minutes ? ` ${minutes}m` : ''}`;
  if (minutes) return `${minutes}m`;
  return `${seconds}s`;
}

export function formatRatio(value) {
  return isRatio(value) && value != null ? `${Math.round(value * 100)}%` : '—';
}

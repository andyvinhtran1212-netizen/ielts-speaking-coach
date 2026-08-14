const STATUS_SET = new Set(['all', 'submitted', 'in_progress', 'abandoned']);
const ROW_STATUS_SET = new Set(['submitted', 'in_progress', 'abandoned']);
const TYPE_SET = new Set(['all', 'full', 'mini', 'drill', 'practice']);
const ROW_TYPE_SET = new Set(['full', 'mini', 'drill', 'practice']);
const LOOKUP_TABLES = new Set(['users', 'listening_tests']);

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
const scalarText = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
};

export const LISTENING_ATTEMPT_STATUS_LABEL = Object.freeze({
  all: 'Mọi trạng thái', submitted: 'Đã nộp', in_progress: 'Đang làm', abandoned: 'Bỏ dở',
});

export const LISTENING_ATTEMPT_TYPE_LABEL = Object.freeze({
  all: 'Mọi loại', full: 'Full test', mini: 'Lesson / Mini', drill: 'Skill drill', practice: 'Luyện nhanh',
});

export function normalizeListeningAttemptFilters(input = {}) {
  const status = STATUS_SET.has(input.status) ? input.status : 'all';
  const type = TYPE_SET.has(input.type) ? input.type : 'all';
  const user = textOf(input.user).slice(0, 120);
  const test = textOf(input.test).slice(0, 120);
  const attempt = textOf(input.attempt).slice(0, 100);
  const page = integer(input.page);
  return { user, test, type, status, page: page != null && page >= 1 ? page : 1, attempt };
}

export function listeningAttemptsHref(input = {}) {
  const filters = normalizeListeningAttemptFilters(input);
  const query = new URLSearchParams();
  if (filters.user) query.set('user', filters.user);
  if (filters.test) query.set('test', filters.test);
  if (filters.type !== 'all') query.set('type', filters.type);
  if (filters.status !== 'all') query.set('status', filters.status);
  if (filters.page > 1) query.set('page', String(filters.page));
  if (filters.attempt) query.set('attempt', filters.attempt);
  return `/admin/listening/attempts${query.size ? `?${query}` : ''}`;
}

export function listeningAttemptsRollbackHref(input = {}) {
  const filters = normalizeListeningAttemptFilters(input);
  const query = new URLSearchParams();
  if (filters.user) query.set('user', filters.user);
  return `/pages/admin/listening/attempts.html${query.size ? `?${query}` : ''}`;
}

function normalizeLookupState(value) {
  const raw = Array.isArray(value?.association_lookup_failures)
    ? value.association_lookup_failures.map(textOf).filter(Boolean)
    : [];
  if (raw.some((table) => !LOOKUP_TABLES.has(table))) return null;
  const failures = [...new Set(raw)].sort();
  const failed = value?.association_lookup_failed === true;
  if (typeof value?.association_lookup_failed !== 'boolean' || failed !== Boolean(failures.length)) return null;
  return { associationLookupFailed: failed, associationLookupFailures: failures };
}

function normalizeIdentity(raw, kind) {
  const value = objectOf(raw);
  const id = textOf(value?.id);
  if (!value || !id) return null;
  if (kind === 'user') return { id, email: nullableText(value.email), displayName: nullableText(value.display_name) };
  const type = nullableText(value.test_type);
  if (type && !ROW_TYPE_SET.has(type)) return null;
  return { id, testId: nullableText(value.test_id), title: nullableText(value.title), type };
}

export function normalizeListeningAttemptItem(raw) {
  const value = objectOf(raw);
  const id = textOf(value?.id);
  const status = textOf(value?.status);
  const score = integer(value?.score);
  const totalQuestions = integer(value?.total_questions);
  const accuracy = finiteNumber(value?.accuracy);
  const durationSeconds = finiteNumber(value?.duration_seconds);
  const user = normalizeIdentity(value?.user, 'user');
  const test = normalizeIdentity(value?.test, 'test');
  if (!value || !id || !ROW_STATUS_SET.has(status) || !user || !test
    || (score != null && score < 0) || (totalQuestions != null && totalQuestions < 1)
    || (score != null && totalQuestions != null && score > totalQuestions)
    || (accuracy != null && (accuracy < 0 || accuracy > 1))
    || (durationSeconds != null && durationSeconds < 0)) return null;
  const graded = score != null && totalQuestions != null;
  if ((score == null) !== (totalQuestions == null) || (graded !== (accuracy != null))) return null;
  if (graded && Math.abs(accuracy - Math.round((score / totalQuestions) * 10000) / 10000) > 0.00001) return null;
  return {
    id, status, score, totalQuestions, accuracy, durationSeconds, user, test,
    startedAt: nullableText(value.started_at), submittedAt: nullableText(value.submitted_at),
    createdAt: nullableText(value.created_at),
  };
}

export function normalizeListeningAttemptList(raw, expected = {}) {
  const value = objectOf(raw);
  const lookup = normalizeLookupState(value);
  if (!value || !lookup || !Array.isArray(value.items)) return null;
  const limit = integer(value.limit);
  const offset = integer(value.offset);
  const total = integer(value.total);
  if (limit == null || limit < 1 || limit > 200 || offset == null || offset < 0 || total == null || total < 0) return null;
  if (expected.limit != null && limit !== expected.limit) return null;
  if (expected.offset != null && offset !== expected.offset) return null;
  if (value.items.length > limit || (value.items.length && total < offset + value.items.length)) return null;
  const rows = [];
  let malformedCount = 0;
  const testLookupFailed = lookup.associationLookupFailures.includes('listening_tests');
  for (const candidate of value.items) {
    const row = normalizeListeningAttemptItem(candidate);
    // The backend resolves test_type before querying attempts. If the later
    // presentation join fails, a null joined type must not erase rows that the
    // canonical filter already selected; the visible lookup warning carries
    // that uncertainty instead.
    const typeMatches = !expected.type || expected.type === 'all' || testLookupFailed || row?.test.type === expected.type;
    const statusMatches = !expected.status || expected.status === 'all' || row?.status === expected.status;
    if (row && typeMatches && statusMatches) rows.push(row);
    else malformedCount += 1;
  }
  return { rows, malformedCount, limit, offset, total, ...lookup };
}

function normalizeQuestion(raw) {
  const value = objectOf(raw);
  const qNum = integer(value?.q_num);
  if (!value || qNum == null || qNum < 1 || typeof value.correct !== 'boolean') return null;
  if (value.trap_caught != null && typeof value.trap_caught !== 'boolean') return null;
  if (value.trap_missed != null && typeof value.trap_missed !== 'boolean') return null;
  if (value.trap_caught === true && value.trap_missed === true) return null;
  const userAnswer = scalarText(value.user_answer);
  const expected = scalarText(value.expected);
  if (value.user_answer != null && userAnswer == null) return null;
  if (value.expected != null && expected == null) return null;
  return { qNum, correct: value.correct, userAnswer, expected, trapCaught: value.trap_caught === true, trapMissed: value.trap_missed === true };
}

export function normalizeListeningAttemptDetail(raw, expectedId) {
  const value = objectOf(raw);
  const base = normalizeListeningAttemptItem(value);
  const lookup = normalizeLookupState(value);
  if (!base || base.id !== expectedId || !lookup || !Array.isArray(value.grading_details)) return null;
  const questions = [];
  const questionNumbers = new Set();
  let malformedQuestionCount = 0;
  for (const candidate of value.grading_details) {
    const row = normalizeQuestion(candidate);
    if (row && !questionNumbers.has(row.qNum)) {
      questionNumbers.add(row.qNum);
      questions.push(row);
    }
    else malformedQuestionCount += 1;
  }
  questions.sort((left, right) => left.qNum - right.qNum);
  const mechanism = objectOf(objectOf(value.trap_analytics)?.trap_mechanism);
  const caught = integer(mechanism?.caught);
  const missed = integer(mechanism?.missed);
  if (mechanism && (caught == null || caught < 0 || missed == null || missed < 0)) return null;
  const trapSummary = mechanism ? { caught, missed } : null;
  const band = finiteNumber(value.band_estimate);
  if (value.band_estimate != null && (band == null || band < 0 || band > 9)) return null;
  const bandEstimate = band != null && band >= 0 && band <= 9 ? band : null;
  return { ...base, ...lookup, questions, malformedQuestionCount, trapSummary, bandEstimate };
}

export function formatListeningAttemptDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

export function formatListeningAttemptDuration(value) {
  if (value == null || !Number.isFinite(Number(value)) || Number(value) < 0) return '—';
  const seconds = Math.round(Number(value));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes ? `${minutes} phút ${remainder} giây` : `${remainder} giây`;
}

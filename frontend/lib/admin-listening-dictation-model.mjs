const LOOKUP_TABLES = new Set(['users']);

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

export function normalizeDictationReportFilters(input = {}) {
  const page = integer(input.page);
  return {
    user: textOf(input.user).slice(0, 120),
    test: textOf(input.test).slice(0, 120),
    page: page != null && page >= 1 ? page : 1,
    session: textOf(input.session).slice(0, 100),
  };
}

export function dictationReportsHref(input = {}) {
  const filters = normalizeDictationReportFilters(input);
  const query = new URLSearchParams();
  if (filters.user) query.set('user', filters.user);
  if (filters.test) query.set('test', filters.test);
  if (filters.page > 1) query.set('page', String(filters.page));
  if (filters.session) query.set('session', filters.session);
  return `/admin/listening/dictation${query.size ? `?${query}` : ''}`;
}

export function dictationReportsRollbackHref(input = {}) {
  const filters = normalizeDictationReportFilters(input);
  const query = new URLSearchParams();
  if (filters.user) query.set('user', filters.user);
  return `/pages/admin/listening/dictation-reports.html${query.size ? `?${query}` : ''}`;
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

function normalizeUser(raw) {
  const value = objectOf(raw);
  const id = textOf(value?.id);
  return value && id ? { id, email: nullableText(value.email), displayName: nullableText(value.display_name) } : null;
}

export function normalizeDictationReportItem(raw) {
  const value = objectOf(raw);
  const id = textOf(value?.id);
  const user = normalizeUser(value?.user);
  const totalSentences = integer(value?.total_sentences);
  const correctCount = integer(value?.correct_count);
  const accuracy = finiteNumber(value?.accuracy);
  const sectionNumber = integer(value?.section_num);
  const durationSeconds = finiteNumber(value?.total_time_seconds);
  if (!value || !id || !user || totalSentences == null || totalSentences < 0
    || correctCount == null || correctCount < 0 || correctCount > totalSentences
    || accuracy == null || accuracy < 0 || accuracy > 1
    || (sectionNumber != null && sectionNumber < 1)
    || (durationSeconds != null && durationSeconds < 0)) return null;
  return {
    id, user, totalSentences, correctCount, accuracy, sectionNumber, durationSeconds,
    testId: nullableText(value.test_id_external), sectionTitle: nullableText(value.section_title),
    completedAt: nullableText(value.completed_at), createdAt: nullableText(value.created_at),
  };
}

export function normalizeDictationReportList(raw, expected = {}) {
  const value = objectOf(raw);
  const lookup = normalizeLookupState(value);
  const limit = integer(value?.limit);
  const offset = integer(value?.offset);
  const total = integer(value?.total);
  if (!value || !lookup || !Array.isArray(value.items)
    || limit == null || limit < 1 || limit > 100 || offset == null || offset < 0
    || total == null || total < 0 || value.items.length > limit
    || (value.items.length > 0 && total < offset + value.items.length)) return null;
  if (expected.limit != null && limit !== expected.limit) return null;
  if (expected.offset != null && offset !== expected.offset) return null;
  const rows = [];
  let malformedCount = 0;
  for (const candidate of value.items) {
    const row = normalizeDictationReportItem(candidate);
    if (row) rows.push(row); else malformedCount += 1;
  }
  return { rows, malformedCount, limit, offset, total, ...lookup };
}

function normalizeWordRows(raw, key) {
  if (!Array.isArray(raw)) return null;
  const rows = [];
  const seen = new Set();
  let malformedCount = 0;
  for (const candidate of raw) {
    const value = objectOf(candidate);
    const label = textOf(value?.[key]);
    const count = integer(value?.count);
    const folded = label.toLocaleLowerCase('vi-VN');
    if (!value || !label || label.length > 200 || count == null || count < 1 || seen.has(folded)) {
      malformedCount += 1;
      continue;
    }
    seen.add(folded); rows.push({ label, count });
  }
  return { rows, malformedCount };
}

export function normalizeDictationAggregate(raw) {
  const value = objectOf(raw);
  const sessionCount = integer(value?.session_count);
  const meanAccuracy = finiteNumber(value?.mean_accuracy);
  const missed = normalizeWordRows(value?.top_missed, 'word');
  const wrong = normalizeWordRows(value?.top_wrong, 'expected');
  if (!value || sessionCount == null || sessionCount < 0 || meanAccuracy == null
    || meanAccuracy < 0 || meanAccuracy > 1 || !missed || !wrong
    || (sessionCount === 0 && (meanAccuracy !== 0 || missed.rows.length || wrong.rows.length))) return null;
  return {
    sessionCount, meanAccuracy, topMissed: missed.rows, topWrong: wrong.rows,
    malformedWordCount: missed.malformedCount + wrong.malformedCount,
  };
}

function normalizeSentence(raw) {
  const value = objectOf(raw);
  const index = integer(value?.sentence_idx);
  const score = finiteNumber(value?.score);
  const correctWords = integer(value?.correct_words);
  const totalWords = integer(value?.total_words);
  const listenCount = integer(value?.listen_count);
  const timeSeconds = finiteNumber(value?.time_seconds);
  const ops = objectOf(value?.ops);
  const miss = integer(ops?.miss); const wrong = integer(ops?.wrong); const extra = integer(ops?.extra);
  const reference = textOf(value?.reference);
  if (!value || index == null || index < 0 || !reference || reference.length > 10_000
    || typeof value.user_text !== 'string' || score == null || score < 0 || score > 1
    || correctWords == null || correctWords < 0 || totalWords == null || totalWords < 0 || correctWords > totalWords
    || (listenCount != null && listenCount < 0) || (timeSeconds != null && timeSeconds < 0)
    || !ops || [miss, wrong, extra].some((count) => count == null || count < 0)) return null;
  return {
    index, reference, userText: value.user_text, score, correctWords, totalWords,
    listenCount, timeSeconds, ops: { miss, wrong, extra },
  };
}

export function normalizeDictationReportDetail(raw, expectedId) {
  const value = objectOf(raw);
  const base = normalizeDictationReportItem(value);
  const lookup = normalizeLookupState(value);
  const totalWords = integer(value?.total_words);
  const correctWords = integer(value?.correct_words);
  if (!base || base.id !== expectedId || !lookup || !Array.isArray(value.results)
    || totalWords == null || totalWords < 0 || correctWords == null || correctWords < 0 || correctWords > totalWords) return null;
  const sentences = [];
  const indexes = new Set();
  let malformedSentenceCount = 0;
  for (const candidate of value.results) {
    const row = normalizeSentence(candidate);
    if (row && row.index < base.totalSentences && !indexes.has(row.index)) { indexes.add(row.index); sentences.push(row); }
    else malformedSentenceCount += 1;
  }
  sentences.sort((left, right) => left.index - right.index);
  const missingSentenceCount = Math.max(0, base.totalSentences - sentences.length);
  const counts = objectOf(value.error_trends)?.op_counts;
  const opCounts = objectOf(counts) && ['miss', 'wrong', 'extra'].every((key) => integer(counts[key]) != null && integer(counts[key]) >= 0)
    ? { miss: integer(counts.miss), wrong: integer(counts.wrong), extra: integer(counts.extra) }
    : null;
  return { ...base, ...lookup, totalWords, correctWords, sentences, malformedSentenceCount, missingSentenceCount, opCounts };
}

export function formatDictationReportDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

export function formatDictationDuration(value) {
  if (value == null || !Number.isFinite(Number(value)) || Number(value) < 0) return '—';
  const seconds = Math.round(Number(value));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes ? `${minutes} phút ${remainder} giây` : `${remainder} giây`;
}

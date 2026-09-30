const LOOKUP_TABLES = new Set(['users']);
// Python strip whitespace used by the canonical persisted-counter classifier.
const NON_WHITESPACE_TOKEN = /[^\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/u;

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
  let policy;
  try { policy = normalizeDictationPolicy(value); } catch { return null; }
  const lexical = policy.grading_version === LEXICAL_DICTATION_POLICY;
  if (!value || !id || !user || (lexical && ['total_sentences', 'correct_count', 'accuracy'].some((key) => typeof value[key] !== 'number'))
    || (value.total_sentences != null && (totalSentences == null || totalSentences < 0))
    || (value.correct_count != null && (correctCount == null || correctCount < 0))
    || (correctCount != null && totalSentences != null && correctCount > totalSentences)
    || (value.accuracy != null && (accuracy == null || accuracy < 0 || accuracy > 1))
    || (sectionNumber != null && sectionNumber < 1)
    || (durationSeconds != null && durationSeconds < 0)) return null;
  return {
    id, user, totalSentences, correctCount, accuracy, sectionNumber, durationSeconds,
    gradingVersion: policy.grading_version, referenceSha256: policy.reference_sha256,
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

function normalizeWordRows(raw, key, canonical = false) {
  if (!Array.isArray(raw)) return null;
  const rows = [];
  const seen = new Set();
  let malformedCount = 0;
  for (const candidate of raw) {
    const value = objectOf(candidate);
    // Classified counters already have server-owned keys. Preserve their raw
    // spelling; host trim/case tables can erase or merge valid historical keys.
    const label = canonical ? typeof value?.[key] === 'string' ? value[key] : '' : textOf(value?.[key]);
    const count = integer(value?.count);
    const identity = canonical ? label : label.toLocaleLowerCase('vi-VN');
    if (!value || !label || (canonical && !NON_WHITESPACE_TOKEN.test(label))
        || (!canonical && label.length > 200) || count == null || count < 1 || seen.has(identity)) {
      malformedCount += 1;
      continue;
    }
    seen.add(identity); rows.push({ label, count });
  }
  return { rows, malformedCount };
}

export function normalizeDictationAggregate(raw) {
  const value = objectOf(raw);
  const sessionCount = integer(value?.session_count);
  const meanAccuracy = finiteNumber(value?.mean_accuracy);
  const classified = value?.trend_classification === 'lexical-v1';
  const missed = normalizeWordRows(value?.top_missed, 'word', classified);
  const wrong = normalizeWordRows(value?.top_wrong, 'expected', classified);
  const completeSessions = classified ? integer(value.trend_complete_session_count) : null;
  const unavailableSessions = classified ? integer(value.trend_unavailable_session_count) : null;
  const punctuationMissed = normalizeWordRows(classified ? value.punctuation_missed : [], 'token', classified);
  const punctuationWrong = normalizeWordRows(classified ? value.punctuation_wrong : [], 'token', classified);
  const lexicalLabels = new Set([...(missed?.rows ?? []), ...(wrong?.rows ?? [])].map((row) => row.label));
  const totals = classified ? [value.punctuation_missed_total, value.punctuation_wrong_total,
    value.missing_token_missed_total, value.missing_token_wrong_total].map(integer) : [0, 0, 0, 0];
  let versions = null;
  if (value?.versions !== undefined) {
    if (!Array.isArray(value.versions)) return null;
    versions = value.versions.map((row) => ({ gradingVersion: row?.grading_version,
      sessionCount: integer(row?.session_count), meanAccuracy: finiteNumber(row?.mean_accuracy) }));
    if (versions.some((row) => ![LEGACY_DICTATION_POLICY, LEXICAL_DICTATION_POLICY].includes(row.gradingVersion)
        || row.sessionCount == null || row.sessionCount <= 0 || row.meanAccuracy == null || row.meanAccuracy < 0 || row.meanAccuracy > 1)
        || new Set(versions.map((row) => row.gradingVersion)).size !== versions.length
        || versions.reduce((sum, row) => sum + row.sessionCount, 0) !== sessionCount
        // Both global and per-policy means are rounded to four decimals by
        // the API; two rounding errors can differ by at most 0.0001.
        || (sessionCount > 0 && Math.abs(versions.reduce((sum, row) => sum + row.sessionCount * row.meanAccuracy, 0) / sessionCount - meanAccuracy) > 0.00010001)) return null;
  }
  if (!value || sessionCount == null || sessionCount < 0 || meanAccuracy == null
    || meanAccuracy < 0 || meanAccuracy > 1 || !missed || !wrong
    || !punctuationMissed || !punctuationWrong || totals.some((count) => count == null || count < 0)
    || (classified && (value.mean_accuracy_basis !== 'mean_of_session_sentence_scores'
      || completeSessions == null || unavailableSessions == null || completeSessions < 0 || unavailableSessions < 0
      || completeSessions + unavailableSessions !== sessionCount
      || (completeSessions === 0 && (missed.rows.length || wrong.rows.length || totals.some(Boolean)))
      || punctuationMissed.malformedCount || punctuationWrong.malformedCount
      // The server owns lexical-v1 classification. Browser Unicode tables can
      // recognize newer letters than the grading runtime, so reclassifying a
      // canonical token here would reject valid stored analytics.
      || [...punctuationMissed.rows, ...punctuationWrong.rows].some((row) => lexicalLabels.has(row.label))
      || punctuationMissed.rows.reduce((sum, row) => sum + row.count, 0) > totals[0]
      || punctuationWrong.rows.reduce((sum, row) => sum + row.count, 0) > totals[1]))
    || (sessionCount === 0 && (meanAccuracy !== 0 || missed.rows.length || wrong.rows.length
      || punctuationMissed.rows.length || punctuationWrong.rows.length || totals.some(Boolean)))) return null;
  return {
    sessionCount, meanAccuracy, topMissed: missed.rows, topWrong: wrong.rows,
    versions,
    malformedWordCount: missed.malformedCount + wrong.malformedCount,
    punctuationClassified: classified,
    trendCompleteSessions: completeSessions, trendUnavailableSessions: unavailableSessions,
    punctuationMissed: punctuationMissed.rows, punctuationWrong: punctuationWrong.rows,
    punctuationMissedTotal: totals[0], punctuationWrongTotal: totals[1],
    missingTokenMissedTotal: totals[2], missingTokenWrongTotal: totals[3],
  };
}

function normalizeSentence(raw, policy) {
  const value = objectOf(raw);
  const index = integer(value?.sentence_idx);
  const score = finiteNumber(value?.score);
  const correctWords = integer(value?.correct_words);
  const totalWords = integer(value?.total_words);
  const listenCount = integer(value?.listen_count);
  const timeSeconds = finiteNumber(value?.time_seconds);
  const ops = objectOf(value?.ops);
  const miss = integer(ops?.miss); const wrong = integer(ops?.wrong); const extra = integer(ops?.extra);
  const lexical = policy.grading_version === LEXICAL_DICTATION_POLICY;
  const reference = lexical ? value?.reference : typeof value?.reference === 'string' && value.reference.trim() ? value.reference : null;
  if (!value || index == null || index < 0 || (lexical && !reference) || (reference != null && reference.length > 10_000)
    || (value.reference != null && typeof value.reference !== 'string')
    || typeof value.user_text !== 'string' || (lexical && (score == null || correctWords == null || totalWords == null))
    || (value.score != null && (score == null || score < 0 || score > 1))
    || (value.correct_words != null && (correctWords == null || correctWords < 0))
    || (value.total_words != null && (totalWords == null || totalWords < 0))
    || (correctWords != null && totalWords != null && correctWords > totalWords)
    || (listenCount != null && listenCount < 0) || (timeSeconds != null && timeSeconds < 0)
    || (lexical && !ops) || (ops && [miss, wrong, extra].some((count) => count == null || count < 0))) return null;
  let gradingEvidence = null;
  try {
    if (policy.grading_version === LEXICAL_DICTATION_POLICY) {
      gradingEvidence = normalizeDictationSavedGrade(value, policy,
        { reference, user_text: value.user_text });
      for (const key of ['miss', 'wrong', 'extra']) if (gradingEvidence.diff.filter((op) => op.op === key && !op.filler).length !== ops[key]) return null;
    } else if ((value.grading_version != null && value.grading_version !== LEGACY_DICTATION_POLICY) || value.reference_sha256 != null) normalizeDictationPolicy(value, policy);
  } catch { return null; }
  return {
    index, reference, userText: value.user_text, score, correctWords, totalWords,
    listenCount, timeSeconds, ops: ops ? { miss, wrong, extra } : null,
    gradingEvidence,
  };
}

export function normalizeDictationReportDetail(raw, expectedId) {
  const value = objectOf(raw);
  const base = normalizeDictationReportItem(value);
  const lookup = normalizeLookupState(value);
  const totalWords = integer(value?.total_words);
  const correctWords = integer(value?.correct_words);
  if (!base || base.id !== expectedId || !lookup || !Array.isArray(value.results)
    || (base.gradingVersion === LEXICAL_DICTATION_POLICY && ['total_words', 'correct_words'].some((key) => typeof value[key] !== 'number'))
    || (value.total_words != null && (totalWords == null || totalWords < 0))
    || (value.correct_words != null && (correctWords == null || correctWords < 0))
    || (correctWords != null && totalWords != null && correctWords > totalWords)) return null;
  const sentences = [];
  const indexes = new Set();
  let malformedSentenceCount = 0;
  for (const candidate of value.results) {
    const row = normalizeSentence(candidate, { grading_version: base.gradingVersion, reference_sha256: base.referenceSha256 });
    if (row && (base.totalSentences == null || row.index < base.totalSentences) && !indexes.has(row.index)) { indexes.add(row.index); sentences.push(row); }
    else malformedSentenceCount += 1;
  }
  sentences.sort((left, right) => left.index - right.index);
  const missingSentenceCount = base.totalSentences == null ? null : Math.max(0, base.totalSentences - sentences.length);
  const counts = objectOf(value.error_trends)?.op_counts;
  const opCounts = objectOf(counts) && ['miss', 'wrong', 'extra'].every((key) => integer(counts[key]) != null && integer(counts[key]) >= 0)
    ? { miss: integer(counts.miss), wrong: integer(counts.wrong), extra: integer(counts.extra) }
    : null;
  if (base.gradingVersion === LEXICAL_DICTATION_POLICY && !malformedSentenceCount && missingSentenceCount === 0) {
    if (objectOf(value.error_trends) && Object.prototype.hasOwnProperty.call(value.error_trends, 'op_counts')
        && (!opCounts || ['miss', 'wrong', 'extra'].some((key) => typeof counts[key] !== 'number'))) return null;
    try { verifyReferenceHash(sentences.map((row) => row.reference), { reference_sha256: base.referenceSha256 }); }
    catch { return null; }
    if (!base.totalSentences || sentences.reduce((sum, row) => sum + row.totalWords, 0) !== totalWords
        || sentences.reduce((sum, row) => sum + row.correctWords, 0) !== correctWords
        || sentences.filter((row) => row.score === 1).length !== base.correctCount
        || Math.abs(sentences.reduce((sum, row) => sum + row.score, 0) / base.totalSentences - base.accuracy) > .00005001
        || (opCounts && ['miss', 'wrong', 'extra'].some((key) => sentences.reduce((sum, row) => sum + row.ops[key], 0) !== opCounts[key]))) return null;
  }
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
import { normalizeDictationPolicy, normalizeDictationSavedGrade, verifyReferenceHash, LEGACY_DICTATION_POLICY, LEXICAL_DICTATION_POLICY } from './listening-dictation-controller.mjs';

import { corePlayerUrl } from './core-player-affinity.mjs';
import { coreInputDigest } from './core-operation-intent.mjs';
import { isPureFiller } from './dictation-filler-policy.mjs';

const SAFE_AUDIO_PROTOCOLS = new Set(['https:', 'http:']);
const DICTATION_RENDERERS = new Set(['legacy', 'next']);
export const LEGACY_DICTATION_POLICY = 'legacy-whitespace-v1';
export const LEXICAL_DICTATION_POLICY = 'lexical-v2';
const POLICIES = new Set([LEGACY_DICTATION_POLICY, LEXICAL_DICTATION_POLICY]);
const HASH = /^[0-9a-f]{64}$/;

export function normalizeDictationPolicy(payload, expected = /** @type {any} */ (null)) {
  const version = payload?.grading_version ?? LEGACY_DICTATION_POLICY;
  const hash = payload?.reference_sha256 ?? null;
  if (!POLICIES.has(version) || (hash !== null && (typeof hash !== 'string' || !HASH.test(hash)))
      || (payload?.grading_version == null && hash !== null)
      || (version === LEXICAL_DICTATION_POLICY && hash === null)
      || (expected && (version !== expected.grading_version || hash !== (expected.reference_sha256 ?? null)))) {
    throw new Error('Chính sách hoặc nội dung đã lưu không khớp; hãy tải lại tiến độ.');
  }
  return Object.freeze({ grading_version: version, reference_sha256: hash });
}

export function dictationPolicyAcknowledgement(payload) {
  return normalizeDictationPolicy(payload);
}

export function dictationPolicyLabel(version) {
  return version === LEXICAL_DICTATION_POLICY
    ? 'Chấm từ v2 · dấu câu hiển thị không tính điểm'
    : 'Chấm cũ v1 · điểm đã lưu được giữ nguyên';
}

export function dictationErrorMessage(error) {
  const message = typeof error?.message === 'string' ? error.message : '';
  return /^invalid-dictation-|^dictation-/.test(message)
    ? 'Không xác minh được dữ liệu chấm đã lưu. Hãy tải lại hoặc mở lại liên kết bài.'
    : message;
}

export function dictationStartPolicy(payload) {
  if (!payload || !Array.isArray(payload.new_start_versions) || !Array.isArray(payload.readable_versions)
      || [...payload.new_start_versions, ...payload.readable_versions].some((version) => !POLICIES.has(version))
      || !payload.readable_versions.includes(LEGACY_DICTATION_POLICY)
      || payload.new_start_versions.some((version) => !payload.readable_versions.includes(version))) {
    throw new Error('Không xác minh được chính sách chấm cho lượt mới.');
  }
  if (payload.new_start_versions.includes(LEXICAL_DICTATION_POLICY)) return LEXICAL_DICTATION_POLICY;
  if (payload.new_start_versions.includes(LEGACY_DICTATION_POLICY)) return LEGACY_DICTATION_POLICY;
  throw new Error('Chưa mở lượt chép chính tả mới.');
}

function normalizedSegments(raw, segments) {
  if (typeof raw !== 'string' || !Array.isArray(segments)) throw new Error('invalid-dictation-span-evidence');
  const points = Array.from(raw);
  let cursor = 0;
  const normalized = segments.map((segment) => {
    if (!segment || !['lexical', 'unscored', 'whitespace'].includes(segment.kind)
        || !Number.isInteger(segment.start) || !Number.isInteger(segment.end)
        || segment.start !== cursor || segment.end <= cursor || segment.end > points.length
        || segment.raw !== points.slice(segment.start, segment.end).join('')) {
      throw new Error('invalid-dictation-span-evidence');
    }
    cursor = segment.end;
    return Object.freeze({ ...segment });
  });
  if (cursor !== points.length) throw new Error('invalid-dictation-span-evidence');
  return Object.freeze(normalized);
}

export function verifyReferenceHash(texts, policy) {
  if (policy.reference_sha256 !== null
      && coreInputDigest('dictation-texts-v1\n' + texts.map(coreInputDigest).join('')) !== policy.reference_sha256) {
    throw new Error('invalid-dictation-frozen-reference');
  }
}

function savedSentencePolicy(sentence, parent) {
  // Legacy answer/result rows retain the old wire shape even when a new v1
  // parent has a digest. Their policy comes from that verified parent; no
  // score or diff is recalculated. A supplied stale digest remains an error.
  if (parent.grading_version === LEGACY_DICTATION_POLICY && sentence.reference_sha256 == null
      && (sentence.grading_version == null || sentence.grading_version === LEGACY_DICTATION_POLICY)) return parent;
  return normalizeDictationPolicy(sentence, parent);
}

export function dictationDisplaySegments(grade, side) {
  if (!['reference', 'user'].includes(side) || grade?.grading_version !== LEXICAL_DICTATION_POLICY) return [];
  const segments = grade[`${side}_segments`];
  const spanKey = side === 'reference' ? 'expected_span' : 'actual_span';
  const operations = new Map(grade.diff.filter((op) => op[spanKey]).map((op) => [op[spanKey].segment_index, op]));
  return segments.map((segment, index) => ({ ...segment,
    op: segment.kind === 'lexical' ? operations.get(index)?.op : null,
    filler: operations.get(index)?.filler === true,
  }));
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function boundedRatio(value, code) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) throw new Error(code);
  return number;
}

function safeAudioUrl(value) {
  const raw = text(value);
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
  try {
    const parsed = new URL(raw);
    if (SAFE_AUDIO_PROTOCOLS.has(parsed.protocol)) return parsed.toString();
  } catch {}
  throw new Error('invalid-dictation-audio');
}

export function dictationParams(search) {
  const params = new URLSearchParams(search || '');
  if (['test_id', 'section', 'session_id'].some((key) => params.getAll(key).length > 1)) throw new Error('invalid-dictation-query');
  const sessionId = params.get('session_id');
  if (sessionId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) throw new Error('invalid-dictation-session-id');
  const testId = text(params.get('test_id'));
  if (!testId && !sessionId) throw new Error('missing-dictation-test');
  const rawSection = text(params.get('section'));
  const section = rawSection ? Number(rawSection) : null;
  if (rawSection && (!Number.isInteger(section) || section < 1)) {
    throw new Error('invalid-dictation-section');
  }
  return Object.freeze({ testId, section, ...(sessionId ? { sessionId } : {}) });
}

export function dictationRendererHref(renderer, search) {
  if (!DICTATION_RENDERERS.has(renderer)) throw new Error('invalid-dictation-renderer');
  const params = dictationParams(search);
  return corePlayerUrl('listening_dictation', renderer, {
    test_id: params.testId,
    ...(params.section == null ? {} : { section: params.section }),
  });
}

export function normalizeDictationAttempt(payload) {
  const source = payload?.attempt === null ? null : (payload?.attempt || payload);
  if (source == null) return null;
  if (!source || typeof source !== 'object') throw new Error('invalid-dictation-attempt');
  const attemptId = text(source.attempt_id || source.id);
  const testId = text(source.test_id);
  const sectionNum = Number(source.section_num);
  const status = text(source.status);
  const affinity = source.renderer_affinity ?? null;
  const policy = normalizeDictationPolicy(source);
  if (!attemptId || !testId || !Number.isInteger(sectionNum) || sectionNum < 1
      || status !== 'in_progress' || (affinity !== null && !DICTATION_RENDERERS.has(affinity))) {
    throw new Error('invalid-dictation-attempt');
  }
  const units = (Array.isArray(source.units) ? source.units : []).map((unit) => {
    const unitText = policy.reference_sha256 !== null ? unit?.text : text(unit?.text);
    if (typeof unitText !== 'string' || !unitText.trim()) {
      if (policy.grading_version === LEXICAL_DICTATION_POLICY) throw new Error('invalid-dictation-attempt-units');
      return null;
    }
    const start = Number(unit?.start);
    const end = Number(unit?.end);
    const timing = Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start
      ? Object.freeze({ start, end }) : null;
    const hints = Array.isArray(unit?.hints)
      ? unit.hints.map(text).filter(Boolean).slice(0, 12) : [];
    return Object.freeze({ text: unitText, timing, hints: Object.freeze(hints) });
  }).filter(Boolean);
  if (!units.length) throw new Error('invalid-dictation-attempt-units');
  verifyReferenceHash(units.map((unit) => unit.text), policy);
  const answers = (Array.isArray(source.answers) ? source.answers : []).map((answer) => {
    const sentenceIdx = Number(answer?.sentence_idx);
    if (!Number.isInteger(sentenceIdx) || sentenceIdx < 0) return null;
    if (sentenceIdx >= units.length) throw new Error('invalid-dictation-answer-index');
    const grade = normalizeDictationSavedGrade({
      ...answer,
      ...savedSentencePolicy(answer, policy),
      user_text: answer.user_transcript,
    }, policy, { reference: units[sentenceIdx].text, user_text: answer.user_transcript });
    return Object.freeze({
      ...grade,
      sentence_idx: sentenceIdx,
      user_text: typeof answer.user_transcript === 'string' ? answer.user_transcript : '',
      listen_count: Math.max(0, Number(answer.listen_count) || 0),
      time_seconds: Math.max(0, Number(answer.time_seconds) || 0),
    });
  }).filter(Boolean).sort((a, b) => a.sentence_idx - b.sentence_idx);
  if (new Set(answers.map((answer) => answer.sentence_idx)).size !== answers.length) throw new Error('invalid-dictation-answer-index');
  return Object.freeze({
    attempt_id: attemptId,
    test_id: testId,
    section_num: sectionNum,
    status,
    ...policy,
    renderer_affinity: affinity,
    started_at: text(source.started_at) || null,
    units: Object.freeze(units),
    answers: Object.freeze(answers),
  });
}

export function normalizeDictationBundle(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('invalid-dictation-bundle');
  const id = text(payload.id);
  if (!id) throw new Error('invalid-dictation-id');
  const sections = (Array.isArray(payload.sections) ? payload.sections : []).map((section) => {
    const sectionNum = Number(section?.section_num);
    if (!Number.isInteger(sectionNum) || sectionNum < 1) return null;
    const sentences = (Array.isArray(section?.sentences) ? section.sentences : [])
      .map((sentence) => text(sentence)).filter(Boolean);
    if (!sentences.length) return null;
    const timings = sentences.map((_, index) => {
      const timing = Array.isArray(section.timings) ? section.timings[index] : null;
      const start = Number(timing?.start);
      const end = Number(timing?.end);
      return Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start
        ? Object.freeze({ start, end }) : null;
    });
    const hints = sentences.map((_, index) => (
      Array.isArray(section.hints?.[index])
        ? section.hints[index].map(text).filter(Boolean).slice(0, 12)
        : []
    ));
    return Object.freeze({
      section_num: sectionNum,
      title: text(section.title) || `Section ${sectionNum}`,
      cue_start: Number.isFinite(Number(section.cue_start)) ? Math.max(0, Number(section.cue_start)) : null,
      sentences: Object.freeze(sentences),
      timings: Object.freeze(timings),
      hints: Object.freeze(hints),
    });
  }).filter(Boolean).sort((a, b) => a.section_num - b.section_num);
  if (!sections.length) throw new Error('empty-dictation-sections');
  return Object.freeze({
    id,
    test_id: text(payload.test_id) || id,
    title: text(payload.title) || 'Bài nghe',
    audio_url: safeAudioUrl(payload.audio_url),
    audio_duration_seconds: Math.max(0, finite(payload.audio_duration_seconds)),
    sections: Object.freeze(sections),
  });
}

function normalizedDiff(operations) {
  return operations.map((operation) => {
    const op = text(operation?.op);
    if (!['match', 'miss', 'wrong', 'extra'].includes(op)) return null;
    return Object.freeze({
      ...operation,
      op,
      actual: typeof operation.actual === 'string' ? operation.actual : '',
      expected: typeof operation.expected === 'string' ? operation.expected : '',
      filler: operation.filler === true,
    });
  }).filter(Boolean);
}

export function normalizeDictationGrade(payload, expectedPolicy = /** @type {any} */ (null), expectedText = /** @type {any} */ (null)) {
  if (!payload || typeof payload !== 'object') throw new Error('invalid-dictation-grade');
  const policy = normalizeDictationPolicy(payload, expectedPolicy);
  const score = boundedRatio(payload.score, 'invalid-dictation-score');
  const totalWords = Number(payload.total_words);
  const correctWords = Number(payload.correct_words);
  if (!Number.isInteger(totalWords) || totalWords < 0 || !Number.isInteger(correctWords)
      || correctWords < 0 || correctWords > totalWords || !Array.isArray(payload.diff)) {
    throw new Error('invalid-dictation-grade-counts');
  }
  const diff = normalizedDiff(payload.diff);
  let evidence = {};
  if (policy.grading_version === LEXICAL_DICTATION_POLICY) {
    if (['score', 'total_words', 'correct_words'].some((key) => typeof payload[key] !== 'number')) throw new Error('invalid-dictation-grade-counts');
    if (payload.offset_unit !== 'unicode_codepoint' || !HASH.test(payload.sentence_reference_sha256 || '')
        || typeof payload.reference !== 'string' || coreInputDigest(payload.reference) !== payload.sentence_reference_sha256
        || (expectedText && (payload.reference !== expectedText.reference || payload.user_text !== expectedText.user_text))) {
      throw new Error('invalid-dictation-reference-evidence');
    }
    const referenceSegments = normalizedSegments(payload.reference, payload.reference_segments);
    const userSegments = normalizedSegments(payload.user_text, payload.user_segments);
    if (payload.diff.some((op) => !op || typeof op !== 'object' || Array.isArray(op)
        || !['match', 'miss', 'wrong', 'extra'].includes(op.op)
        || (op.expected != null && typeof op.expected !== 'string')
        || (op.actual != null && typeof op.actual !== 'string')
        || (op.filler != null && typeof op.filler !== 'boolean'))) throw new Error('invalid-dictation-lexical-alignment');
    const referenceWords = referenceSegments.filter((segment) => segment.kind === 'lexical').length;
    const forgivenWords = diff.filter((op) => op.filler && ['miss', 'wrong'].includes(op.op)).length;
    if (!referenceWords || referenceWords - forgivenWords !== totalWords
        || diff.length !== payload.diff.length || diff.filter((op) => op.op === 'match').length !== correctWords) {
      throw new Error('invalid-dictation-lexical-counts');
    }
    // API scores are rounded to four decimals; extras remain error evidence,
    // while the approved score uses matched reference words as numerator.
    if (Math.abs(score - correctWords / Math.max(totalWords, 1)) > .00005001) throw new Error('invalid-dictation-lexical-score');
    if (payload.is_correct !== (score === 1) || diff.some((op) => {
      const filler = (op.op === 'miss' && isPureFiller(op.expected))
        || (op.op === 'extra' && isPureFiller(op.actual))
        || (op.op === 'wrong' && isPureFiller(op.expected) && isPureFiller(op.actual));
      return (['match', 'wrong'].includes(op.op) && (!op.expected || !op.actual))
        || (op.op === 'miss' && (!op.expected || op.actual))
        || (op.op === 'extra' && (op.expected || !op.actual))
        || op.filler !== filler;
    })) throw new Error('invalid-dictation-lexical-alignment');
    for (const [key, segments, wordKey] of [['expected_span', referenceSegments, 'expected'], ['actual_span', userSegments, 'actual']]) {
      const seen = new Set();
      let previous = -1;
      for (const op of diff) {
        const hasWord = Boolean(op[wordKey]);
        const span = op[key];
        const segment = span && segments[span.segment_index];
        if (hasWord !== Boolean(span) || (span && (!Number.isInteger(span.segment_index)
            || span.segment_index <= previous || seen.has(span.segment_index)
            || segment?.kind !== 'lexical' || span.start !== segment.start || span.end !== segment.end
            || op[wordKey] !== segment.raw))) throw new Error('invalid-dictation-lexical-alignment');
        if (span) { seen.add(span.segment_index); previous = span.segment_index; }
      }
      if (seen.size !== segments.filter((segment) => segment.kind === 'lexical').length) throw new Error('invalid-dictation-lexical-alignment');
    }
    evidence = { offset_unit: payload.offset_unit, reference: payload.reference, user_text: payload.user_text,
      reference_segments: referenceSegments, user_segments: userSegments,
      sentence_reference_sha256: payload.sentence_reference_sha256 };
  }
  const grade = Object.freeze({ ...policy, ...evidence, score, is_correct: payload.is_correct === true, correct_words: correctWords, total_words: totalWords, diff: Object.freeze(diff) });
  if (policy.grading_version === LEXICAL_DICTATION_POLICY && payload.grading_evidence != null) {
    const nested = payload.grading_evidence;
    if (typeof nested !== 'object' || Array.isArray(nested) || nested.grading_evidence != null
        || !sameGradeEvidence(normalizeDictationGrade(nested, policy, expectedText), grade)) throw new Error('invalid-dictation-reference-evidence');
  }
  return grade;
}

function sameGradeEvidence(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object'
      || Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) =>
    Object.prototype.hasOwnProperty.call(right, key) && sameGradeEvidence(left[key], right[key]));
}

export function normalizeDictationSavedGrade(row, policy, expectedText) {
  const evidence = row.grading_evidence;
  if (policy.grading_version === LEXICAL_DICTATION_POLICY && evidence != null
      && (typeof evidence !== 'object' || Array.isArray(evidence))) throw new Error('invalid-dictation-report-evidence');
  const isCorrect = policy.grading_version === LEGACY_DICTATION_POLICY ? Number(row.score) >= 1
    : row.is_correct === undefined ? evidence?.is_correct ?? row.score === 1 : row.is_correct;
  const grade = normalizeDictationGrade({ ...evidence, ...row, is_correct: isCorrect }, policy, expectedText);
  // normalizeDictationGrade checks both complete nested evidence and the merged
  // outer fields, including direct grade replies before any learner ACK.
  return grade;
}

function normalizedReport(payload, expectedRequestId, expectedPolicy, ownedStored = false) {
  if (!payload || typeof payload !== 'object') throw new Error('invalid-dictation-report');
  const sessionId = text(payload.session_id || payload.id);
  const attemptId = text(payload.attempt_id);
  const requestId = text(payload.client_request_id);
  const policy = normalizeDictationPolicy(payload, expectedPolicy);
  if (!sessionId || (expectedRequestId && requestId !== expectedRequestId)) {
    throw new Error('invalid-dictation-receipt');
  }
  const totalSentences = Number(payload.total_sentences);
  const correctCount = Number(payload.correct_count);
  const totalWords = Number(payload.total_words);
  const correctWords = Number(payload.correct_words);
  const accuracy = boundedRatio(payload.accuracy, 'invalid-dictation-report-score');
  if (![totalSentences, correctCount, totalWords, correctWords].every(Number.isInteger)
      || totalSentences < 0 || correctCount < 0 || correctCount > totalSentences
      || totalWords < 0 || correctWords < 0 || correctWords > totalWords) {
    throw new Error('invalid-dictation-report-counts');
  }
  const results = Array.isArray(payload.results) ? payload.results : [];
  const normalizedResults = policy.grading_version === LEXICAL_DICTATION_POLICY ? results.map((row, index) => {
    if (row.sentence_idx !== index || typeof row.reference !== 'string' || typeof row.user_text !== 'string') throw new Error('invalid-dictation-report-evidence');
    const grade = normalizeDictationSavedGrade(row, policy,
      { reference: row.reference, user_text: row.user_text });
    return Object.freeze({ ...row, ...grade });
  }) : results;
  if (policy.grading_version === LEXICAL_DICTATION_POLICY && normalizedResults.length !== totalSentences) throw new Error('invalid-dictation-report-evidence');
  if (policy.grading_version === LEXICAL_DICTATION_POLICY) {
    if (['total_sentences', 'correct_count', 'total_words', 'correct_words', 'accuracy'].some((key) => typeof payload[key] !== 'number')
        || !totalSentences || (!attemptId && !(ownedStored && payload.attempt_id === null))
        || normalizedResults.reduce((sum, row) => sum + row.total_words, 0) !== totalWords
        || normalizedResults.reduce((sum, row) => sum + row.correct_words, 0) !== correctWords
        || normalizedResults.filter((row) => row.score === 1).length !== correctCount) throw new Error('invalid-dictation-report-counts');
    if (Math.abs(accuracy - normalizedResults.reduce((sum, row) => sum + row.score, 0) / totalSentences) > .00005001) throw new Error('invalid-dictation-report-score');
    verifyReferenceHash(normalizedResults.map((row) => row.reference), policy);
  }
  if (policy.grading_version === LEGACY_DICTATION_POLICY && policy.reference_sha256 !== null) {
    if (results.length !== totalSentences || results.some((row, index) => row?.sentence_idx !== index || typeof row.reference !== 'string')) throw new Error('invalid-dictation-report-evidence');
    verifyReferenceHash(results.map((row) => row.reference), policy);
  }
  return Object.freeze({
    ...policy,
    session_id: sessionId,
    attempt_id: attemptId || null,
    client_request_id: requestId || null,
    section_num: Number(payload.section_num) || null,
    total_time_seconds: Number.isFinite(Number(payload.total_time_seconds)) ? Math.max(0, Number(payload.total_time_seconds)) : null,
    total_sentences: totalSentences,
    correct_count: correctCount,
    accuracy,
    total_words: totalWords,
    correct_words: correctWords,
    error_trends: payload.error_trends && typeof payload.error_trends === 'object' ? payload.error_trends : {},
    results: normalizedResults,
  });
}

export function normalizeDictationReport(payload, expectedRequestId = null, expectedPolicy = /** @type {any} */ (null)) {
  return normalizedReport(payload, expectedRequestId, expectedPolicy);
}

export function normalizeDictationAttemptReport(payload, expectedAttemptId, expectedPolicy = /** @type {any} */ (null)) {
  const attemptId = text(expectedAttemptId);
  if (!attemptId) throw new Error('invalid-dictation-attempt-receipt');
  const report = normalizeDictationReport(payload, null, expectedPolicy);
  if (report.attempt_id !== attemptId) {
    throw new Error('invalid-dictation-attempt-receipt');
  }
  return report;
}

function unversionedReceipt(submission) {
  return !Object.prototype.hasOwnProperty.call(submission || {}, 'grading_version')
    && !Object.prototype.hasOwnProperty.call(submission || {}, 'reference_sha256');
}

export function normalizeDictationReceiptReport(payload, receipt, byRequest = true) {
  const submission = receipt?.submission;
  if (!submission || !receipt.requestId) throw new Error('invalid-dictation-receipt');
  let expectedPolicy = normalizeDictationPolicy(submission);
  if (unversionedReceipt(submission)) {
    // Only an authoritative owned legacy receipt can supply the header absent
    // from N-1 local data. Explicit stale acknowledgements never use this path.
    if (payload?.grading_version !== LEGACY_DICTATION_POLICY) throw new Error('invalid-dictation-legacy-receipt');
    expectedPolicy = normalizeDictationPolicy(payload);
  }
  if (!byRequest && payload?.client_request_id !== receipt.requestId
      && !(payload?.grading_version === LEGACY_DICTATION_POLICY && payload.client_request_id == null && text(submission.attempt_id))) throw new Error('invalid-dictation-receipt');
  const canonical = normalizeDictationReport(payload, byRequest ? receipt.requestId : null, expectedPolicy);
  if (canonical.attempt_id !== (text(submission.attempt_id) || null)
      || canonical.section_num !== Number(submission.section_num)
      || !Array.isArray(submission.sentences) || submission.sentences.length !== canonical.results.length) throw new Error('invalid-dictation-receipt-payload');
  for (let index = 0; index < submission.sentences.length; index += 1) {
    const input = submission.sentences[index]; const saved = canonical.results[index];
    if (input?.sentence_idx !== index || saved?.sentence_idx !== index
        || typeof input.user_transcript !== 'string' || saved.user_text !== input.user_transcript
        || Number(input.listen_count ?? 0) !== Number(saved.listen_count ?? 0)
        || Number(input.time_seconds ?? 0) !== Number(saved.time_seconds ?? 0)) throw new Error('invalid-dictation-receipt-payload');
  }
  return canonical;
}

export function normalizeDictationStoredReport(payload, expectedSessionId) {
  if (!payload || payload.id !== expectedSessionId) throw new Error('invalid-dictation-stored-receipt');
  if (payload.session_id != null && payload.session_id !== payload.id) throw new Error('invalid-dictation-stored-receipt');
  const policy = normalizeDictationPolicy(payload);
  if (policy.grading_version === LEXICAL_DICTATION_POLICY) return Object.freeze({
    // Canonical FK erasure may unlink a stored report's parent. The owned report
    // identity and every frozen reference/grade remain independently verified.
    ...payload, ...normalizedReport(payload, null, policy, true),
  });
  // Older records may have absent summaries or references. Keep that absence
  // visible; neither current content nor reconstructed diff replaces originals.
  const count = (key) => {
    const value = payload[key];
    if (value == null) return null;
    if (!Number.isInteger(value) || value < 0) throw new Error('invalid-dictation-report-counts');
    return value;
  };
  const totals = Object.fromEntries(['total_sentences', 'correct_count', 'total_words', 'correct_words'].map((key) => [key, count(key)]));
  if ((totals.correct_count != null && totals.total_sentences != null && totals.correct_count > totals.total_sentences)
      || (totals.correct_words != null && totals.total_words != null && totals.correct_words > totals.total_words)
      || !Array.isArray(payload.results)) throw new Error('invalid-dictation-report-counts');
  const seen = new Set();
  const results = payload.results.map((row) => {
    if (!Number.isInteger(row.sentence_idx) || row.sentence_idx < 0 || row.sentence_idx >= 2000
        || seen.has(row.sentence_idx) || (totals.total_sentences != null && row.sentence_idx >= totals.total_sentences)
        || typeof row.user_text !== 'string' || (row.reference != null && typeof row.reference !== 'string')) throw new Error('invalid-dictation-report-evidence');
    seen.add(row.sentence_idx);
    const rowPolicy = savedSentencePolicy(row, policy);
    const nullableCount = (key) => {
      if (row[key] == null) return null;
      if (!Number.isInteger(row[key]) || row[key] < 0) throw new Error('invalid-dictation-report-counts');
      return row[key];
    };
    const totalWords = nullableCount('total_words');
    const correctWords = nullableCount('correct_words');
    if ((correctWords != null && totalWords != null && correctWords > totalWords)
        || (row.diff != null && !Array.isArray(row.diff))
        || (row.score != null && typeof row.score !== 'number')) throw new Error('invalid-dictation-report-evidence');
    const score = row.score == null ? null : boundedRatio(row.score, 'invalid-dictation-score');
    return Object.freeze({ ...row, ...rowPolicy, score, is_correct: score == null ? null : score === 1,
      total_words: totalWords, correct_words: correctWords, diff: Object.freeze(normalizedDiff(row.diff ?? [])) });
  });
  if (policy.reference_sha256 !== null) {
    const ordered = [...results].sort((a, b) => a.sentence_idx - b.sentence_idx);
    if (ordered.some((row, index) => row.sentence_idx !== index || typeof row.reference !== 'string')) throw new Error('invalid-dictation-report-evidence');
    verifyReferenceHash(ordered.map((row) => row.reference), policy);
  }
  return Object.freeze({ ...payload, ...policy, ...totals, session_id: payload.id,
    accuracy: payload.accuracy == null ? null : boundedRatio(payload.accuracy, 'invalid-dictation-report-score'),
    results: Object.freeze(results) });
}

export function dictationReceiptKey(accountId, testId, sectionNum) {
  const account = text(accountId);
  const test = text(testId);
  const section = Number(sectionNum);
  if (!account || !test || !Number.isInteger(section) || section < 1) throw new Error('invalid-dictation-receipt-key');
  return `av:dictation:v1:${account}:${test}:${section}`;
}

export function dictationRequestId(cryptoProvider = globalThis.crypto) {
  if (cryptoProvider && typeof cryptoProvider.randomUUID === 'function') {
    return cryptoProvider.randomUUID();
  }
  if (!cryptoProvider || typeof cryptoProvider.getRandomValues !== 'function') {
    throw new Error('dictation-secure-random-unavailable');
  }
  const bytes = new Uint8Array(16);
  cryptoProvider.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function normalizeDictationReceipt(payload, identity) {
  if (!payload || typeof payload !== 'object') return null;
  const requestId = text(payload.requestId);
  const accountId = text(payload.accountId);
  const testId = text(payload.testId);
  const sectionNum = Number(payload.sectionNum);
  const createdAt = text(payload.createdAt);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)
      || accountId !== identity.accountId || testId !== identity.testId
      || sectionNum !== Number(identity.sectionNum) || !payload.submission
      || !Number.isFinite(Date.parse(createdAt))) return null;
  return Object.freeze({
    requestId, accountId, testId, sectionNum, createdAt, submission: payload.submission,
    localResults: Array.isArray(payload.localResults) ? payload.localResults : [],
    localReport: payload.localReport && typeof payload.localReport === 'object'
      ? payload.localReport : null,
  });
}

export function isMissingReceipt(error) {
  return Number(error?.status) === 404 || /\b404\b/.test(String(error?.message || ''));
}

export function isDictationCanonicalMismatch(error) {
  const detail = typeof error?.detail === 'string' ? error.detail : '';
  const message = detail || String(error?.message || '');
  return Number(error?.status) === 409
    && [
      'Tiến độ canonical không khớp payload hoàn tất.',
      'Tiến độ vừa thay đổi ở phiên khác; hãy tải lại rồi hoàn tất lại.',
    ].some((canonicalConflict) => message.includes(canonicalConflict));
}

export function reconcileDictationReceiptWithAttempt(receipt, attempt) {
  const submission = receipt?.submission;
  if (!receipt || !submission || !attempt || attempt.status !== 'in_progress') return null;
  if (text(submission.attempt_id) !== text(attempt.attempt_id)
      || text(submission.test_id) !== text(attempt.test_id)
      || Number(submission.section_num) !== Number(attempt.section_num)) return null;
  const policy = normalizeDictationPolicy(attempt);
  const legacyRecovery = unversionedReceipt(submission) && policy.grading_version === LEGACY_DICTATION_POLICY;
  try { if (!legacyRecovery) normalizeDictationPolicy(submission, policy); } catch { return null; }
  const unitCount = Array.isArray(attempt.units) ? attempt.units.length : 0;
  const answers = Array.isArray(attempt.answers) ? attempt.answers : [];
  if (!unitCount || answers.length !== unitCount) return null;
  const sentences = answers.map((answer, index) => {
    if (Number(answer?.sentence_idx) !== index || typeof answer?.user_text !== 'string') return null;
    return Object.freeze({
      sentence_idx: index,
      user_transcript: answer.user_text,
      listen_count: Math.max(0, Math.trunc(finite(answer.listen_count))),
      time_seconds: Math.max(0, Math.trunc(finite(answer.time_seconds))),
    });
  });
  if (sentences.some((sentence) => sentence === null)) return null;
  return Object.freeze({
    ...receipt,
    submission: Object.freeze({ ...submission, ...(legacyRecovery ? policy : {}), sentences: Object.freeze(sentences) }),
  });
}

export function topDictationWords(map, limit = 8) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return [];
  return Object.entries(map).map(([word, count]) => ({ word: text(word), count: Number(count) }))
    .filter((item) => item.word && Number.isInteger(item.count) && item.count > 0)
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, limit);
}

export function formatDictationTime(seconds) {
  if (seconds === null || seconds === undefined || seconds === '') return '—';
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return '—';
  const minutes = Math.floor(value / 60);
  const rest = Math.round(value % 60);
  return minutes ? `${minutes} phút ${rest} giây` : `${rest} giây`;
}

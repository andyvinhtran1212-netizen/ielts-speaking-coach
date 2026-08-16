const objectOf = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const textOf = (value) => typeof value === 'string' ? value.trim() : '';
const integerOf = (value) => value !== null && value !== undefined && value !== ''
  && Number.isInteger(Number(value)) ? Number(value) : null;
const finiteOf = (value) => value !== null && value !== undefined && value !== ''
  && Number.isFinite(Number(value)) ? Number(value) : null;

function safeAudioUrl(value) {
  const raw = textOf(value);
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return parsed.toString();
  } catch {}
  throw new Error('standalone-dictation-audio-contract');
}

export function standaloneDictationParams(search) {
  const query = new URLSearchParams(String(search || ''));
  return { contentId: textOf(query.get('content_id')) || null };
}

function normalizeSegments(rawSegments, durationSeconds) {
  if (!Array.isArray(rawSegments) || !rawSegments.length) return null;
  const seen = new Set();
  const segments = rawSegments.map((raw) => {
    const segment = objectOf(raw);
    if (!segment || 'transcript' in segment || 'text' in segment) {
      throw new Error('standalone-dictation-answer-leak');
    }
    const idx = integerOf(segment.idx);
    const start = finiteOf(segment.start_sec);
    const end = finiteOf(segment.end_sec);
    if (idx === null || idx < 0 || seen.has(idx) || start === null || start < 0
        || end === null || end <= start || (durationSeconds > 0 && end > durationSeconds + 0.01)) {
      throw new Error('standalone-dictation-segment-contract');
    }
    seen.add(idx);
    return Object.freeze({ idx, start, end });
  }).sort((left, right) => left.idx - right.idx);
  if (segments.some((segment, index) => segment.idx !== index)) {
    throw new Error('standalone-dictation-segment-contract');
  }
  return Object.freeze(segments);
}

export function normalizeStandaloneDictationBoot(expectedContentId, raw) {
  const contentId = textOf(expectedContentId);
  const envelope = objectOf(raw);
  const content = objectOf(envelope?.content);
  if (!contentId || !content || textOf(content.id) !== contentId) {
    throw new Error('standalone-dictation-content-contract');
  }
  if ('transcript' in content || 'alignment_data' in content) {
    throw new Error('standalone-dictation-answer-leak');
  }
  const durationSeconds = Math.max(0, finiteOf(content.audio_duration_seconds) || 0);
  if (!Array.isArray(envelope.exercises)) throw new Error('standalone-dictation-envelope-contract');

  for (const rawExercise of envelope.exercises) {
    const exercise = objectOf(rawExercise);
    if (!exercise || textOf(exercise.content_id) !== contentId
        || textOf(exercise.exercise_type) !== 'dictation') continue;
    const exerciseId = textOf(exercise.id);
    if (!exerciseId) throw new Error('standalone-dictation-exercise-contract');
    const segments = normalizeSegments(exercise.segments, durationSeconds);
    if (!segments) continue;
    return Object.freeze({
      content: Object.freeze({
        id: contentId,
        title: textOf(content.title) || 'Bài nghe',
        audioUrl: safeAudioUrl(content.audio_signed_url),
        durationSeconds,
        accent: textOf(content.accent_tag),
        cefr: textOf(content.cefr_level),
        section: integerOf(content.ielts_section),
        topics: Object.freeze(Array.isArray(content.topic_tags)
          ? content.topic_tags.map(textOf).filter(Boolean).slice(0, 3) : []),
      }),
      exercise: Object.freeze({ id: exerciseId, segments }),
    });
  }
  return null;
}

export function normalizeStandaloneDictationResult(expectedExerciseId, expectedSegmentIdx, raw) {
  const value = objectOf(raw);
  const score = finiteOf(value?.score);
  const correctWords = integerOf(value?.correct_words);
  const totalWords = integerOf(value?.total_words);
  if (!value || textOf(value.attempt_id) === ''
      || textOf(value.exercise_id) !== textOf(expectedExerciseId)
      || textOf(value.mode) !== 'dictation'
      || integerOf(value.segment_idx) !== expectedSegmentIdx
      || typeof value.is_first_attempt !== 'boolean'
      || typeof value.is_correct !== 'boolean'
      || score === null || score < 0 || score > 1
      || correctWords === null || totalWords === null || totalWords < 1
      || correctWords < 0 || correctWords > totalWords
      || !Array.isArray(value.diff)) {
    throw new Error('standalone-dictation-result-contract');
  }

  const diff = value.diff.map((rawOperation) => {
    const operation = objectOf(rawOperation);
    const op = textOf(operation?.op);
    const actual = textOf(operation?.actual);
    const expected = textOf(operation?.expected);
    if (!operation || !['match', 'miss', 'wrong', 'extra'].includes(op)
        || (op === 'match' && (!actual || !expected))
        || (op === 'miss' && (!expected || actual))
        || (op === 'wrong' && (!actual || !expected))
        || (op === 'extra' && (!actual || expected))) {
      throw new Error('standalone-dictation-diff-contract');
    }
    return Object.freeze({ op, actual, expected, filler: operation.filler === true });
  });
  const expectedCount = diff.filter((operation) => operation.op !== 'extra').length;
  const matchCount = diff.filter((operation) => operation.op === 'match').length;
  const derivedScore = correctWords / totalWords;
  if (expectedCount !== totalWords || matchCount !== correctWords
      || Math.abs(score - derivedScore) > 0.00011
      || value.is_correct !== (score >= 1)) {
    throw new Error('standalone-dictation-result-contract');
  }

  return Object.freeze({
    attemptId: textOf(value.attempt_id),
    segmentIdx: expectedSegmentIdx,
    firstAttempt: value.is_first_attempt,
    score,
    correctWords,
    totalWords,
    isCorrect: value.is_correct,
    diff: Object.freeze(diff),
    reference: diff.map((operation) => operation.expected).filter(Boolean).join(' '),
  });
}

export function summarizeStandaloneDictation(results) {
  if (!Array.isArray(results) || !results.length || results.some((result) => !result)) {
    throw new Error('standalone-dictation-summary-contract');
  }
  const averageScore = results.reduce((sum, result) => sum + result.score, 0) / results.length;
  return Object.freeze({
    averageScore,
    correctSegments: results.filter((result) => result.isCorrect).length,
    totalSegments: results.length,
    firstAttemptSegments: results.filter((result) => result.firstAttempt).length,
  });
}

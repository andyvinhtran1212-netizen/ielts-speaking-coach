const MODES = new Set(['gist', 'true_false', 'mcq']);

const objectOf = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const textOf = (value) => typeof value === 'string' ? value.trim() : '';
const integerOf = (value) => value !== null && value !== undefined && value !== '' && Number.isInteger(Number(value))
  ? Number(value)
  : null;
const finiteOf = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
  ? Number(value)
  : null;

export function listeningStandaloneParams(search) {
  const query = new URLSearchParams(String(search || ''));
  return { contentId: textOf(query.get('content_id')) || null };
}

function normalizeIndexedRows(rows, mapper) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('exercise-items-contract');
  const seen = new Set();
  const normalized = rows.map((row) => {
    const item = mapper(objectOf(row));
    if (!item || seen.has(item.idx)) throw new Error('exercise-items-contract');
    seen.add(item.idx);
    return item;
  });
  const sorted = normalized.sort((left, right) => left.idx - right.idx);
  if (sorted.some((item, index) => item.idx !== index)) throw new Error('exercise-items-contract');
  return sorted;
}

function normalizeExercise(mode, expectedContentId, row) {
  const value = objectOf(row);
  if (!value || textOf(value.id) === '' || textOf(value.content_id) !== expectedContentId
      || textOf(value.exercise_type) !== mode) throw new Error('exercise-identity-contract');
  const payload = objectOf(value.payload);
  if (!payload) throw new Error('exercise-payload-contract');

  if (mode === 'gist') {
    if ('model_answer' in payload || 'rubric_keywords' in payload) throw new Error('exercise-answer-leak');
    return {
      id: textOf(value.id),
      prompt: textOf(payload.prompt_text) || 'Bạn nghe được gì?',
    };
  }
  if (mode === 'true_false') {
    return {
      id: textOf(value.id),
      statements: normalizeIndexedRows(payload.statements, (item) => {
        if (!item || 'answer' in item) throw new Error('exercise-answer-leak');
        const idx = integerOf(item.idx);
        const text = textOf(item.text);
        return idx !== null && idx >= 0 && text ? { idx, text } : null;
      }),
    };
  }
  return {
    id: textOf(value.id),
    questions: normalizeIndexedRows(payload.questions, (item) => {
      if (!item || 'answer_idx' in item) throw new Error('exercise-answer-leak');
      const idx = integerOf(item.idx);
      const stem = textOf(item.stem);
      const options = Array.isArray(item.options) ? item.options.map(textOf) : [];
      return idx !== null && idx >= 0 && stem && options.length === 4 && options.every(Boolean)
        ? { idx, stem, options }
        : null;
    }),
  };
}

export function normalizeListeningStandaloneBoot(mode, expectedContentId, rawContent, rawExercises) {
  if (!MODES.has(mode) || !textOf(expectedContentId)) throw new Error('exercise-request-contract');
  const content = objectOf(rawContent);
  if (!content || textOf(content.id) !== expectedContentId || !textOf(content.audio_signed_url)) {
    throw new Error('content-contract');
  }
  const envelope = objectOf(rawExercises);
  if (!envelope || !Array.isArray(envelope.exercises)) throw new Error('exercise-envelope-contract');
  const matching = envelope.exercises.filter((row) => {
    const value = objectOf(row);
    return value && textOf(value.content_id) === expectedContentId && textOf(value.exercise_type) === mode;
  });
  if (!matching.length) return null;
  if (matching.length !== 1) throw new Error('exercise-published-uniqueness-contract');
  return {
    mode,
    content: {
      id: expectedContentId,
      title: textOf(content.title) || 'Bài nghe',
      audioUrl: textOf(content.audio_signed_url),
      durationSeconds: Math.max(0, finiteOf(content.audio_duration_seconds) || 0),
    },
    exercise: normalizeExercise(mode, expectedContentId, matching[0]),
  };
}

function normalizeBaseResult(mode, expectedExerciseId, raw) {
  const value = objectOf(raw);
  if (!value || textOf(value.mode) !== mode || textOf(value.exercise_id) !== expectedExerciseId
      || !textOf(value.attempt_id) || typeof value.is_first_attempt !== 'boolean') {
    throw new Error('attempt-identity-contract');
  }
  return value;
}

export function normalizeListeningStandaloneResult(mode, expectedExerciseId, itemCount, raw) {
  const value = normalizeBaseResult(mode, expectedExerciseId, raw);
  const score = finiteOf(value.score);
  if (score === null) throw new Error('attempt-score-contract');
  if (mode === 'gist') {
    if (score < 0 || score > 100 || typeof value.ai_used !== 'boolean' || typeof value.is_correct !== 'boolean') {
      throw new Error('attempt-score-contract');
    }
    return {
      attemptId: textOf(value.attempt_id), firstAttempt: value.is_first_attempt,
      score, isCorrect: value.is_correct === true, aiUsed: value.ai_used,
      feedback: textOf(value.feedback) || 'Đã chấm xong.',
      keywordMatches: Array.isArray(value.keyword_matches) ? value.keyword_matches.map(textOf).filter(Boolean) : [],
    };
  }

  const correct = integerOf(value.correct);
  const total = integerOf(value.total);
  if (score < 0 || score > 1 || correct === null || total !== itemCount || correct < 0 || correct > total
      || typeof value.is_correct !== 'boolean'
      || !Array.isArray(value.details) || value.details.length !== itemCount) {
    throw new Error('attempt-score-contract');
  }
  const details = value.details.map((row, index) => {
    const detail = objectOf(row);
    const idx = integerOf(detail?.idx);
    if (!detail || idx !== index || typeof detail.is_correct !== 'boolean') throw new Error('attempt-detail-contract');
    if (mode === 'true_false') {
      const actual = textOf(detail.actual);
      const expected = textOf(detail.expected);
      if (!['T', 'F', 'NG'].includes(expected) || (actual && !['T', 'F', 'NG'].includes(actual))) {
        throw new Error('attempt-detail-contract');
      }
      return { idx, isCorrect: detail.is_correct, actual, expected };
    }
    const actualIdx = detail.actual_idx == null ? null : integerOf(detail.actual_idx);
    if (actualIdx !== null && (actualIdx < 0 || actualIdx > 3)) throw new Error('attempt-detail-contract');
    return { idx, isCorrect: detail.is_correct, actualIdx };
  });
  return {
    attemptId: textOf(value.attempt_id), firstAttempt: value.is_first_attempt,
    score, correct, total, isCorrect: value.is_correct === true, details,
  };
}

export function listeningStandaloneItemCount(bundle) {
  if (bundle?.mode === 'mcq') return bundle.exercise.questions.length;
  if (bundle?.mode === 'true_false') return bundle.exercise.statements.length;
  return 1;
}

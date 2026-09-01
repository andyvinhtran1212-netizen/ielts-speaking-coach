const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function uuid(value) {
  const normalized = text(value);
  return UUID_RE.test(normalized) ? normalized : '';
}

export function normalizeD1Exercise(value) {
  const row = object(value);
  if (!row) return null;
  const id = uuid(row.id);
  const sentence = text(row.sentence);
  const answer = text(row.answer);
  const options = Array.isArray(row.options) ? row.options.map(text) : [];
  const source = row.source === 'personalized' || row.source === 'admin_fallback'
    ? row.source
    : null;
  if (!id || !sentence || sentence.split('___').length !== 2 || !answer || options.length !== 4 || options.some((item) => !item)) return null;
  if (new Set(options.map((item) => item.toLocaleLowerCase('en'))).size !== 4) return null;
  if (!options.some((item) => item.toLocaleLowerCase('en') === answer.toLocaleLowerCase('en'))) return null;
  return { id, sentence, answer, options, source };
}

function normalizeExerciseList(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) return null;
  const exercises = value.map(normalizeD1Exercise);
  if (exercises.some((item) => !item)) return null;
  if (new Set(exercises.map((item) => item.id)).size !== exercises.length) return null;
  return exercises;
}

export function normalizeD1Start(value) {
  const row = object(value);
  const sessionId = uuid(row?.session_id);
  const exercises = normalizeExerciseList(row?.exercises);
  if (!sessionId || !exercises || row.total !== exercises.length) return null;
  return { sessionId, exercises, status: 'active', attemptsByExercise: new Map() };
}

export function normalizeD1Resume(value) {
  const row = object(value);
  const session = object(row?.session);
  const sessionId = uuid(session?.id);
  const exercises = normalizeExerciseList(session?.exercise_snapshot);
  const exerciseIds = Array.isArray(session?.exercise_ids) ? session.exercise_ids.map(uuid) : [];
  if (!sessionId || !exercises || session.total_count !== exercises.length) return null;
  if (exerciseIds.length !== exercises.length || exerciseIds.some((id, index) => id !== exercises[index].id)) return null;
  if (session.status !== 'active' && session.status !== 'completed') return null;
  if (!Array.isArray(row.attempts)) return null;
  const allowed = new Set(exerciseIds);
  const attemptsByExercise = new Map();
  for (const raw of row.attempts) {
    const attempt = object(raw);
    const exerciseId = uuid(attempt?.exercise_id);
    const userAnswer = text(attempt?.user_answer);
    if (!exerciseId || !allowed.has(exerciseId) || !userAnswer || typeof attempt.is_correct !== 'boolean') return null;
    attemptsByExercise.set(exerciseId, { exerciseId, userAnswer, isCorrect: attempt.is_correct });
  }
  return { sessionId, exercises, status: session.status, attemptsByExercise };
}

export function firstUnansweredIndex(session) {
  if (!session?.exercises || !(session.attemptsByExercise instanceof Map)) return -1;
  return session.exercises.findIndex((exercise) => !session.attemptsByExercise.has(exercise.id));
}

export function normalizeD1AttemptAck(value, exercise, choice) {
  const row = object(value);
  const attemptId = uuid(row?.attempt_id);
  const expectedCorrect = text(choice).toLocaleLowerCase('en') === text(exercise?.answer).toLocaleLowerCase('en');
  if (!attemptId || row.persisted !== true || typeof row.replayed !== 'boolean') return null;
  if (typeof row.is_correct !== 'boolean' || row.is_correct !== expectedCorrect) return null;
  if (text(row.correct_answer).toLocaleLowerCase('en') !== text(exercise?.answer).toLocaleLowerCase('en')) return null;
  if (typeof row.score !== 'number' || !Number.isFinite(row.score) || row.score !== (expectedCorrect ? 1 : 0)) return null;
  if (typeof row.srs_updated !== 'boolean') return null;
  if (row.srs_rating !== null && row.srs_rating !== 'good' && row.srs_rating !== 'again') return null;
  if (!row.srs_updated && row.srs_rating !== null) return null;
  return {
    attemptId,
    persisted: true,
    replayed: row.replayed,
    isCorrect: row.is_correct,
    correctAnswer: text(row.correct_answer),
    srsUpdated: row.srs_updated,
    srsRating: row.srs_rating,
  };
}

function normalizeSummaryItem(value, kind) {
  const row = object(value);
  const exerciseId = uuid(row?.exercise_id);
  const sentence = text(row?.sentence);
  if (!exerciseId || !sentence) return null;
  if (kind === 'correct') {
    const answer = text(row.answer);
    return answer ? { exerciseId, sentence, answer } : null;
  }
  const userAnswer = text(row.user_answer);
  const correctAnswer = text(row.correct_answer);
  return userAnswer && correctAnswer ? { exerciseId, sentence, userAnswer, correctAnswer } : null;
}

export function normalizeD1Summary(value, session) {
  const row = object(value);
  if (!row || uuid(row.session_id) !== session?.sessionId) return null;
  if (row.total_count !== session.exercises.length || !Array.isArray(row.correct) || !Array.isArray(row.wrong)) return null;
  const correct = row.correct.map((item) => normalizeSummaryItem(item, 'correct'));
  const wrong = row.wrong.map((item) => normalizeSummaryItem(item, 'wrong'));
  if (correct.some((item) => !item) || wrong.some((item) => !item)) return null;
  const ids = [...correct, ...wrong].map((item) => item.exerciseId);
  const expected = new Set(session.exercises.map((item) => item.id));
  if (ids.length !== expected.size || new Set(ids).size !== ids.length || ids.some((id) => !expected.has(id))) return null;
  if (row.correct_count !== correct.length) return null;
  return {
    sessionId: row.session_id,
    correctCount: correct.length,
    totalCount: row.total_count,
    correct,
    wrong,
  };
}

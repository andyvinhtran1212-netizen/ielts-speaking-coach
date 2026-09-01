const SAFE_AUDIO_PROTOCOLS = new Set(['https:', 'http:']);
const LEAK_KEYS = new Set([
  'answer', 'answers', 'answer_key', 'correct_answer', 'expected', 'solutions',
  'answer_idx', 'model_answer', 'rubric_keywords',
  'audio_windows', 'transcript_anchors', 'map_description', 'map_image_custom_prompt',
]);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function integer(value, code, { min = 0 } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min) throw new Error(code);
  return number;
}

function boolean(value, code) {
  if (typeof value !== 'boolean') throw new Error(code);
  return value;
}

function safeAudioUrl(value) {
  const raw = text(value);
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
  try {
    const parsed = new URL(raw);
    if (SAFE_AUDIO_PROTOCOLS.has(parsed.protocol)) return parsed.toString();
  } catch {}
  throw new Error('practice-run-audio-contract');
}

function assertNoAnswerLeak(value, path = 'payload') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoAnswerLeak(item, `${path}[${index}]`));
    return;
  }
  const object = record(value);
  if (!object) return;
  for (const [key, child] of Object.entries(object)) {
    if (LEAK_KEYS.has(key.toLowerCase())) throw new Error(`practice-run-answer-leak:${path}.${key}`);
    assertNoAnswerLeak(child, `${path}.${key}`);
  }
}

function normalizeOptions(value, qNum) {
  if (value == null) return Object.freeze([]);
  if (!Array.isArray(value)) throw new Error(`practice-run-options-contract:${qNum}`);
  const seen = new Set();
  const options = value.map((raw) => {
    const option = record(raw);
    const letter = text(option?.letter);
    const label = text(option?.text);
    if (!letter || !label || seen.has(letter)) {
      throw new Error(`practice-run-options-contract:${qNum}`);
    }
    seen.add(letter);
    return Object.freeze({ letter, text: label });
  });
  return Object.freeze(options);
}

function normalizeWindow(value, code = 'practice-run-window-contract') {
  if (value == null) return null;
  const window = record(value);
  const start = Number(window?.start);
  const end = Number(window?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
    throw new Error(code);
  }
  return Object.freeze({ start, end });
}

function normalizePerQuestion(rows, questionNums, code) {
  if (!Array.isArray(rows)) throw new Error(code);
  const expected = new Set(questionNums);
  const seen = new Set();
  const normalized = rows.map((raw) => {
    const row = record(raw);
    const qNum = integer(row?.q_num, code, { min: 1 });
    if (!expected.has(qNum) || seen.has(qNum)) throw new Error(code);
    seen.add(qNum);
    const expectedAnswer = text(row?.expected);
    if (!expectedAnswer) throw new Error(code);
    return Object.freeze({
      qNum,
      correct: boolean(row?.correct, code),
      userAnswer: typeof row?.user_answer === 'string' ? row.user_answer : '',
      expected: expectedAnswer,
    });
  }).sort((a, b) => a.qNum - b.qNum);
  if (seen.size !== expected.size) throw new Error(code);
  return Object.freeze(normalized);
}

export function practiceRunParams(search) {
  const params = new URLSearchParams(search || '');
  const ids = params.getAll('id');
  if (ids.length !== 1 || !text(ids[0])) throw new Error('practice-run-missing-id');
  return Object.freeze({ testId: text(ids[0]) });
}

export function normalizePracticeRunTest(payload, expectedId) {
  const source = record(payload);
  const id = text(source?.id);
  if (!id || id !== text(expectedId) || source?.test_type !== 'practice') {
    throw new Error('practice-run-test-identity');
  }
  if (!Array.isArray(source.sections)) throw new Error('practice-run-sections-contract');
  const questions = [];
  const seen = new Set();
  for (const section of source.sections) {
    if (!record(section) || !Array.isArray(section.exercises)) {
      throw new Error('practice-run-sections-contract');
    }
    for (const exercise of section.exercises) {
      const payloadObject = record(exercise?.payload);
      if (!payloadObject) throw new Error('practice-run-exercise-contract');
      assertNoAnswerLeak(payloadObject);
      if (!Array.isArray(payloadObject.questions)) continue;
      for (const raw of payloadObject.questions) {
        const question = record(raw);
        const qNum = integer(question?.q_num, 'practice-run-question-contract', { min: 1 });
        if (seen.has(qNum)) throw new Error('practice-run-question-duplicate');
        seen.add(qNum);
        questions.push(Object.freeze({
          qNum,
          prompt: typeof question.prompt === 'string' ? question.prompt : '',
          instruction: typeof payloadObject.instruction === 'string' ? payloadObject.instruction : '',
          options: normalizeOptions(question.options, qNum),
        }));
      }
    }
  }
  questions.sort((a, b) => a.qNum - b.qNum);
  if (!questions.length) throw new Error('practice-run-empty-questions');
  return Object.freeze({
    id,
    externalId: text(source.test_id) || id,
    title: text(source.title) || text(source.test_id) || 'Bài luyện nghe',
    audioUrl: safeAudioUrl(source.audio_url),
    audioDuration: Number.isFinite(Number(source.audio_duration_seconds))
      ? Math.max(0, Number(source.audio_duration_seconds)) : null,
    questions: Object.freeze(questions),
  });
}

export function normalizePracticeWindows(payload, expectedId, questionNums) {
  const source = record(payload);
  if (text(source?.test_id) !== text(expectedId) || !record(source?.windows)) {
    throw new Error('practice-run-windows-identity');
  }
  const allowed = new Set(questionNums);
  const windows = new Map();
  for (const [rawQ, rawWindow] of Object.entries(source.windows)) {
    const qNum = integer(rawQ, 'practice-run-windows-contract', { min: 1 });
    if (!allowed.has(qNum) || windows.has(qNum)) throw new Error('practice-run-windows-contract');
    windows.set(qNum, normalizeWindow(rawWindow, 'practice-run-windows-contract'));
  }
  return windows;
}

export function normalizePracticeResume(payload, questionNums) {
  const source = record(payload);
  if (!Object.hasOwn(source || {}, 'attempt')) throw new Error('practice-run-resume-contract');
  if (source.attempt == null) return null;
  const attempt = record(source.attempt);
  const attemptId = text(attempt?.attempt_id);
  if (!attemptId || !Array.isArray(attempt.answers)) throw new Error('practice-run-resume-contract');
  const allowed = new Set(questionNums);
  const seen = new Set();
  const answers = attempt.answers.map((raw) => {
    const row = record(raw);
    const qNum = integer(row?.q_num, 'practice-run-resume-answers', { min: 1 });
    const userAnswer = text(row?.user_answer);
    if (!allowed.has(qNum) || seen.has(qNum) || !userAnswer) {
      throw new Error('practice-run-resume-answers');
    }
    seen.add(qNum);
    return Object.freeze({ qNum, userAnswer });
  }).sort((a, b) => a.qNum - b.qNum);
  return Object.freeze({ attemptId, startedAt: text(attempt.started_at) || null, answers: Object.freeze(answers) });
}

export function normalizePracticeStart(payload) {
  const source = record(payload);
  const attemptId = text(source?.attempt_id);
  if (!attemptId || source?.status !== 'in_progress') throw new Error('practice-run-start-contract');
  return Object.freeze({ attemptId });
}

export function normalizePracticeCheck(payload, expectedQ, { reveal = false } = {}) {
  const source = record(payload);
  const qNum = integer(source?.q_num, 'practice-run-check-contract', { min: 1 });
  if (qNum !== Number(expectedQ)) throw new Error('practice-run-check-identity');
  const correct = boolean(source.correct, 'practice-run-check-contract');
  const canonicalCorrect = boolean(source.canonical_correct, 'practice-run-check-contract');
  const recorded = boolean(source.recorded, 'practice-run-check-contract');
  const answeredBefore = boolean(source.answered_before, 'practice-run-check-contract');
  if (recorded && answeredBefore) throw new Error('practice-run-check-contract');
  const hasRevealFields = ['expected', 'alternatives', 'solution', 'revealed']
    .some((key) => Object.hasOwn(source, key));
  if (!reveal && hasRevealFields) throw new Error('practice-run-check-answer-leak');
  if (reveal) {
    if (source.revealed !== true || correct || canonicalCorrect || recorded
        || !text(source.expected) || !Array.isArray(source.alternatives)
        || !record(source.solution)) throw new Error('practice-run-reveal-contract');
  }
  return Object.freeze({
    qNum, correct, canonicalCorrect, recorded, answeredBefore,
    audioWindow: normalizeWindow(source.audio_window),
    revealed: reveal,
    expected: reveal ? text(source.expected) : null,
    alternatives: reveal ? Object.freeze(source.alternatives.map(text).filter(Boolean)) : Object.freeze([]),
    explanation: reveal ? text(source.solution.why) : '',
  });
}

export function normalizePracticeSubmit(payload, attemptId, questionNums) {
  const source = record(payload);
  if (text(source?.attempt_id) !== text(attemptId)) throw new Error('practice-run-submit-identity');
  const maxScore = integer(source.max_score, 'practice-run-submit-score');
  const score = integer(source.score, 'practice-run-submit-score');
  if (maxScore !== questionNums.length || score > maxScore) throw new Error('practice-run-submit-score');
  const perQuestion = normalizePerQuestion(source.per_question, questionNums, 'practice-run-submit-details');
  if (perQuestion.filter((row) => row.correct).length !== score) {
    throw new Error('practice-run-submit-score');
  }
  return Object.freeze({ attemptId: text(attemptId), score, maxScore, perQuestion });
}

export function normalizePracticeAttempt(payload, attemptId, questionNums) {
  const source = record(payload);
  if (text(source?.attempt_id) !== text(attemptId)) throw new Error('practice-run-attempt-identity');
  if (source.status === 'in_progress') return Object.freeze({ status: 'in_progress', summary: null });
  if (source.status !== 'submitted') throw new Error('practice-run-attempt-status');
  const perQuestion = normalizePerQuestion(
    source.grading_details, questionNums, 'practice-run-attempt-details',
  );
  const score = integer(source.score, 'practice-run-attempt-score');
  if (score > questionNums.length || perQuestion.filter((row) => row.correct).length !== score) {
    throw new Error('practice-run-attempt-score');
  }
  return Object.freeze({
    status: 'submitted',
    summary: Object.freeze({ attemptId: text(attemptId), score, maxScore: questionNums.length, perQuestion }),
  });
}

export function firstPracticeUnsettledIndex(questions, verdicts) {
  const index = questions.findIndex((question) => verdicts.get(question.qNum) !== true);
  return index === -1 ? questions.length : index;
}

export function isChoicePracticeQuestion(question) {
  return Array.isArray(question?.options) && question.options.length > 0;
}

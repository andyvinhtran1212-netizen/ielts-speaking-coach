// Pure contracts for the native `/exam` player.
//
// The backend deliberately strips answer/solution fields from the play payload
// and only reveals them through the caller-owned submitted-attempt review. Keep
// these normalizers fail-closed: rendering a partly malformed exam can submit a
// different q_num/option set than the learner saw, which is worse than showing
// a recoverable load error.

export const EXAM_SOURCE_LABELS = Object.freeze({
  toeic_rc: 'TOEIC · Reading',
  toeic_lc: 'TOEIC · Listening',
  thpt_qg: 'THPT Quốc gia',
  grammar_reading: 'Ngữ pháp Đọc hiểu',
  grammar_practice: 'Luyện Ngữ pháp',
  vocab_context: 'Từ vựng theo ngữ cảnh',
});

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function nonNegativeInteger(value) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function positiveInteger(value) {
  const number = nonNegativeInteger(value);
  return number != null && number > 0 ? number : null;
}

function optionalMinutes(value) {
  if (value == null || value === '') return null;
  return positiveInteger(value);
}

function normalizeOption(value) {
  const label = text(value?.label);
  const optionText = text(value?.text);
  return label && optionText ? { label, text: optionText } : null;
}

export function examSourceLabel(source) {
  const key = text(source);
  return EXAM_SOURCE_LABELS[key] || key;
}

export function normalizeExamList(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.exams)) return null;
  const exams = [];
  const ids = new Set();
  for (const value of payload.exams) {
    const id = text(value?.id);
    const title = text(value?.title);
    const source = text(value?.exam_source);
    const totalQuestions = nonNegativeInteger(value?.total_questions);
    const timeLimitMinutes = optionalMinutes(value?.time_limit_minutes);
    if (!id || !title || !source || totalQuestions == null
        || (value?.time_limit_minutes != null && timeLimitMinutes == null)
        || ids.has(id)) return null;
    ids.add(id);
    exams.push({
      id,
      title,
      source,
      sourceLabel: examSourceLabel(source),
      totalQuestions,
      timeLimitMinutes,
    });
  }
  return exams;
}

export function normalizeExam(payload, expectedId = '') {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.questions)) return null;
  const id = text(payload.id);
  const title = text(payload.title);
  const source = text(payload.exam_source);
  const expected = text(expectedId);
  const declaredTotal = nonNegativeInteger(payload.total_questions);
  const timeLimitMinutes = optionalMinutes(payload.time_limit_minutes);
  if (!id || (expected && id !== expected) || !title || !source || declaredTotal == null
      || (payload.time_limit_minutes != null && timeLimitMinutes == null)) return null;

  const numbers = new Set();
  const questions = [];
  for (const raw of payload.questions) {
    const qNum = positiveInteger(raw?.q_num);
    const questionType = text(raw?.question_type);
    const prompt = text(raw?.prompt);
    if (!qNum || numbers.has(qNum) || questionType !== 'mcq_single'
        || !prompt || !Array.isArray(raw?.options)) return null;
    const options = raw.options.map(normalizeOption);
    if (options.length < 2 || options.some((option) => !option)) return null;
    const labels = new Set(options.map((option) => option.label));
    if (labels.size !== options.length) return null;
    numbers.add(qNum);
    questions.push({ qNum, prompt, options });
  }
  if (!questions.length || declaredTotal !== questions.length) return null;
  return {
    id,
    title,
    source,
    sourceLabel: examSourceLabel(source),
    totalQuestions: declaredTotal,
    timeLimitMinutes,
    questions,
  };
}

export function answersForSubmit(exam, answers) {
  if (!exam || !Array.isArray(exam.questions)) return [];
  return exam.questions.map((question) => ({
    q_num: question.qNum,
    user_answer: text(answers?.[question.qNum]),
  }));
}

export function normalizeAttemptAck(payload, expectedQuestions) {
  if (!payload || typeof payload !== 'object') return null;
  const attemptId = text(payload.attempt_id);
  const score = nonNegativeInteger(payload.score);
  const maxScore = nonNegativeInteger(payload.max_score);
  const correctCount = nonNegativeInteger(payload.correct_count);
  if (!attemptId || score == null || maxScore == null || correctCount == null
      || maxScore !== expectedQuestions || score > maxScore || correctCount !== score) return null;
  return { attemptId, score, maxScore, correctCount };
}

function normalizeKnowledgeRef(value) {
  const type = text(value?.type);
  const slug = text(value?.slug);
  if (!type || !slug) return null;
  return {
    type,
    slug,
    title: text(value?.title),
    category: text(value?.category),
    anchor: text(value?.anchor),
  };
}

function normalizeMicrocheck(value) {
  if (value == null) return null;
  if (!value || typeof value !== 'object' || !Array.isArray(value.options)) return false;
  const prompt = text(value.prompt);
  const answer = text(value.answer).toUpperCase();
  const options = value.options.map((option) => text(typeof option === 'string' ? option : option?.text));
  const validAnswers = options.map((_, index) => String.fromCharCode(65 + index));
  if (!prompt || options.length < 2 || options.some((option) => !option) || !validAnswers.includes(answer)) return false;
  return { prompt, answer, options };
}

function normalizeStepper(value) {
  if (value == null) return null;
  if (!value || typeof value !== 'object' || !Array.isArray(value.steps)) return false;
  const steps = [];
  for (const raw of value.steps) {
    const action = text(raw?.action);
    const instruction = text(raw?.instruction_vi);
    if (!action || !instruction || (raw?.kp_refs != null && !Array.isArray(raw.kp_refs))) return false;
    const refs = (raw.kp_refs || []).map(normalizeKnowledgeRef);
    const microcheck = normalizeMicrocheck(raw?.microcheck);
    if (refs.some((ref) => !ref) || microcheck === false || (microcheck && !refs.length)) return false;
    steps.push({ action, instruction_vi: instruction, kp_refs: refs, microcheck });
  }

  if (value.distractors != null && !Array.isArray(value.distractors)) return false;
  const distractors = [];
  for (const raw of value.distractors || []) {
    const option = text(raw?.option);
    // `reading_solution.build_stepper()` intentionally emits option="" when
    // it falls back from prose `trap_analysis`: the explanation is canonical,
    // but it cannot be attributed to a specific choice. The legacy result
    // simply has no labelled distractor card in that case. Omit that one row
    // instead of rejecting the complete, already-persisted review payload.
    if (!option) continue;
    const whyWrong = text(raw?.why_wrong_vi);
    if (!whyWrong || (raw?.kp_refs != null && !Array.isArray(raw.kp_refs))) return false;
    const refs = (raw.kp_refs || []).map(normalizeKnowledgeRef);
    if (refs.some((ref) => !ref)) return false;
    distractors.push({ option, why_wrong_vi: whyWrong, kp_refs: refs });
  }
  return { steps, distractors };
}

export function normalizeExamReview(payload, { attemptId, testId, qNums }) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.review)) return null;
  if (text(payload.attempt_id) !== text(attemptId) || text(payload.test_id) !== text(testId)) return null;
  const score = nonNegativeInteger(payload.score);
  const maxScore = nonNegativeInteger(payload.max_score);
  const correctCount = nonNegativeInteger(payload.correct_count);
  const expectedNums = new Set(qNums || []);
  if (score == null || maxScore == null || correctCount == null
      || maxScore !== expectedNums.size || score > maxScore || correctCount !== score
      || payload.review.length !== expectedNums.size) return null;

  const seen = new Set();
  const review = [];
  let verdictCorrectCount = 0;
  for (const raw of payload.review) {
    const qNum = positiveInteger(raw?.q_num);
    const prompt = text(raw?.prompt);
    const userAnswer = text(raw?.user_answer);
    const expected = text(raw?.expected);
    const stepper = normalizeStepper(raw?.stepper);
    if (!qNum || !expectedNums.has(qNum) || seen.has(qNum) || !prompt || !expected
        || typeof raw?.correct !== 'boolean' || stepper === false) return null;
    seen.add(qNum);
    if (raw.correct) verdictCorrectCount += 1;
    review.push({
      qNum,
      prompt,
      userAnswer,
      expected,
      correct: raw.correct,
      stepper,
    });
  }
  if (verdictCorrectCount !== correctCount) return null;
  return { score, maxScore, correctCount, review };
}

export function grammarKnowledgeHref(ref) {
  const type = text(ref?.type);
  const category = text(ref?.category);
  const slug = text(ref?.slug);
  if (type !== 'grammar' || !category || !slug) return null;
  const anchor = text(ref?.anchor);
  return `/grammar/${encodeURIComponent(category)}/${encodeURIComponent(slug)}`
    + (anchor ? `#${encodeURIComponent(anchor)}` : '');
}

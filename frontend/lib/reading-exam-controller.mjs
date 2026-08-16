const RETRY_DELAYS = Object.freeze([400, 1200, 3000]);
const READING_ORIGINS = new Set(['full', 'mini', 'mock']);
const WORD_LIMITS = new Set([
  'ONE WORD',
  'ONE WORD ONLY',
  'ONE WORD AND/OR A NUMBER',
  'NO MORE THAN TWO WORDS',
  'NO MORE THAN TWO WORDS AND/OR A NUMBER',
  'NO MORE THAN THREE WORDS',
  'NO MORE THAN THREE WORDS AND/OR A NUMBER',
]);

export function readingExamParams(search) {
  const params = new URLSearchParams(search || '');
  const testId = (params.get('test_id') || '').trim();
  const share = (params.get('share') || '').trim();
  if (!testId && !share) throw new Error('missing-reading-exam-identity');
  return Object.freeze({
    testId: testId || null,
    share: share || null,
    classItem: (params.get('class_item') || '').trim() || null,
    from: (params.get('from') || '').trim() || null,
    sittingId: (params.get('sitting_id') || '').trim() || null,
    mockEmbed: params.get('mock_embed') === '1',
  });
}

/**
 * @param {unknown} payload
 * @param {string | null} [fallbackTestId]
 */
export function normalizeReadingBoot(payload, fallbackTestId = null) {
  if (!payload || typeof payload !== 'object' || !payload.test || typeof payload.test !== 'object') {
    throw new Error('invalid-reading-boot');
  }
  const test = payload.test;
  const testId = String(test.test_id || fallbackTestId || '').trim();
  if (!testId || !Array.isArray(test.passages) || !Array.isArray(test.questions)) {
    throw new Error('invalid-reading-test');
  }
  const inProgress = payload.in_progress && typeof payload.in_progress === 'object'
    ? payload.in_progress
    : null;
  return {
    test: {
      ...test,
      test_id: testId,
      title: String(test.title || 'Reading Test'),
      time_limit_minutes: positiveInteger(test.time_limit_minutes, 60),
      total_questions: positiveInteger(test.total_questions, test.questions.length),
      passages: [...test.passages].sort((a, b) => Number(a.passage_order || 1) - Number(b.passage_order || 1)),
      questions: [...test.questions].sort((a, b) => Number(a.q_num || 0) - Number(b.q_num || 0)),
    },
    inProgress: inProgress ? {
      attempt_id: requiredText(inProgress.attempt_id, 'invalid-reading-attempt'),
      started_at: requiredText(inProgress.started_at, 'invalid-reading-start-time'),
      time_limit_minutes: positiveInteger(inProgress.time_limit_minutes, positiveInteger(test.time_limit_minutes, 60)),
      answers: Array.isArray(inProgress.answers) ? inProgress.answers : [],
    } : null,
  };
}

export function answersFromRows(rows) {
  const answers = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const qNum = Number(row?.q_num);
    if (!Number.isInteger(qNum) || qNum < 1) continue;
    const value = String(row?.user_answer ?? '');
    if (value) answers.set(qNum, value);
  }
  return answers;
}

export function readingRemainingSeconds(startedAt, limitMinutes, now = Date.now()) {
  const started = Date.parse(String(startedAt || ''));
  if (!Number.isFinite(started)) throw new Error('invalid-reading-start-time');
  const limit = positiveInteger(limitMinutes, 60) * 60;
  return Math.max(0, limit - Math.max(0, Math.floor((now - started) / 1000)));
}

export function consecutiveReadingQuestionRuns(questions) {
  const runs = [];
  for (const question of Array.isArray(questions) ? questions : []) {
    const current = runs.at(-1);
    if (current?.[0]?.question_type === question?.question_type) current.push(question);
    else runs.push([question]);
  }
  return runs;
}

export function readingQuestionInstruction(run, part = 1) {
  if (!Array.isArray(run) || !run.length) return '';
  const first = run[0];
  const type = String(first?.question_type || '');
  const firstQ = Number(first?.q_num || 0);
  const lastQ = Number(run.at(-1)?.q_num || firstQ);
  const range = firstQ === lastQ ? String(firstQ) : `${firstQ}\u2013${lastQ}`;
  const options = Array.isArray(first?.payload?.options) ? first.payload.options : [];
  const authoredLimit = String(first?.payload?.word_limit || '').trim().toUpperCase();
  const wordLimit = WORD_LIMITS.has(authoredLimit) ? authoredLimit : 'NO MORE THAN TWO WORDS';
  const questionLead = `Questions ${range}:`;
  const letters = options.length === 5 ? 'A, B, C, D or E'
    : options.length === 3 ? 'A, B or C' : 'A, B, C or D';
  const templates = {
    matching_headings: `${questionLead} Reading Passage ${part} has several paragraphs. Choose the correct heading for each paragraph from the list of headings. Select your answer from the dropdown beside each question.`,
    true_false_not_given: `${questionLead} Do the following statements agree with the information given in Reading Passage ${part}?\nTRUE        if the statement agrees with the information\nFALSE       if the statement contradicts the information\nNOT GIVEN   if there is no information on this`,
    yes_no_not_given: `${questionLead} Do the following statements agree with the claims of the writer in Reading Passage ${part}?\nYES         if the statement agrees with the writer's claims\nNO          if the statement contradicts the writer's claims\nNOT GIVEN   if it is impossible to say what the writer thinks about this`,
    mcq_single: `${questionLead} Choose the correct letter, ${letters}.`,
    mcq_multi: `${questionLead} Choose TWO letters, A\u2013${String.fromCharCode(64 + Math.max(1, Math.min(26, options.length || 5)))}.`,
    sentence_completion: `${questionLead} Complete the sentences below. Choose ${wordLimit} from the passage for each answer.`,
    summary_completion: options.length
      ? `${questionLead} Complete the summary using the list of phrases, A-${String.fromCharCode(64 + Math.max(1, Math.min(26, options.length)))}, below.`
      : `${questionLead} Complete the summary below. Choose ${wordLimit} from the passage for each answer.`,
    notes_completion: `${questionLead} Complete the notes below. Choose ${wordLimit} from the passage for each answer.`,
    table_completion: `${questionLead} Complete the table below. Choose ${wordLimit} from the passage for each answer.`,
    form_completion: `${questionLead} Complete the form below. Choose ${wordLimit} from the passage for each answer.`,
    short_answer: `${questionLead} Answer the questions below. Choose ${WORD_LIMITS.has(authoredLimit) ? authoredLimit : 'NO MORE THAN THREE WORDS'} from the passage for each answer.`,
    matching_information: `${questionLead} Reading Passage ${part} has several paragraphs. Which paragraph contains the following information? Write the correct letter beside each statement.`,
    matching_features: `${questionLead} Look at the following statements and the list of features. Match each statement with the correct feature.`,
    matching_sentence_endings: `${questionLead} Complete each sentence with the correct ending from the list below.`,
    flow_chart_completion: `${questionLead} Complete the flow-chart below. Choose ${wordLimit} from the passage for each answer.`,
    diagram_label_completion: `${questionLead} Label the diagram below. Choose ${wordLimit} from the passage for each answer.`,
  };
  return templates[type] || `Questions ${range}.`;
}

/**
 * @param {string} attemptId
 * @param {{anonId?: string | null, from?: string | null, sittingId?: string | null}} [options]
 */
export function readingReviewHref(attemptId, { anonId = null, from = null, sittingId = null } = {}) {
  const query = new URLSearchParams({ attempt_id: requiredText(attemptId, 'missing-reading-attempt') });
  if (anonId) query.set('anon', String(anonId));
  const origin = READING_ORIGINS.has(String(from || '')) ? String(from) : 'full';
  query.set('from', origin);
  if (origin === 'mock' && sittingId) query.set('sitting', String(sittingId));
  return `/reading/review?${query.toString()}`;
}

/** @param {string | null | undefined} from @param {string | null | undefined} [sittingId] */
export function readingLibraryHref(from, sittingId = null) {
  if (from === 'mini') return '/reading/mini-test';
  if (from === 'mock' && sittingId) return `/mock/result?sitting=${encodeURIComponent(String(sittingId))}`;
  return '/reading/test';
}

export function isRetriableReadingSave(error) {
  if (!error) return false;
  const status = Number(error.status);
  return error.status === undefined || error.status === null
    || [408, 425, 429].includes(status) || status >= 500;
}

export function createReadingSaveCoordinator({
  save,
  debounceMs = 500,
  retryDelays = RETRY_DELAYS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  if (typeof save !== 'function') throw new TypeError('save must be a function');
  const values = new Map();
  const generations = new Map();
  const debounceTimers = new Map();
  const retryTimers = new Map();
  const inflight = new Map();
  const statuses = new Map();
  const listeners = new Set();
  let disposed = false;

  const notify = () => listeners.forEach((listener) => listener(snapshot()));
  const snapshot = () => new Map(statuses);
  const status = (qNum, value) => {
    if (value) statuses.set(qNum, value);
    else statuses.delete(qNum);
    notify();
  };
  const cancelTimer = (map, qNum) => {
    const handle = map.get(qNum);
    if (handle !== undefined) clearTimer(handle);
    map.delete(qNum);
  };

  async function persist(qNum, generation, attempt = 0, keepalive = false) {
    if (disposed || generations.get(qNum) !== generation) return null;
    cancelTimer(retryTimers, qNum);
    const promise = Promise.resolve().then(() => save(qNum, values.get(qNum) || '', { keepalive }));
    inflight.set(qNum, promise);
    try {
      const result = await promise;
      if (generations.get(qNum) === generation) status(qNum, null);
      return result;
    } catch (error) {
      if (generations.get(qNum) !== generation) return null;
      if (!keepalive && isRetriableReadingSave(error) && attempt < retryDelays.length) {
        status(qNum, 'retrying');
        return new Promise((resolve) => {
          const handle = setTimer(() => {
            retryTimers.delete(qNum);
            resolve(persist(qNum, generation, attempt + 1, false));
          }, retryDelays[attempt]);
          retryTimers.set(qNum, handle);
        });
      }
      status(qNum, 'failed');
      return null;
    } finally {
      if (inflight.get(qNum) === promise) inflight.delete(qNum);
    }
  }

  function update(qNum, value) {
    if (disposed) return;
    const normalizedQ = Number(qNum);
    values.set(normalizedQ, String(value ?? ''));
    const generation = (generations.get(normalizedQ) || 0) + 1;
    generations.set(normalizedQ, generation);
    cancelTimer(debounceTimers, normalizedQ);
    cancelTimer(retryTimers, normalizedQ);
    const handle = setTimer(() => {
      debounceTimers.delete(normalizedQ);
      void persist(normalizedQ, generation);
    }, debounceMs);
    debounceTimers.set(normalizedQ, handle);
  }

  async function flush({ keepalive = false } = {}) {
    const queuedBeforeFlush = new Set([
      ...debounceTimers.keys(),
      ...retryTimers.keys(),
      ...statuses.keys(),
    ]);
    const due = new Set([
      ...debounceTimers.keys(),
      ...retryTimers.keys(),
      ...inflight.keys(),
      ...statuses.keys(),
    ]);
    for (const qNum of due) {
      cancelTimer(debounceTimers, qNum);
      cancelTimer(retryTimers, qNum);
    }
    const writes = [...due].map((qNum) => {
      const active = inflight.get(qNum);
      // A normal fetch can be cancelled by navigation. During an unload flush,
      // re-send the latest value with keepalive even when the same generation
      // already has a request in flight. Non-unload flushes still reuse it.
      if (active && !queuedBeforeFlush.has(qNum) && !keepalive) return active;
      const generation = generations.get(qNum) || 1;
      generations.set(qNum, generation);
      return persist(qNum, generation, 0, keepalive);
    });
    if (!keepalive) await Promise.all(writes);
  }

  function retryFailed() {
    for (const [qNum, state] of statuses) {
      if (state !== 'failed') continue;
      const generation = generations.get(qNum) || 1;
      generations.set(qNum, generation);
      void persist(qNum, generation);
    }
  }

  function seed(seedValues) {
    values.clear();
    for (const [qNum, value] of seedValues || []) values.set(Number(qNum), String(value ?? ''));
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function dispose() {
    disposed = true;
    for (const handle of debounceTimers.values()) clearTimer(handle);
    for (const handle of retryTimers.values()) clearTimer(handle);
    debounceTimers.clear();
    retryTimers.clear();
    listeners.clear();
  }

  return { update, flush, retryFailed, seed, subscribe, snapshot, dispose };
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function requiredText(value, code) {
  const text = String(value || '').trim();
  if (!text) throw new Error(code);
  return text;
}

const MODES = new Set(['practice', 'test_part', 'test_full']);
const FILTER_STATUSES = new Set(['in_progress', 'completed', 'grading_failed']);
const ERROR_FILTERS = new Set(['has_error', 'stt_failed', 'grading_failed', 'save_failed', 'pdf_failed']);

const record = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const text = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;
const nullableText = (value) => text(value);
const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
const boolean = (value) => value === true;
const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : '';

export function normalizeSpeakingSessionFilters(input = {}) {
  return {
    email: typeof input.email === 'string' ? input.email.trim().slice(0, 254) : '',
    mode: MODES.has(input.mode) ? input.mode : '',
    status: FILTER_STATUSES.has(input.status) ? input.status : '',
    error: ERROR_FILTERS.has(input.error) ? input.error : '',
    dateFrom: validDate(input.dateFrom),
    dateTo: validDate(input.dateTo),
  };
}

export function speakingSessionFilterKey(filters) {
  return [filters.email, filters.mode, filters.status, filters.error, filters.dateFrom, filters.dateTo].join('\u0000');
}

/** @param {Record<string, string>} filters @param {string | null | undefined} sessionId */
export function speakingSessionSearch(filters, sessionId = null) {
  const params = new URLSearchParams();
  if (filters.email) params.set('email', filters.email);
  if (filters.mode) params.set('mode', filters.mode);
  if (filters.status) params.set('status', filters.status);
  if (filters.error) params.set('error', filters.error);
  if (filters.dateFrom) params.set('from', filters.dateFrom);
  if (filters.dateTo) params.set('to', filters.dateTo);
  if (sessionId) params.set('session', sessionId);
  return params.toString();
}

function normalizeSessionRow(raw) {
  const row = record(raw);
  const id = text(row?.id);
  if (!row || !id) return null;
  return {
    id,
    userId: nullableText(row.user_id),
    userEmail: nullableText(row.user_email),
    userLookupFailed: boolean(row.user_lookup_failed),
    mode: nullableText(row.mode),
    part: finite(row.part),
    topic: nullableText(row.topic),
    status: nullableText(row.status),
    startedAt: nullableText(row.started_at),
    completedAt: nullableText(row.completed_at),
    overallBand: finite(row.overall_band),
    bandFc: finite(row.band_fc),
    bandLr: finite(row.band_lr),
    bandGra: finite(row.band_gra),
    bandP: finite(row.band_p),
    errorCode: nullableText(row.error_code),
    errorMessage: nullableText(row.error_message),
    failedStep: nullableText(row.failed_step),
    lastErrorAt: nullableText(row.last_error_at),
  };
}

export function normalizeSpeakingSessionList(raw) {
  if (!Array.isArray(raw)) return null;
  const rows = [];
  let malformedCount = 0;
  for (const candidate of raw) {
    const row = normalizeSessionRow(candidate);
    if (row) rows.push(row);
    else malformedCount += 1;
  }
  return { rows, malformedCount, returnedCount: raw.length };
}

function safeAudioUrl(value) {
  const source = text(value);
  if (!source) return null;
  try {
    const parsed = new URL(source, 'https://local.invalid');
    if (parsed.protocol !== 'https:' || (parsed.hostname === 'local.invalid' && !source.startsWith('/'))) return null;
    return source.startsWith('/') ? `${parsed.pathname}${parsed.search}${parsed.hash}` : parsed.href;
  } catch {
    return null;
  }
}

function normalizeFeedback(value) {
  let source = value;
  if (typeof source === 'string') {
    try { source = JSON.parse(source); } catch { return null; }
  }
  const feedback = record(source);
  if (!feedback) return null;
  const list = (key) => Array.isArray(feedback[key])
    ? feedback[key].slice(0, 12).map((item) => {
      if (typeof item === 'string') return item.trim();
      const row = record(item);
      return text(row?.issue) || text(row?.text) || text(row?.note) || null;
    }).filter(Boolean)
    : [];
  return {
    fc: nullableText(feedback.fc_feedback),
    lr: nullableText(feedback.lr_feedback),
    gra: nullableText(feedback.gra_feedback),
    pronunciation: nullableText(feedback.p_feedback),
    strengths: list('strengths'),
    improvements: list('improvements'),
    grammarIssues: list('grammar_issues'),
    vocabularyIssues: list('vocabulary_issues'),
    sampleAnswer: nullableText(feedback.improved_response) || nullableText(feedback.sample_answer),
  };
}

function normalizeQuestion(raw) {
  const row = record(raw);
  const id = text(row?.id);
  if (!row || !id) return null;
  return {
    id,
    text: nullableText(row.question_text),
    order: finite(row.order_num),
    cueBullets: Array.isArray(row.cue_card_bullets)
      ? row.cue_card_bullets.map(text).filter(Boolean).slice(0, 8) : [],
    cueReflection: nullableText(row.cue_card_reflection),
  };
}

function normalizeResponse(raw) {
  const row = record(raw);
  const id = text(row?.id);
  const questionId = text(row?.question_id);
  if (!row || !id || !questionId) return null;
  return {
    id,
    questionId,
    transcript: nullableText(row.transcript),
    overallBand: finite(row.overall_band),
    feedback: normalizeFeedback(row.feedback),
    audioUrl: safeAudioUrl(row.audio_playback_url),
    audioStored: Boolean(text(row.audio_storage_path) || text(row.audio_url)),
    gradingStatus: nullableText(row.grading_status),
    sttStatus: nullableText(row.stt_status),
  };
}

/** @param {unknown} raw @param {string | null | undefined} expectedId */
export function normalizeSpeakingSessionDetail(raw, expectedId = null) {
  const source = record(raw);
  const base = normalizeSessionRow(source);
  if (!source || !base || (expectedId && base.id !== expectedId) || !Array.isArray(source.questions) || !Array.isArray(source.responses)) return null;
  const questions = source.questions.map(normalizeQuestion).filter(Boolean);
  const responses = source.responses.map(normalizeResponse).filter(Boolean);
  return {
    ...base,
    userDisplayName: nullableText(source.user_display_name),
    p1SessionId: nullableText(source.p1_session_id),
    p2SessionId: nullableText(source.p2_session_id),
    p3SessionId: nullableText(source.p3_session_id),
    fullTestSiblingsLookupFailed: boolean(source.full_test_siblings_lookup_failed),
    questions,
    responses,
    malformedQuestions: source.questions.length - questions.length,
    malformedResponses: source.responses.length - responses.length,
    questionsLookupFailed: boolean(source.questions_lookup_failed),
    responsesLookupFailed: boolean(source.responses_lookup_failed),
  };
}

export function normalizeResponseRegrade(raw, responseId, sessionId) {
  const source = record(raw);
  if (!source || source.ok !== true || source.response_id !== responseId || source.session_id !== sessionId || !Number.isInteger(source.remaining_failed) || source.remaining_failed < 0) return null;
  return { ok: true, overallBand: finite(source.overall_band), reTranscribed: boolean(source.re_transcribed), sessionUpdated: boolean(source.session_updated), remainingFailed: source.remaining_failed, sessionBand: finite(source.session_band) };
}

export function normalizeSessionRegrade(raw, sessionId) {
  const source = record(raw);
  if (!source || source.session_id !== sessionId || typeof source.ok !== 'boolean' || typeof source.partial_failure !== 'boolean') return null;
  for (const key of ['regraded', 'skipped', 'failed']) if (!Number.isInteger(source[key]) || source[key] < 0) return null;
  return {
    ok: source.ok,
    partialFailure: source.partial_failure,
    regraded: source.regraded,
    skipped: source.skipped,
    failed: source.failed,
    failedDetails: Array.isArray(source.failed_details) ? source.failed_details.map(text).filter(Boolean).slice(0, 5) : [],
    overallBand: finite(source.overall_band),
  };
}

export function normalizeSummaryRebuild(raw, expectedIds) {
  const source = record(raw);
  if (!source || source.ok !== true || !Array.isArray(source.sessions)) return null;
  const expected = new Set(expectedIds);
  const seen = new Set();
  const sessions = [];
  for (const candidate of source.sessions) {
    const row = record(candidate);
    const id = text(row?.session_id);
    if (!row || !id || !expected.has(id) || seen.has(id) || typeof row.ok !== 'boolean') return null;
    seen.add(id);
    sessions.push({ id, ok: row.ok, error: nullableText(row.error), overallBand: finite(row.overall_band) });
  }
  return seen.size === expected.size ? sessions : null;
}

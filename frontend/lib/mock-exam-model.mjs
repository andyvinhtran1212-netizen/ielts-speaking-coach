import { admitCorePlayer } from './core-player-affinity.mjs';
import { planLocalCopyReplay } from './exam-room/local-copy.mjs';

export const MOCK_SECTION_ORDER = Object.freeze(['listening', 'reading', 'writing']);
export const MOCK_LIVE_STATUSES = Object.freeze(['registered', 'lrw_in_progress']);
export const MOCK_TERMINAL_STATUSES = Object.freeze([
  'lrw_submitted', 'speaking_pending', 'all_submitted', 'under_review', 'reviewed', 'released', 'void',
]);
export const MOCK_SECTION_LABELS = Object.freeze({
  listening: '🎧 Listening',
  reading: '📖 Reading',
  writing: '✍️ Writing',
});
export const MOCK_WRITING_GUIDANCE = Object.freeze({
  task1: Object.freeze({ minWords: 150, timeShare: 1, scoreWeight: 1 }),
  task2: Object.freeze({ minWords: 250, timeShare: 2, scoreWeight: 2 }),
});
export const MOCK_WRITING_TIME_SHARE_TOTAL = Object.values(MOCK_WRITING_GUIDANCE)
  .reduce((total, guidance) => total + guidance.timeShare, 0);

const ALL_STATUSES = new Set([...MOCK_LIVE_STATUSES, ...MOCK_TERMINAL_STATUSES]);
const ACTIVE_SECTIONS = new Set(['not_started', 'done', ...MOCK_SECTION_ORDER]);
const EXAM_MODES = new Set(['sequential', 'retake']);

function record(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
  return value;
}

function text(value) {
  return String(value == null ? '' : value).trim();
}

function nullableText(value) {
  const normalized = text(value);
  return normalized || null;
}

function finiteNonNegative(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function normalizePrompt(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return Object.freeze({
    id: nullableText(value.id),
    taskType: nullableText(value.task_type),
    title: text(value.title),
    promptText: text(value.prompt_text),
    promptImageUrl: nullableText(value.prompt_image_url),
    // Private chart that could not be signed this poll (B10); the next poll retries.
    promptImageLookupFailed: !nullableText(value.prompt_image_url) && value.prompt_image_lookup_failed === true,
  });
}

function normalizeWritingBlob(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return Object.freeze({ text: '', submittedAt: null });
  }
  return Object.freeze({
    text: typeof value.text === 'string' ? value.text : '',
    submittedAt: nullableText(value.submitted_at),
  });
}

function normalizeSitting(raw) {
  const sitting = record(raw, 'invalid-mock-sitting');
  const id = text(sitting.id);
  const status = text(sitting.status);
  if (!id || !ALL_STATUSES.has(status)) throw new Error('invalid-mock-sitting');
  const writing = sitting.writing_submission && typeof sitting.writing_submission === 'object'
    ? sitting.writing_submission
    : {};
  return Object.freeze({
    id,
    mockExamId: nullableText(sitting.mock_exam_id),
    userId: nullableText(sitting.user_id),
    status,
    sealed: Boolean(sitting.sealed),
    listeningAttemptId: nullableText(sitting.listening_attempt_id),
    readingAttemptId: nullableText(sitting.reading_attempt_id),
    listeningSubmittedAt: nullableText(sitting.listening_submitted_at),
    readingSubmittedAt: nullableText(sitting.reading_submitted_at),
    writingSubmittedAt: nullableText(sitting.writing_submitted_at),
    writingSubmission: Object.freeze({
      task1: normalizeWritingBlob(writing.task1),
      task2: normalizeWritingBlob(writing.task2),
    }),
  });
}

function normalizeExam(raw) {
  const exam = record(raw, 'invalid-mock-exam');
  const topicSet = exam.speaking_topic_set && typeof exam.speaking_topic_set === 'object'
    && !Array.isArray(exam.speaking_topic_set)
    ? exam.speaking_topic_set
    : {};
  return Object.freeze({
    listeningTestId: nullableText(exam.listening_test_id),
    readingTestCode: nullableText(exam.reading_test_code),
    readingTitle: text(exam.reading_title),
    writingTask1: normalizePrompt(exam.writing_task1),
    writingTask2: normalizePrompt(exam.writing_task2),
    speakingTopicSet: Object.freeze({ ...topicSet }),
    totalMinutes: finiteNonNegative(exam.total_minutes, 150),
    readingMinutes: finiteNonNegative(exam.reading_minutes, 60),
    writingMinutes: finiteNonNegative(exam.writing_minutes, 60),
    reviewSlaDays: finiteNonNegative(exam.review_sla_days, 3),
  });
}

export function mockExamParams(search) {
  const params = new URLSearchParams(search || '');
  const code = nullableText(params.get('code'));
  const sittingId = nullableText(params.get('sitting'));
  if (!code && !sittingId) throw new Error('missing-mock-exam-identity');
  return Object.freeze({ code, sittingId });
}

/** @param {unknown} payload @param {string | null} [expectedSittingId] */
export function normalizeMockExamState(payload, expectedSittingId = null) {
  const root = record(payload, 'invalid-mock-state');
  const sitting = normalizeSitting(root.sitting);
  if (expectedSittingId && sitting.id !== String(expectedSittingId)) {
    throw new Error('mock-sitting-identity-mismatch');
  }
  const examMode = text(root.exam_mode) || 'sequential';
  const activeSection = text(root.active_section) || 'not_started';
  if (!EXAM_MODES.has(examMode) || !ACTIVE_SECTIONS.has(activeSection)) {
    throw new Error('invalid-mock-state');
  }
  const assignedSkills = Array.isArray(root.assigned_skills)
    ? MOCK_SECTION_ORDER.filter((section) => root.assigned_skills.includes(section))
    : null;
  const collectedSection = nullableText(root.collected_section);
  if (collectedSection && !MOCK_SECTION_ORDER.includes(collectedSection)) {
    throw new Error('invalid-mock-state');
  }
  if (examMode === 'retake' && (!assignedSkills || !assignedSkills.length)) {
    throw new Error('invalid-mock-retake-assignment');
  }
  const sectionTimeLeftSeconds = finiteNonNegative(root.section_time_left_seconds);
  if (MOCK_SECTION_ORDER.includes(activeSection)
      && collectedSection !== activeSection
      && !sitting[`${activeSection}SubmittedAt`]
      && sectionTimeLeftSeconds === null) {
    throw new Error('invalid-mock-section-clock');
  }
  return Object.freeze({
    sitting,
    exam: normalizeExam(root.exam),
    examMode,
    assignedSkills: assignedSkills ? Object.freeze(assignedSkills) : null,
    activeSection,
    collectedSection,
    sectionTimeLeftSeconds,
    sectionDurationSeconds: finiteNonNegative(root.section_duration_seconds),
    selfPaced: normalizeSelfPaced(root.self_paced),
  });
}

const SELF_PACED_STATES = new Set(['not_started', 'in_progress', 'submitted', 'missed']);
const SELF_PACED_SECTION_STATES = new Set(['not_started', 'in_progress', 'submitted', 'marking', 'released']);

/**
 * EXAMMOCK-0071 FR-014 (T005): the server's back-to-back state of a self-paced
 * sitting (`self_paced` from GET /sittings/{id}, MOCKORG-0086 plan 5.5), or
 * null for every other sitting. The server owns the clock; nothing here is
 * computed from this device's time except the entry-screen warning.
 */
export function normalizeSelfPaced(value) {
  if (value == null) return null;
  const root = record(value, 'invalid-mock-self-paced');
  const state = text(root.state);
  if (!SELF_PACED_STATES.has(state)) throw new Error('invalid-mock-self-paced');
  const sections = (Array.isArray(root.sections) ? root.sections : []).map((row) => {
    const item = record(row, 'invalid-mock-self-paced');
    const section = text(item.section);
    const status = text(item.status);
    if (!MOCK_SECTION_ORDER.includes(section) || !SELF_PACED_SECTION_STATES.has(status)) {
      throw new Error('invalid-mock-self-paced');
    }
    return Object.freeze({ section, status, startedAt: nullableText(item.started_at), endsAt: nullableText(item.ends_at) });
  });
  const current = nullableText(root.current_section);
  return Object.freeze({
    state,
    startedAt: nullableText(root.started_at),
    expectedEndAt: nullableText(root.expected_end_at),
    currentSection: current && MOCK_SECTION_ORDER.includes(current) ? current : null,
    // Seconds until the current section opens; > 0 only inside a gap
    // (MOCK_SELF_PACED_GAP_SECONDS > 0). Relative, so no device clock.
    startsInSeconds: finiteNonNegative(root.starts_in_seconds, 0),
    gapSeconds: finiteNonNegative(root.gap_seconds, 0),
    openUntil: nullableText(root.open_until),
    totalSeconds: finiteNonNegative(root.total_seconds, 0),
    sections: Object.freeze(sections),
  });
}

/**
 * Which exam-room screen a self-paced sitting shows (FR-014: entry, section,
 * gap, between, closing, missed, submitted), or null when the
 * sitting is not back to back. Only the exam-room branch reads this; the old
 * runner keeps `mockExamView` unchanged.
 */
export function selfPacedView(state) {
  const sp = state?.selfPaced;
  if (!sp) return null;
  if (!MOCK_LIVE_STATUSES.includes(state.sitting.status)) return 'submitted';
  // The server already names the next section, but it opens only after the
  // gap: a fixed countdown, never the section with its full clock.
  if (sp.state === 'in_progress' && sp.startsInSeconds > 0 && sp.currentSection
    && state.activeSection === sp.currentSection) return 'gap';
  if (isOpenMockSection(state)) return 'section';
  if (sp.state === 'missed') return 'missed';
  if (sp.state === 'not_started') return 'entry';
  // Every section has ended on the server's clock, but the sitting is still
  // live: the sweep is collecting the last one. Not "Opening the next section".
  if (sp.state === 'submitted') return 'closing';
  // Started and no open section on this read: the server is stamping the
  // next one. Never a menu or a "start next" button.
  return 'between';
}

/**
 * The embedded page's `{type:'mock-answers', section, questions:[{q, answered}]}`
 * report (FR-014 submit box), or null when it is not one for `section`.
 */
export function mockFrameQuestions(data, section) {
  if (!data || data.type !== 'mock-answers' || data.section !== section) return null;
  if (!Array.isArray(data.questions) || data.questions.length > 200) return null;
  const list = [];
  for (const item of data.questions) {
    const q = item?.q;
    if (!Number.isInteger(q) || q < 1 || typeof item.answered !== 'boolean') return null;
    list.push({ q, answered: item.answered });
  }
  return list;
}

/**
 * Entry screen facts: total minutes, and the close time when the learner's
 * window ends before a full run would (the only place this device's clock is
 * read, to word a warning; the server still runs the chain past the window).
 */
export function selfPacedEntry(state, nowMs = Date.now()) {
  const sp = state?.selfPaced;
  if (!sp) return null;
  const totalMinutes = Math.ceil((sp.totalSeconds || 0) / 60);
  const closesMs = sp.openUntil ? Date.parse(sp.openUntil) : NaN;
  const shortWindow = Number.isFinite(closesMs) && closesMs - nowMs < (sp.totalSeconds || 0) * 1000;
  return { totalMinutes, closesAt: shortWindow ? sp.openUntil : null, firstSection: configuredMockSections(state)[0] || null };
}

/** The section that came before `section` in this sitting, when it is submitted. */
export function selfPacedPrevious(state, section) {
  const order = configuredMockSections(state);
  const index = order.indexOf(section);
  if (index <= 0) return null;
  const previous = order[index - 1];
  return submittedAtFor(state, previous) ? previous : null;
}

export function configuredMockSections(state) {
  if (state.examMode === 'retake') return [...(state.assignedSkills || [])];
  const sections = [];
  if (state.exam.listeningTestId) sections.push('listening');
  if (state.exam.readingTestCode) sections.push('reading');
  sections.push('writing');
  return sections;
}

export function submittedAtFor(state, section) {
  return state?.sitting?.[`${section}SubmittedAt`] || null;
}

export function isOpenMockSection(state) {
  if (!state || !MOCK_LIVE_STATUSES.includes(state.sitting.status)) return false;
  return configuredMockSections(state).includes(state.activeSection)
    && !submittedAtFor(state, state.activeSection)
    && state.collectedSection !== state.activeSection;
}

export function mockExamView(state) {
  if (!state) return 'loading';
  if (state.sitting.status === 'released') return 'released';
  if (state.sitting.status === 'void') return 'void';
  if (!MOCK_LIVE_STATUSES.includes(state.sitting.status)) return 'submitted';
  if (isOpenMockSection(state)) return 'section';
  return state.examMode === 'retake' ? 'retake-menu' : 'waiting';
}

export function mockPlayerHref(state, section) {
  if (section === 'listening') {
    if (!state.exam.listeningTestId) throw new Error('missing-mock-listening-test');
    return admitCorePlayer('listening_test', {
      id: state.exam.listeningTestId,
      sitting_id: state.sitting.id,
      mock_embed: '1',
      from: 'mock',
    });
  }
  if (section === 'reading') {
    if (!state.exam.readingTestCode) throw new Error('missing-mock-reading-test');
    return admitCorePlayer('reading_exam', {
      test_id: state.exam.readingTestCode,
      sitting_id: state.sitting.id,
      mock_embed: '1',
      from: 'mock',
    });
  }
  throw new Error(`invalid-mock-player-section:${section}`);
}

export function mockSpeakingHref(sessionId) {
  return admitCorePlayer('speaking', { session_id: text(sessionId) });
}

export function mockSpeakingTopic(state) {
  const part1 = state?.exam?.speakingTopicSet?.part1;
  if (Array.isArray(part1)) return text(part1[0]) || 'General';
  return text(part1) || 'General';
}

export function formatMockTime(seconds) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(rest).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function mockWritingTimeAllocation(durationSeconds, fallbackMinutes = 60) {
  const seconds = finiteNonNegative(durationSeconds);
  const fallback = finiteNonNegative(fallbackMinutes, 60);
  const totalMinutes = Math.max(1, Math.round(seconds === null ? fallback : seconds / 60));
  if (totalMinutes < MOCK_WRITING_TIME_SHARE_TOTAL) {
    return Object.freeze({ totalMinutes, task1Minutes: null, task2Minutes: null });
  }
  const task1Minutes = Math.max(1, Math.round(
    totalMinutes * MOCK_WRITING_GUIDANCE.task1.timeShare / MOCK_WRITING_TIME_SHARE_TOTAL,
  ));
  return Object.freeze({
    totalMinutes,
    task1Minutes,
    task2Minutes: Math.max(1, totalMinutes - task1Minutes),
  });
}

export function mockWordCount(value) {
  const trimmed = String(value || '').trim();
  return trimmed ? trimmed.split(/\s+/u).length : 0;
}

export function parseLocalWritingDraft(raw) {
  if (raw == null || raw === '') return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.text === 'string') {
      return Object.freeze({
        text: parsed.text,
        timestamp: finiteNonNegative(parsed.ts, 0),
        synced: typeof parsed.synced === 'boolean' ? parsed.synced : null,
      });
    }
  } catch {}
  return Object.freeze({ text: String(raw), timestamp: 0, synced: null });
}

export function chooseWritingDraft(serverBlob, localDraft) {
  const serverText = typeof serverBlob?.text === 'string' ? serverBlob.text : '';
  const serverTime = serverBlob?.submittedAt ? Date.parse(serverBlob.submittedAt) : 0;
  if (!localDraft) return Object.freeze({ text: serverText, localWon: false });
  if (localDraft.synced === false) {
    return Object.freeze({ text: localDraft.text, localWon: true });
  }
  if (!localDraft.text) return Object.freeze({ text: serverText, localWon: false });
  if (!serverText) return Object.freeze({ text: localDraft.text, localWon: true });
  if (Number.isFinite(serverTime) && serverTime > Number(localDraft.timestamp || 0)) {
    return Object.freeze({ text: serverText, localWon: false });
  }
  return Object.freeze({ text: localDraft.text, localWon: true });
}

export function canDiscardWritingDrafts(serverSubmission, localDrafts) {
  return ['task1', 'task2'].every((task) => {
    const local = localDrafts?.[task];
    if (!local) return true;
    const serverText = typeof serverSubmission?.[task]?.text === 'string'
      ? serverSubmission[task].text
      : '';
    return local.text === serverText;
  });
}

export function isMockSubmitSettled(state, section) {
  if (!state) return false;
  const status = state.sitting.status;
  const terminal = status === 'void' || status === 'released'
    || !MOCK_LIVE_STATUSES.includes(status);
  if (section === 'writing') {
    return terminal || Boolean(submittedAtFor(state, section));
  }
  if (terminal || submittedAtFor(state, section) || state.activeSection !== section) return true;
  return state.collectedSection === section;
}

/** @returns {Record<string, number>} */
export function normalizeIntegrity(raw) {
  const out = {};
  for (const key of ['blur_count', 'blur_seconds', 'resumes', 'offline_events']) {
    const number = Number.parseInt(raw?.[key], 10);
    out[key] = Number.isFinite(number) && number >= 0 ? number : 0;
  }
  return out;
}

// ── EXAMMOCK-0071 T001: exam-room branch helpers (pure) ──────────────────────

/** FR-007: the new branch retries a failed submit 3 times on its own (0066 FR-034); the old branch keeps 4. */
export const MOCK_SUBMIT_AUTO_RETRIES = 3;

/**
 * Submit state of one section for the exam-room branch (EXAMMOCK-0071 FR-007,
 * EXAMROOM-0066 FR-034). Never infers "submitted" from a call having been made.
 * - `confirmed` needs both the server's `*SubmittedAt` for this section of this
 *   sitting and proof the last answers were held: a flush that reported
 *   `unsaved: 0` (Writing: `bridge.flush` with the exact text) before the
 *   submit (`finalFlushSecured`). A `flush-ack` alone is not that proof.
 * - Server closed the section (`*SubmittedAt`, or the sitting is no longer
 *   live) without that proof → `closed_unconfirmed`, with the server's
 *   timestamp only; `savedUpTo` only when the server sent one.
 * - Collected by the invigilator but not submitted yet, no error → `submitting`.
 * - 403/404 → `denied` (the surface keeps "Contact your invigilator.").
 * - Other error → `unconfirmed` (auto retry) up to 3 retries, then
 *   `unconfirmed_manual` ("Try again" calls `submitSection` again).
 * - Rule (2) only applies to a submit this tab started or watched
 *   (`observed`). A section submitted before the tab opened shows only
 *   "✓ Submitted" on the strip: `idle` with `sectionSubmitted: true`.
 * @param {{
 *   state: any,
 *   section: 'listening' | 'reading' | 'writing',
 *   observed: boolean,
 *   finalFlushSecured: boolean,
 *   retries?: number,
 *   error?: { status?: number | null } | null,
 *   serverSavedUpTo?: string | null,
 * }} input
 * @returns {{ outcome: 'idle' | 'submitting' | 'confirmed' | 'unconfirmed' | 'unconfirmed_manual' | 'closed_unconfirmed' | 'denied', retry: boolean, closedAt: string | null, savedUpTo: string | null, sectionSubmitted: boolean }}
 */
export function mockSubmitOutcome({ state, section, observed, finalFlushSecured, retries = 0, error = null, serverSavedUpTo = null }) {
  const submittedAt = submittedAtFor(state, section);
  const live = Boolean(state) && MOCK_LIVE_STATUSES.includes(state.sitting?.status);
  const savedUpTo = typeof serverSavedUpTo === 'string' && serverSavedUpTo ? serverSavedUpTo : null;
  const base = { retry: false, closedAt: null, savedUpTo, sectionSubmitted: Boolean(submittedAt) };
  if (!observed) return { ...base, outcome: 'idle' };
  // Closed only on the server's word: a null state (load pending or failed)
  // is not a closed section (FR-007).
  if (submittedAt || (state && !live)) {
    if (submittedAt && finalFlushSecured) return { ...base, outcome: 'confirmed' };
    return { ...base, outcome: 'closed_unconfirmed', closedAt: submittedAt || null };
  }
  const status = Number(error?.status);
  if (status === 403 || status === 404) return { ...base, outcome: 'denied' };
  if (error) {
    return retries < MOCK_SUBMIT_AUTO_RETRIES
      ? { ...base, outcome: 'unconfirmed', retry: true }
      : { ...base, outcome: 'unconfirmed_manual' };
  }
  return { ...base, outcome: 'submitting' };
}

/** The two Writing tasks, as `q` keys of the 0066 local copy (FR-010). */
export const MOCK_WRITING_COPY_TASKS = Object.freeze(['task1', 'task2']);

/** Old-branch key, read only for the signed-in owner's sitting. */
export function legacyMockWritingKey(sittingId, task) {
  return `mock-writing:${sittingId}:${task}`;
}

/**
 * What to do with the Writing copies when a mock sitting opens in the
 * exam-room branch (EXAMMOCK-0071 FR-010, EXAMROOM-0066 FR-035 amendment 1 (c)).
 * Compared by text only, never by timestamps.
 * - New copy (`exam-room:local-copy:mock:{ownerKey}:{sittingId}`, `q` =
 *   task1/task2, `baseValue` = the spec's `baseText`): re-sent only while the
 *   server text still equals `baseValue`; server changed → keep server; base
 *   unknown and different → ask.
 * - Legacy key `mock-writing:{sittingId}:{task}` (no base): read only when the
 *   sitting belongs to the signed-in account (`ownerMatches`). Equal to the
 *   server → drop it now. Different → never written over the server: ask the
 *   learner, and copy it into the new key first; the legacy key goes only
 *   after that write reads back (`legacyRemovable`) or the server acked it.
 *   A task that already has a new-key entry ignores its older legacy key.
 * - Section closed (`server.open` false): send nothing, clear everything.
 * @param {{
 *   copy: import('./exam-room/local-copy.mjs').LocalCopy | null,
 *   legacy: Partial<Record<'task1' | 'task2', { text: string } | null>>,
 *   server: { open: boolean, task1?: string | null, task2?: string | null },
 *   ownerMatches: boolean,
 * }} input
 */
export function reconcileMockWritingCopy({ copy, legacy, server, ownerMatches }) {
  const serverAnswers = Object.fromEntries(MOCK_WRITING_COPY_TASKS.map((task) => [task, { value: server[task] ?? null }]));
  const plan = planLocalCopyReplay(copy, { open: server.open, answers: serverAnswers });
  /** @type {{ task: string, local: string, server: string, source: 'copy' | 'legacy' }[]} */
  // Writing is text: no server text is '' in both the copy and the legacy rows
  // (the 0066 lib keeps the server's own value, so a missing one is null there).
  const ask = plan.ask.map((a) => ({
    task: a.q,
    local: typeof a.local === 'string' ? a.local : '',
    server: typeof a.server === 'string' ? a.server : '',
    source: 'copy',
  }));
  /** @type {string[]} legacy keys to delete now */
  const dropLegacy = [];
  /** @type {{ q: string, value: string }[]} legacy texts to write into the new key (base unknown) */
  const migrate = [];
  if (ownerMatches) {
    for (const task of MOCK_WRITING_COPY_TASKS) {
      const draft = legacy?.[task];
      if (!draft || typeof draft.text !== 'string') continue;
      const inCopy = Boolean(copy?.answers && Object.prototype.hasOwnProperty.call(copy.answers, task));
      const serverText = typeof server[task] === 'string' ? server[task] : '';
      if (!server.open || inCopy || draft.text === serverText) { dropLegacy.push(task); continue; }
      migrate.push({ q: task, value: draft.text });
      ask.push({ task, local: draft.text, server: serverText, source: 'legacy' });
    }
  }
  return Object.freeze({
    resend: plan.resend.map((r) => ({ task: r.q, value: r.value })),
    keepServer: plan.keepServer,
    ask,
    dropFromCopy: plan.drop,
    clearCopy: !server.open,
    dropLegacy,
    migrate,
  });
}

/**
 * A legacy key may be deleted only once its text is held elsewhere: the new
 * key read back the same text, or the server acked exactly that text.
 * @param {{ legacyText: string, readBack?: string | null, ackedText?: string | null }} input
 */
export function legacyRemovable({ legacyText, readBack = null, ackedText = null }) {
  return readBack === legacyText || ackedText === legacyText;
}

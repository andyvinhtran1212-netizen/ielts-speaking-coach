import { admitCorePlayer } from './core-player-affinity.mjs';

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
  });
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

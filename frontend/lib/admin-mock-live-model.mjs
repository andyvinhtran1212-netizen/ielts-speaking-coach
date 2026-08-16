const TEXT = (value) => typeof value === 'string' ? value.trim() : '';
const SECTION = new Set(['not_started', 'listening', 'reading', 'writing', 'done']);
const TEST_SECTION = new Set(['listening', 'reading', 'writing']);
const STUDENT_STATE = new Set(['absent', 'waiting', 'working', 'submitted', 'missed']);

const nonNegative = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
};

const nonNegativeInteger = (value) => {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
};

const nullableNonNegative = (value) => value == null ? null : nonNegative(value, null);

export function normalizePublishedExams(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.exams)) return null;
  const rows = [];
  const seen = new Set();
  for (const item of raw.exams) {
    if (!item || typeof item !== 'object' || TEXT(item.status) !== 'published') continue;
    const id = TEXT(item.id);
    const examMode = TEXT(item.exam_mode) || 'sequential';
    if (!id || seen.has(id) || !['sequential', 'retake'].includes(examMode)) return null;
    seen.add(id);
    rows.push({
      id,
      code: TEXT(item.code),
      title: TEXT(item.title),
      examMode,
      isOpen: item.is_open === true,
    });
  }
  return rows;
}

function normalizeStudentSection(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const state = TEXT(raw.state);
  if (!STUDENT_STATE.has(state)) return null;
  const answered = nullableNonNegative(raw.answered);
  const total = nullableNonNegative(raw.total);
  if ((raw.answered != null && answered == null) || (raw.total != null && total == null)) return null;
  return {
    state,
    answered,
    total,
    submittedAt: TEXT(raw.submitted_at) || null,
    lastActivityAt: TEXT(raw.last_activity_at) || null,
    live: raw.live !== false,
    stalled: raw.stalled === true,
  };
}

function normalizeLiveStudent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const studentName = TEXT(raw.student_name);
  if (!studentName || !raw.sections || typeof raw.sections !== 'object') return null;
  const sections = {};
  for (const [key, value] of Object.entries(raw.sections)) {
    if (!TEST_SECTION.has(key)) return null;
    const section = normalizeStudentSection(value);
    if (!section) return null;
    sections[key] = section;
  }
  const speaking = raw.speaking && typeof raw.speaking === 'object' ? raw.speaking : {};
  const integrity = raw.integrity && typeof raw.integrity === 'object' ? raw.integrity : {};
  return {
    userId: TEXT(raw.user_id) || null,
    studentName,
    sittingId: TEXT(raw.sitting_id) || null,
    status: TEXT(raw.status) || 'chưa vào',
    started: raw.started === true,
    inRoster: raw.in_roster !== false,
    needsRetest: raw.needs_retest === true,
    assignedSkills: Array.isArray(raw.assigned_skills)
      ? raw.assigned_skills.map(TEXT).filter((item) => TEST_SECTION.has(item))
      : null,
    sections,
    speaking: {
      required: speaking.required === true,
      count: nonNegativeInteger(speaking.count) ?? 0,
      completedAt: TEXT(speaking.completed_at) || null,
    },
    integrity: {
      blurCount: nonNegative(integrity.blur_count),
      blurSeconds: nonNegative(integrity.blur_seconds),
      offlineEvents: nonNegative(integrity.offline_events),
      resumes: nonNegative(integrity.resumes),
    },
  };
}

export function normalizeLiveSnapshot(raw) {
  if (!raw || typeof raw !== 'object' || !raw.exam || typeof raw.exam !== 'object') return null;
  const exam = raw.exam;
  const id = TEXT(exam.id);
  const activeSection = TEXT(exam.active_section);
  const examMode = TEXT(exam.exam_mode) || 'sequential';
  const configuredSections = Array.isArray(exam.configured_sections)
    ? exam.configured_sections.map(TEXT)
    : [];
  if (!id || !SECTION.has(activeSection) || !['sequential', 'retake'].includes(examMode)
      || configuredSections.some((item) => !TEST_SECTION.has(item))
      || new Set(configuredSections).size !== configuredSections.length) return null;
  if (!raw.roster || typeof raw.roster !== 'object' || !raw.sections || typeof raw.sections !== 'object'
      || !Array.isArray(raw.students)) return null;
  const rosterExpected = raw.roster.expected == null ? null : nonNegativeInteger(raw.roster.expected);
  const rosterStarted = nonNegativeInteger(raw.roster.started);
  if ((raw.roster.expected != null && rosterExpected == null) || rosterStarted == null) return null;
  const sections = {};
  for (const section of configuredSections) {
    const value = raw.sections[section];
    if (!value || typeof value !== 'object') return null;
    const counts = Object.fromEntries(['submitted', 'working', 'absent', 'missed', 'expected'].map((key) => [key, nonNegativeInteger(value[key])]));
    if (Object.values(counts).some((count) => count == null)) return null;
    sections[section] = {
      submitted: counts.submitted,
      working: counts.working,
      absent: counts.absent,
      missed: counts.missed,
      expected: counts.expected,
    };
  }
  const students = raw.students.map(normalizeLiveStudent);
  if (students.some((student) => !student)) return null;
  if (students.some((student) => Object.keys(student.sections).some((key) => !configuredSections.includes(key)))) return null;
  const sittingIds = students.map((student) => student.sittingId).filter(Boolean);
  const userIds = students.map((student) => student.userId).filter(Boolean);
  if (new Set(sittingIds).size !== sittingIds.length || new Set(userIds).size !== userIds.length) return null;
  const collectedSection = TEXT(exam.collected_section) || null;
  if (collectedSection && !TEST_SECTION.has(collectedSection)) return null;
  return {
    exam: {
      id,
      code: TEXT(exam.code),
      title: TEXT(exam.title),
      examMode,
      status: TEXT(exam.status),
      isOpen: exam.is_open === true,
      activeSection,
      collectedSection,
      sectionStartedAt: TEXT(exam.section_started_at) || null,
      sectionDurationSeconds: nullableNonNegative(exam.section_duration_seconds),
      sectionTimeLeftSeconds: nullableNonNegative(exam.section_time_left_seconds),
      configuredSections,
      cohortId: TEXT(exam.cohort_id) || null,
    },
    roster: {
      expected: rosterExpected,
      started: rosterStarted,
      notStarted: Array.isArray(raw.roster.not_started) ? raw.roster.not_started.map(TEXT).filter(Boolean) : [],
      offRoster: Array.isArray(raw.roster.off_roster) ? raw.roster.off_roster.map(TEXT).filter(Boolean) : [],
    },
    sections,
    students,
    serverTime: TEXT(raw.server_time) || null,
  };
}

export function liveStudentIsWorking(student) {
  return Object.values(student?.sections || {}).some((section) => section.state === 'working');
}

export function liveStudentNeedsAttention(student) {
  if (!student?.started) return true;
  return Object.values(student.sections || {}).some((section) => (
    section.state === 'missed'
    || (section.state === 'working' && section.live && (section.stalled || section.answered === 0))
  ));
}

export function filterLiveStudents(students, filter) {
  if (filter === 'absent') return students.filter((student) => !student.started);
  if (filter === 'working') return students.filter(liveStudentIsWorking);
  if (filter === 'problem') return students.filter(liveStudentNeedsAttention);
  return students;
}

export function nextConfiguredSection(exam) {
  const sequence = ['not_started', ...(exam?.configuredSections || []), 'done'];
  const index = sequence.indexOf(exam?.activeSection);
  return index >= 0 && index + 1 < sequence.length ? sequence[index + 1] : null;
}

export function clockSeconds(anchor, now = Date.now()) {
  if (!anchor || anchor.seconds == null) return null;
  return Math.max(0, Math.floor(anchor.seconds - Math.max(0, now - anchor.at) / 1000));
}

function normalizeTimeline(raw) {
  if (!Array.isArray(raw)) return null;
  const rows = raw.map((item) => {
    if (!item || typeof item !== 'object' || !['string', 'number'].includes(typeof item.q_num) || !String(item.q_num).trim() || !TEXT(item.at)) return null;
    const gap = nullableNonNegative(item.gap_seconds);
    if (item.gap_seconds != null && gap == null) return null;
    return {
      qNum: String(item.q_num),
      at: TEXT(item.at),
      gapSeconds: gap,
      isAnswered: item.is_answered !== false,
    };
  });
  return rows.some((row) => !row) ? null : rows;
}

function normalizePacingSection(key, raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (key === 'writing') {
    if (!Array.isArray(raw.tasks)) return null;
    return {
      kind: 'writing',
      startedAt: TEXT(raw.started_at) || null,
      endedAt: TEXT(raw.ended_at) || null,
      tasks: raw.tasks.map((task) => ({
        task: TEXT(task?.task),
        wordCount: nullableNonNegative(task?.word_count),
        lastSavedAt: TEXT(task?.last_saved_at) || null,
      })).filter((task) => ['task1', 'task2'].includes(task.task)),
    };
  }
  const timeline = normalizeTimeline(raw.timeline);
  const answered = nullableNonNegative(raw.answered);
  const total = nullableNonNegative(raw.total);
  if (!timeline || (raw.answered != null && answered == null) || (raw.total != null && total == null)) return null;
  return {
    kind: 'questions',
    startedAt: TEXT(raw.started_at) || null,
    endedAt: TEXT(raw.ended_at) || null,
    answered,
    total,
    timeline,
    answersInFinalMinutes: nullableNonNegative(raw.answers_in_final_minutes),
    idleTailSeconds: nullableNonNegative(raw.idle_tail_seconds),
    workedInPaperOrder: typeof raw.worked_in_paper_order === 'boolean' ? raw.worked_in_paper_order : null,
    longGapCount: timeline.filter((item) => item.gapSeconds != null && item.gapSeconds >= 90).length,
  };
}

export function normalizePacing(raw) {
  if (!raw || typeof raw !== 'object' || !TEXT(raw.sitting_id) || !TEXT(raw.exam_id)
      || !raw.sections || typeof raw.sections !== 'object' || !raw.caveats || typeof raw.caveats !== 'object') return null;
  if (raw.caveats.answered_at_is_last_touch !== true
      || raw.caveats.gap_is_time_since_previous_answer !== true) return null;
  const sections = {};
  for (const [key, value] of Object.entries(raw.sections)) {
    if (!TEST_SECTION.has(key)) return null;
    const section = normalizePacingSection(key, value);
    if (!section) return null;
    sections[key] = section;
  }
  return {
    sittingId: TEXT(raw.sitting_id),
    examId: TEXT(raw.exam_id),
    studentName: TEXT(raw.student_name) || '—',
    examCode: TEXT(raw.exam_code),
    status: TEXT(raw.status),
    sections,
  };
}

export function gapBarHeight(seconds, cap = 240) {
  const bounded = Math.min(nonNegative(seconds), cap);
  return Math.max(3, Math.round((bounded / cap) * 80));
}

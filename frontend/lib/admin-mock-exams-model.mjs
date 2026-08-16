const TEXT = (value) => typeof value === 'string' ? value.trim() : '';
const STATUS = new Set(['draft', 'published', 'archived']);
const MODE = new Set(['sequential', 'retake']);
const SECTION = new Set(['not_started', 'listening', 'reading', 'writing', 'done']);
const KIND = new Set(['reading', 'listening', 'writing']);

function sourceList(raw, keys) {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return null;
  for (const key of keys) if (Array.isArray(raw[key])) return raw[key];
  return null;
}

export function normalizeExam(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = TEXT(raw.id);
  const status = TEXT(raw.status) || 'draft';
  const examMode = TEXT(raw.exam_mode) || 'sequential';
  const activeSection = TEXT(raw.active_section) || 'not_started';
  if (!id || !STATUS.has(status) || !MODE.has(examMode) || !SECTION.has(activeSection)) return null;
  return {
    id,
    code: TEXT(raw.code),
    title: TEXT(raw.title),
    status,
    examMode,
    isOpen: raw.is_open === true,
    activeSection,
    cohortId: TEXT(raw.cohort_id) || null,
    listeningTestId: TEXT(raw.listening_test_id) || null,
    readingTestId: TEXT(raw.reading_test_id) || null,
    writingTask1PromptId: TEXT(raw.writing_task1_prompt_id) || null,
    writingTask2PromptId: TEXT(raw.writing_task2_prompt_id) || null,
    totalMinutes: Number.isFinite(Number(raw.total_minutes)) ? Number(raw.total_minutes) : null,
    readingMinutes: Number.isFinite(Number(raw.reading_minutes)) ? Number(raw.reading_minutes) : null,
    writingMinutes: Number.isFinite(Number(raw.writing_minutes)) ? Number(raw.writing_minutes) : null,
  };
}

export function normalizeExamList(raw) {
  const source = sourceList(raw, ['exams']);
  if (!source) return null;
  const rows = [];
  const seen = new Set();
  let malformedCount = 0;
  for (const item of source) {
    const row = normalizeExam(item);
    if (!row || seen.has(row.id)) {
      malformedCount += 1;
      continue;
    }
    seen.add(row.id);
    rows.push(row);
  }
  return { rows, malformedCount };
}

export function normalizePickerList(raw, keys = []) {
  const source = sourceList(raw, keys);
  if (!source) return null;
  return source.filter((row) => row && typeof row === 'object' && TEXT(row.id));
}

export function configuredSections(exam) {
  if (!exam) return ['not_started', 'done'];
  const out = ['not_started'];
  if (exam.listeningTestId) out.push('listening');
  if (exam.readingTestId) out.push('reading');
  out.push('writing', 'done');
  return out;
}

export function nextExamSection(exam, fromSection) {
  const sections = configuredSections(exam);
  const index = sections.indexOf(TEXT(fromSection));
  return index >= 0 && index + 1 < sections.length ? sections[index + 1] : null;
}

export function retakeServableSkills(exam) {
  const out = [];
  if (exam?.listeningTestId) out.push('listening');
  if (exam?.readingTestId) out.push('reading');
  out.push('writing');
  return out;
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function buildExamCreatePayload(form) {
  const code = TEXT(form?.code);
  const title = TEXT(form?.title);
  const examMode = MODE.has(TEXT(form?.examMode)) ? TEXT(form.examMode) : 'sequential';
  const cohortId = TEXT(form?.cohortId);
  if (!code || !title) return { ok: false, error: 'Nhập mã đề và tiêu đề.' };
  if (examMode === 'sequential' && !cohortId) {
    return { ok: false, error: 'Chọn lớp tham gia cho đề sequential.' };
  }
  return {
    ok: true,
    value: {
      code,
      title,
      exam_mode: examMode,
      total_minutes: positiveInteger(form?.totalMinutes, 150),
      reading_minutes: positiveInteger(form?.readingMinutes, 60),
      writing_minutes: positiveInteger(form?.writingMinutes, 60),
      listening_test_id: TEXT(form?.listeningTestId) || null,
      reading_test_id: TEXT(form?.readingTestId) || null,
      writing_task1_prompt_id: TEXT(form?.writingTask1PromptId) || null,
      writing_task2_prompt_id: TEXT(form?.writingTask2PromptId) || null,
      cohort_id: cohortId || null,
    },
  };
}

export function normalizeProgress(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const activeSection = TEXT(raw.active_section);
  if (!SECTION.has(activeSection)) return null;
  const source = raw.sections && typeof raw.sections === 'object' ? raw.sections : {};
  const sections = {};
  for (const key of ['listening', 'reading', 'writing']) {
    const row = source[key] && typeof source[key] === 'object' ? source[key] : {};
    sections[key] = {
      submitted: Math.max(0, Number.parseInt(String(row.submitted ?? 0), 10) || 0),
      total: Math.max(0, Number.parseInt(String(row.total ?? 0), 10) || 0),
    };
  }
  return { activeSection, sections };
}

export function normalizeAssignments(raw) {
  const source = sourceList(raw, ['assignments']);
  if (!source) return null;
  return source.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const userId = TEXT(row.user_id);
    if (!userId) return [];
    return [{
      userId,
      studentName: TEXT(row.student_name) || userId,
      skills: Array.isArray(row.skills) ? row.skills.map(TEXT).filter((skill) => ['listening', 'reading', 'writing'].includes(skill)) : [],
      openFrom: TEXT(row.open_from) || null,
      openUntil: TEXT(row.open_until) || null,
    }];
  });
}

export function normalizeRetestSummary(raw) {
  const source = sourceList(raw?.students || raw, ['students']);
  if (!source) return null;
  return source.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const userId = TEXT(row.user_id);
    if (!userId) return [];
    return [{
      userId,
      studentName: TEXT(row.student_name) || userId,
      skills: Array.isArray(row.skills) ? row.skills.map(TEXT).filter((skill) => ['listening', 'reading', 'writing'].includes(skill)) : [],
    }];
  });
}

export function mergeRetestCandidates(rows, servableSkills = ['listening', 'reading', 'writing']) {
  const allowed = new Set(servableSkills);
  const merged = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row?.userId) continue;
    const current = merged.get(row.userId) || {
      userId: row.userId,
      studentName: row.studentName || row.userId,
      skills: new Set(),
    };
    for (const skill of Array.isArray(row.skills) ? row.skills : []) {
      if (allowed.has(skill)) current.skills.add(skill);
    }
    merged.set(row.userId, current);
  }
  return [...merged.values()].map((row) => ({
    userId: row.userId,
    studentName: row.studentName,
    skills: ['listening', 'reading', 'writing'].filter((skill) => row.skills.has(skill)),
  }));
}

export function normalizeExamContent(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items)) return null;
  const rows = raw.items.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const id = TEXT(row.id);
    const kind = TEXT(row.kind);
    if (!id || !KIND.has(kind)) return [];
    return [{
      id,
      kind,
      code: TEXT(row.code),
      title: TEXT(row.title),
      status: TEXT(row.status),
      courseLevel: TEXT(row.course_level),
      cohortIds: Array.isArray(row.cohort_ids) ? row.cohort_ids.map(String) : [],
      examOnly: row.exam_only === true,
    }];
  });
  return {
    rows,
    levels: Array.isArray(raw.levels) ? raw.levels.map(TEXT).filter(Boolean) : [],
    failedKinds: Array.isArray(raw.failed_kinds) ? raw.failed_kinds.map(TEXT).filter((kind) => KIND.has(kind)) : [],
  };
}

export function filterContentByLevel(rows, level) {
  if (level === null) return rows;
  return rows.filter((row) => row.courseLevel === level);
}

export function localDateTimeIn(days, now = Date.now()) {
  const date = new Date(now + days * 86_400_000);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function localToIso(value) {
  const text = TEXT(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

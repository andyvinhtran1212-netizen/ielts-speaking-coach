import { listeningTestListHref } from './admin-listening-content-model.mjs';

const objectOf = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const textOf = (value) => typeof value === 'string' ? value.trim() : '';
const integer = (value) => typeof value === 'number' && Number.isInteger(value) ? value : null;
const finiteNumber = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const stringList = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string')
  ? value.map((item) => item.trim()).filter(Boolean) : null;

export const FULLTEST_MAX_TEXT_BYTES = 2 * 1024 * 1024;
export const FULLTEST_MAX_AUDIO_BYTES = 60 * 1024 * 1024;

export const FULLTEST_FILE_SLOTS = Object.freeze([
  { field: 'questionPaper', label: 'Question Paper', accept: '.md,.markdown', extensions: ['.md', '.markdown'], kind: 'text' },
  { field: 'solution', label: 'Solution & answer key', accept: '.md,.markdown', extensions: ['.md', '.markdown'], kind: 'text' },
  { field: 'timings', label: 'Timing map', accept: 'application/json,.json', extensions: ['.json'], kind: 'text' },
  { field: 'audio', label: 'Full audio', accept: 'audio/mpeg,.mp3', extensions: ['.mp3'], kind: 'audio' },
]);

export function routeFulltestFile(name) {
  const normalized = textOf(name).toLocaleLowerCase('vi');
  if (normalized.endsWith('.json')) return 'timings';
  if (normalized.endsWith('.mp3')) return 'audio';
  if (normalized.endsWith('.md') || normalized.endsWith('.markdown')) {
    return /solution|answer|chua|chữa|giai|giải/.test(normalized) ? 'solution' : 'questionPaper';
  }
  return null;
}

export function validateFulltestFiles(files) {
  const errors = {};
  for (const slot of FULLTEST_FILE_SLOTS) {
    const file = files?.[slot.field];
    if (!file) { errors[slot.field] = `Chưa chọn ${slot.label}.`; continue; }
    const name = textOf(file.name).toLocaleLowerCase('vi');
    if (!slot.extensions.some((extension) => name.endsWith(extension))) {
      errors[slot.field] = `${slot.label} phải là ${slot.extensions.join(' hoặc ')}.`;
      continue;
    }
    const size = integer(file.size);
    if (size == null || size <= 0) errors[slot.field] = `${slot.label} đang rỗng.`;
    else if (slot.kind === 'audio' && size > FULLTEST_MAX_AUDIO_BYTES) errors[slot.field] = `${slot.label} vượt giới hạn 60 MB.`;
    else if (slot.kind === 'text' && size > FULLTEST_MAX_TEXT_BYTES) errors[slot.field] = `${slot.label} vượt giới hạn 2 MB.`;
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

export function fulltestDescriptorFingerprint(descriptors, mini = false) {
  if (!descriptors || typeof descriptors !== 'object') return null;
  const values = [];
  for (const slot of FULLTEST_FILE_SLOTS) {
    const row = objectOf(descriptors[slot.field]);
    const name = textOf(row?.name);
    const size = integer(row?.size);
    const digest = textOf(row?.digest).toLocaleLowerCase('en');
    if (!row || !name || size == null || size <= 0 || !/^[a-f0-9]{64}$/.test(digest)) return null;
    values.push(`${slot.field}:${name}:${size}:${digest}`);
  }
  return `${mini ? 'mini' : 'full'}|${values.join('|')}`;
}

function sectionNumber(value, questionNumber) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 4) return value;
  const raw = textOf(value);
  if (raw) {
    const match = raw.match(/^(?:section\s*|s)?([1-4])$/i);
    return match ? Number(match[1]) : null;
  }
  return Math.min(4, Math.max(1, Math.floor((questionNumber - 1) / 10) + 1));
}

function normalizeOption(raw) {
  if (typeof raw === 'string') return { label: '', text: raw.trim() };
  const value = objectOf(raw);
  if (!value || (typeof value.text !== 'string' && typeof value.label !== 'string' && typeof value.letter !== 'string')) return null;
  return { label: textOf(value.letter) || textOf(value.label), text: textOf(value.text) };
}

function normalizeQuestion(raw) {
  const value = objectOf(raw);
  const number = integer(value?.q_num);
  if (!value || number == null || number < 1 || number > 100 || typeof value.prompt !== 'string') return null;
  const section = sectionNumber(value.section, number);
  if (section == null) return null;
  const options = [];
  if (value.options != null) {
    if (!Array.isArray(value.options)) return null;
    for (const candidate of value.options) {
      const option = normalizeOption(candidate);
      if (!option) return null;
      options.push(option);
    }
  }
  if (!['string', 'number'].includes(typeof value.answer) && value.answer != null) return null;
  return {
    number,
    section,
    prompt: value.prompt.trim(),
    options,
    answer: value.answer == null ? '' : String(value.answer).trim(),
    imagePrompt: textOf(value.img_prompt),
  };
}

export function normalizeFulltestPreview(raw) {
  const value = objectOf(raw);
  if (!value || typeof value.ok !== 'boolean') return null;
  const errors = stringList(value.errors);
  const warnings = stringList(value.warnings);
  const metadata = objectOf(value.metadata) || {};
  if (!errors || !warnings || (value.ok && errors.length)) return null;
  const sectionCount = integer(value.section_count);
  const questionCount = integer(value.question_count);
  if (sectionCount != null && (sectionCount < 0 || sectionCount > 4)) return null;
  if (questionCount != null && (questionCount < 0 || questionCount > 100)) return null;
  const questions = [];
  if (value.questions != null) {
    if (!Array.isArray(value.questions)) return null;
    for (const candidate of value.questions) {
      const row = normalizeQuestion(candidate);
      if (!row || questions.some((question) => question.number === row.number)) return null;
      questions.push(row);
    }
  }
  questions.sort((left, right) => left.number - right.number);
  if (questionCount != null && questions.length !== questionCount) return null;
  const testId = textOf(metadata.test_id);
  const distinctSections = new Set(questions.map((question) => question.section)).size;
  if (value.ok && (!testId || sectionCount == null || questionCount == null || !questions.length
    || distinctSections !== sectionCount || questions.some((question) => !question.answer))) return null;
  return {
    ok: value.ok,
    duplicate: value.duplicate_test_id === true,
    errors,
    warnings,
    testId,
    title: textOf(metadata.title) || testId,
    formatVersion: textOf(metadata.format_version),
    transcriptSource: textOf(metadata.transcript_source),
    sectionCount,
    questionCount,
    questions,
  };
}

export function groupFulltestQuestions(questions) {
  const sections = [];
  for (const question of Array.isArray(questions) ? questions : []) {
    let section = sections.find((item) => item.number === question.section);
    if (!section) { section = { number: question.section, questions: [] }; sections.push(section); }
    section.questions.push(question);
  }
  sections.sort((left, right) => left.number - right.number);
  return sections;
}

export function fulltestImagePromptBlocks(questions) {
  const blocks = [];
  for (const section of groupFulltestQuestions(questions)) {
    let current = null;
    for (const question of section.questions) {
      if (current && question.imagePrompt && question.imagePrompt === current.prompt && question.number === current.last + 1) {
        current.last = question.number;
      } else {
        if (current) blocks.push(current);
        current = question.imagePrompt ? { section: section.number, first: question.number, last: question.number, prompt: question.imagePrompt } : null;
      }
    }
    if (current) blocks.push(current);
  }
  return blocks;
}

export function normalizeFulltestCommit(raw, expectedTestId) {
  const value = objectOf(raw);
  const audio = objectOf(value?.audio);
  const id = textOf(value?.id);
  const testId = textOf(value?.test_id);
  const sectionsCreated = integer(value?.sections_created);
  const exercisesCreated = integer(value?.exercises_created);
  const sizeBytes = integer(audio?.size_bytes);
  const durationSeconds = finiteNumber(audio?.duration_seconds);
  const warnings = stringList(value?.warnings);
  if (!value || !audio || !id || !testId || testId !== expectedTestId || value.status !== 'draft'
    || sectionsCreated == null || sectionsCreated < 1 || exercisesCreated == null || exercisesCreated < 1
    || sizeBytes == null || sizeBytes < 1 || durationSeconds == null || durationSeconds <= 0 || !warnings) return null;
  return { id, testId, status: 'draft', sectionsCreated, exercisesCreated, sizeBytes, durationSeconds, warnings };
}

/**
 * @param {unknown} raw
 * @param {string} expectedId
 * @param {string} expectedTestId
 * @param {'draft'|'published'|'archived'|null} [expectedStatus]
 * @param {'full'|'mini'|null} [expectedType]
 */
export function normalizeFulltestCanonical(raw, expectedId, expectedTestId, expectedStatus = null, expectedType = null) {
  const value = objectOf(raw);
  const id = textOf(value?.id);
  const testId = textOf(value?.test_id);
  const status = textOf(value?.status);
  const type = textOf(value?.test_type);
  if (!value || id !== expectedId || testId !== expectedTestId || !['draft', 'published', 'archived'].includes(status)
    || !['full', 'mini'].includes(type) || !Array.isArray(value.sections) || !Array.isArray(value.plan_label_exercises)
    || (expectedStatus && status !== expectedStatus) || (expectedType && type !== expectedType)) return null;
  const sectionIds = new Set();
  for (const section of value.sections) {
    const row = objectOf(section);
    const sectionId = textOf(row?.id);
    const number = integer(row?.section_num);
    if (!row || !sectionId || number == null || number < 1 || number > 4 || sectionIds.has(sectionId)) return null;
    sectionIds.add(sectionId);
  }
  if (!sectionIds.size || (type === 'mini' && sectionIds.size !== 1) || (type === 'full' && sectionIds.size !== 4)) return null;
  return { id, testId, status, type, title: textOf(value.title) || testId, sectionCount: sectionIds.size };
}

export function normalizeFulltestSearch(raw, expectedTestId, baselineIds = []) {
  const value = objectOf(raw);
  const total = integer(value?.total);
  const limit = integer(value?.limit);
  const offset = integer(value?.offset);
  if (!value || !Array.isArray(value.items) || total == null || total < 0 || limit == null || limit < 1 || limit > 100
    || offset == null || offset < 0 || value.items.length > limit || (value.items.length && total < offset + value.items.length)) return null;
  const baseline = new Set(Array.isArray(baselineIds) ? baselineIds.map(textOf).filter(Boolean) : []);
  const matches = [];
  let malformedCount = 0;
  for (const candidate of value.items) {
    const row = objectOf(candidate);
    const id = textOf(row?.id);
    const testId = textOf(row?.test_id);
    const status = textOf(row?.status);
    const type = textOf(row?.test_type);
    if (!row || !id || !testId || !['draft', 'published', 'archived'].includes(status) || !['full', 'mini', 'drill', 'practice'].includes(type)) {
      malformedCount += 1; continue;
    }
    if (testId === expectedTestId) matches.push({ id, testId, status, type, baseline: baseline.has(id) });
  }
  return { matches, newMatches: matches.filter((row) => !row.baseline), malformedCount, total, limit, offset, itemCount: value.items.length };
}

export function fulltestImportReceiptKey(account) {
  return `alfi-pending:${encodeURIComponent(textOf(account))}:v1`;
}

export function buildFulltestImportReceipt({ account, testId, fingerprint, mini, baselineIds, acknowledgedId = null, startedAt = new Date().toISOString() }) {
  return { account: textOf(account), testId: textOf(testId), fingerprint: textOf(fingerprint), mini: mini === true,
    baselineIds: Array.from(new Set((baselineIds || []).map(textOf).filter(Boolean))), acknowledgedId: textOf(acknowledgedId) || null, startedAt };
}

export function normalizeFulltestImportReceipt(raw, expectedAccount) {
  const value = objectOf(raw);
  const account = textOf(value?.account);
  const testId = textOf(value?.testId);
  const fingerprint = textOf(value?.fingerprint);
  const startedAt = textOf(value?.startedAt);
  if (!value || !account || account !== expectedAccount || !testId || !fingerprint || !startedAt || Number.isNaN(Date.parse(startedAt))
    || typeof value.mini !== 'boolean' || !Array.isArray(value.baselineIds) || !value.baselineIds.every((id) => typeof id === 'string')) return null;
  return buildFulltestImportReceipt({ ...value, account, testId, fingerprint, startedAt });
}

export function fulltestTestsHref(testId) {
  return listeningTestListHref({ search: textOf(testId) });
}

export function formatFulltestBytes(bytes) {
  const value = integer(bytes);
  if (value == null || value < 0) return '—';
  return value >= 1024 * 1024 ? `${(value / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(value / 1024))} KB`;
}

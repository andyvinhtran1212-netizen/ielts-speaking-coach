import { listeningTestListHref } from './admin-listening-content-model.mjs';

const objectOf = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const textOf = (value) => typeof value === 'string' ? value.trim() : '';
const integer = (value) => typeof value === 'number' && Number.isInteger(value) ? value : null;
const finite = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const stringList = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string')
  ? value.map((item) => item.trim()).filter(Boolean) : null;

export const DRILL_MAX_TEXT_BYTES = 2 * 1024 * 1024;
export const DRILL_MAX_AUDIO_BYTES = 30 * 1024 * 1024;
export const DRILL_TYPES = Object.freeze([
  'flowchart', 'form', 'note', 'sentence', 'summary', 'table',
  'short_answer', 'mcq', 'mcq_multi', 'matching', 'map',
]);

const SOURCE_RE = /^(ILR-LIS-DRL-[A-Z0-9_-]+)\.json$/i;

export function drillTestIdFromSource(name) {
  return textOf(name).match(SOURCE_RE)?.[1] || null;
}

function relativePath(file) {
  return textOf(file?.webkitRelativePath) || textOf(file?.name);
}

function fileError(file, kind) {
  const size = integer(file?.size);
  if (size == null || size <= 0) return `${kind} đang rỗng.`;
  if ((kind === 'Source JSON' || kind === 'timings.json') && size > DRILL_MAX_TEXT_BYTES) return `${kind} vượt giới hạn 2 MB.`;
  if (kind === 'full_test.mp3' && size > DRILL_MAX_AUDIO_BYTES) return `${kind} vượt giới hạn 30 MB.`;
  return null;
}

/**
 * Group a browser FileList without guessing ownership. Directory selections
 * must use Source_JSON/<TEST_ID>.json and
 * audio_output/<TEST_ID>/{timings.json,full_test.mp3}; loose accessories attach
 * only when there is exactly one loose source JSON in the same selection.
 */
export function groupDrillFiles(input) {
  const files = Array.from(input || []);
  const sources = [];
  const routed = [];
  const loose = [];
  const ignored = [];
  const unassigned = [];

  for (const file of files) {
    const name = textOf(file?.name);
    const path = relativePath(file).replace(/\\/g, '/');
    const parts = path.split('/').filter(Boolean);
    const hasDirectoryPath = Boolean(textOf(file?.webkitRelativePath));
    const id = drillTestIdFromSource(name);
    if (id) {
      const sourceIndex = parts.findIndex((part) => part.toLocaleLowerCase('en') === 'source_json');
      const canonicalSourcePath = sourceIndex >= 0 && parts.length === sourceIndex + 2 && parts[sourceIndex + 1] === name;
      if (!hasDirectoryPath || canonicalSourcePath) sources.push({ id, file });
      else unassigned.push(path);
      continue;
    }
    const audioIndex = parts.findIndex((part) => part.toLocaleLowerCase('en') === 'audio_output');
    const lower = name.toLocaleLowerCase('en');
    const canonicalAccessoryPath = audioIndex >= 0 && parts[audioIndex + 1]
      && parts.length === audioIndex + 3 && parts[audioIndex + 2] === name;
    if (canonicalAccessoryPath && ['timings.json', 'full_test.mp3'].includes(lower)) {
      routed.push({ id: parts[audioIndex + 1], kind: lower === 'timings.json' ? 'timings' : 'audio', file });
    } else if (!textOf(file?.webkitRelativePath) && ['timings.json', 'full_test.mp3'].includes(lower)) {
      loose.push({ kind: lower === 'timings.json' ? 'timings' : 'audio', file });
    } else if (['timings.json', 'full_test.mp3'].includes(lower)) {
      unassigned.push(path);
    } else ignored.push(name || '(không tên)');
  }

  const byId = new Map();
  for (const source of sources) {
    const key = source.id.toLocaleUpperCase('en');
    const current = byId.get(key) || { testId: source.id, source: null, timings: null, audio: null, errors: [] };
    if (current.source) current.errors.push(`Có nhiều Source JSON cho ${source.id}; chưa thể chọn bản đúng.`);
    else current.source = source.file;
    byId.set(key, current);
  }

  for (const item of routed) {
    const current = byId.get(item.id.toLocaleUpperCase('en'));
    if (!current) { unassigned.push(relativePath(item.file)); continue; }
    if (current[item.kind]) current.errors.push(`Có nhiều ${item.kind === 'timings' ? 'timings.json' : 'full_test.mp3'} cho ${current.testId}.`);
    else current[item.kind] = item.file;
  }

  const globalErrors = [];
  if (loose.length && sources.length !== 1) {
    globalErrors.push(`Có ${loose.length} file phụ chọn rời nhưng ${sources.length} Source JSON; không thể ghép theo Test ID mà không đoán.`);
    unassigned.push(...loose.map((item) => textOf(item.file?.name)));
  } else if (loose.length === 1 || loose.length === 2) {
    const current = byId.values().next().value;
    for (const item of loose) {
      if (current[item.kind]) current.errors.push(`Có nhiều ${item.kind === 'timings' ? 'timings.json' : 'full_test.mp3'} cho ${current.testId}.`);
      else current[item.kind] = item.file;
    }
  } else if (loose.length > 2) {
    globalErrors.push('Có nhiều file phụ cùng loại trong lựa chọn rời; hãy chọn một thư mục có cấu trúc audio_output/<TEST_ID>/.');
    unassigned.push(...loose.map((item) => textOf(item.file?.name)));
  }

  const bundles = Array.from(byId.values()).sort((left, right) => left.testId.localeCompare(right.testId, 'en'));
  for (const bundle of bundles) {
    const sourceError = fileError(bundle.source, 'Source JSON');
    const timingsError = bundle.timings ? fileError(bundle.timings, 'timings.json') : null;
    const audioError = bundle.audio ? fileError(bundle.audio, 'full_test.mp3') : null;
    if (sourceError) bundle.errors.push(sourceError);
    if (timingsError) bundle.errors.push(timingsError);
    if (audioError) bundle.errors.push(audioError);
    if (bundle.audio && !bundle.timings) bundle.errors.push('Có full_test.mp3 nhưng thiếu timings.json; audio không được phép bị bỏ qua âm thầm.');
  }
  if (!bundles.length) globalErrors.push('Không tìm thấy Source JSON có tên ILR-LIS-DRL-*.json.');
  return { bundles, errors: globalErrors, unassigned, ignored };
}

export function validateDrillBundle(bundle) {
  const errors = Array.isArray(bundle?.errors) ? bundle.errors.filter(Boolean) : [];
  if (!bundle?.source || !textOf(bundle?.testId)) errors.push('Thiếu Source JSON hoặc Test ID.');
  return { ok: errors.length === 0, errors: Array.from(new Set(errors)) };
}

export function drillDescriptorFingerprint(descriptors) {
  const value = objectOf(descriptors);
  if (!value) return null;
  const parts = [];
  for (const field of ['source', 'timings', 'audio']) {
    const row = objectOf(value[field]);
    if (!row) { if (field === 'source') return null; parts.push(`${field}:none`); continue; }
    const name = textOf(row.name);
    const size = integer(row.size);
    const digest = textOf(row.digest).toLocaleLowerCase('en');
    if (!name || size == null || size <= 0 || !/^[a-f0-9]{64}$/.test(digest)) return null;
    parts.push(`${field}:${name}:${size}:${digest}`);
  }
  return parts.join('|');
}

export function normalizeDrillPreview(raw, expectedTestId) {
  const value = objectOf(raw);
  const returnedTestId = textOf(value?.test_id);
  const drillType = textOf(value?.drill_type);
  const level = textOf(value?.level);
  const task = textOf(value?.task);
  const count = integer(value?.question_count);
  const errors = stringList(value?.errors);
  const warnings = stringList(value?.warnings);
  if (!value || typeof value.ok !== 'boolean' || !errors || !warnings
    || (returnedTestId && returnedTestId !== expectedTestId) || (value.ok && returnedTestId !== expectedTestId)
    || (value.ok && !DRILL_TYPES.includes(drillType)) || count == null || count < (value.ok ? 1 : 0) || count > 100
    || typeof value.has_audio !== 'boolean'
    || (value.ok && errors.length)) return null;
  return { ok: value.ok, duplicate: value.duplicate_test_id === true, testId: expectedTestId, title: textOf(value.title) || expectedTestId,
    drillType: drillType || 'unknown', level, task, questionCount: count, timingReady: value.has_audio, errors, warnings };
}

export function normalizeDrillCommit(raw, expected) {
  const value = objectOf(raw);
  const id = textOf(value?.id);
  const testId = textOf(value?.test_id);
  const drillType = textOf(value?.drill_type);
  const level = textOf(value?.level);
  const exercises = integer(value?.exercises_created);
  const warnings = stringList(value?.warnings);
  if (!value || !id || testId !== expected.testId || value.status !== 'draft'
    || drillType !== expected.drillType || level !== expected.level
    || value.has_audio !== expected.hasAudio || exercises == null || exercises < 1 || !warnings) return null;
  return { id, testId, status: 'draft', drillType, level, hasAudio: value.has_audio, exercisesCreated: exercises, warnings };
}

export function normalizeDrillCanonical(raw, expected) {
  const value = objectOf(raw);
  const metadata = objectOf(value?.metadata);
  const id = textOf(value?.id);
  const testId = textOf(value?.test_id);
  const status = textOf(value?.status);
  if (!value || !metadata || id !== expected.id || testId !== expected.testId || value.test_type !== 'drill'
    || !['draft', 'published', 'archived'].includes(status) || (expected.status && status !== expected.status)
    || textOf(metadata.drill_type) !== expected.drillType || textOf(metadata.level) !== expected.level
    || !Array.isArray(value.sections) || value.sections.length !== 1 || !Array.isArray(value.plan_label_exercises)) return null;
  const section = objectOf(value.sections[0]);
  const sectionId = textOf(section?.id);
  const sectionNum = integer(section?.section_num);
  const exerciseCount = integer(section?.exercise_count);
  if (!section || !sectionId || sectionNum == null || sectionNum < 1 || sectionNum > 4 || exerciseCount == null || exerciseCount < 1) return null;
  const audioPath = textOf(value.full_audio_storage_path);
  const audioDuration = finite(value.full_audio_duration_seconds);
  const audioSize = integer(value.full_audio_size_bytes);
  const canonicalHasAudio = Boolean(audioPath && audioDuration != null && audioDuration > 0 && audioSize != null && audioSize > 0);
  const orphanAudioMetadata = !audioPath && ((audioDuration != null && audioDuration > 0) || (audioSize != null && audioSize > 0));
  if (canonicalHasAudio !== expected.hasAudio || (!expected.hasAudio && audioPath) || orphanAudioMetadata) return null;
  return { id, testId, title: textOf(value.title) || testId, status, drillType: expected.drillType,
    level: expected.level, hasAudio: canonicalHasAudio, sectionNum, exerciseCount };
}

export function normalizeDrillSearch(raw, expectedTestId, baselineIds = []) {
  const value = objectOf(raw);
  const total = integer(value?.total);
  const limit = integer(value?.limit);
  const offset = integer(value?.offset);
  if (!value || !Array.isArray(value.items) || total == null || total < 0 || limit == null || limit < 1 || limit > 100
    || offset == null || offset < 0 || value.items.length > limit || (value.items.length && total < offset + value.items.length)) return null;
  const baseline = new Set((Array.isArray(baselineIds) ? baselineIds : []).map(textOf).filter(Boolean));
  const matches = [];
  let malformedCount = 0;
  for (const candidate of value.items) {
    const row = objectOf(candidate);
    const id = textOf(row?.id);
    const testId = textOf(row?.test_id);
    const status = textOf(row?.status);
    const type = textOf(row?.test_type);
    if (!row || !id || !testId || !['draft', 'published', 'archived'].includes(status)
      || !['full', 'mini', 'drill', 'practice'].includes(type)) { malformedCount += 1; continue; }
    if (testId === expectedTestId) matches.push({ id, testId, status, type, baseline: baseline.has(id) });
  }
  return { matches, newMatches: matches.filter((row) => !row.baseline), malformedCount, total, limit, offset, itemCount: value.items.length };
}

export function drillImportReceiptKey(account) {
  return `aldi-pending:${encodeURIComponent(textOf(account))}:v1`;
}

export function buildDrillImportReceipt({ account, testId, fingerprint, drillType, level, hasAudio, baselineIds, acknowledgedId = null, startedAt = new Date().toISOString() }) {
  return { account: textOf(account), testId: textOf(testId), fingerprint: textOf(fingerprint), drillType: textOf(drillType), level: textOf(level),
    hasAudio: hasAudio === true, baselineIds: Array.from(new Set((baselineIds || []).map(textOf).filter(Boolean))),
    acknowledgedId: textOf(acknowledgedId) || null, startedAt };
}

export function normalizeDrillImportReceipt(raw, expectedAccount) {
  const value = objectOf(raw);
  const account = textOf(value?.account);
  const testId = textOf(value?.testId);
  const fingerprint = textOf(value?.fingerprint);
  const drillType = textOf(value?.drillType);
  const startedAt = textOf(value?.startedAt);
  if (!value || account !== expectedAccount || !account || !testId || !fingerprint || !DRILL_TYPES.includes(drillType)
    || typeof value.level !== 'string' || typeof value.hasAudio !== 'boolean' || !startedAt || Number.isNaN(Date.parse(startedAt))
    || !Array.isArray(value.baselineIds) || !value.baselineIds.every((id) => typeof id === 'string')) return null;
  return buildDrillImportReceipt({ ...value, account, testId, fingerprint, drillType, startedAt });
}

export function drillTestsHref(testId) {
  return listeningTestListHref({ search: textOf(testId) });
}

export function formatDrillBytes(bytes) {
  const value = integer(bytes);
  if (value == null || value < 0) return '—';
  if (value === 0) return '0 KB';
  return value >= 1024 * 1024 ? `${(value / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(value / 1024))} KB`;
}

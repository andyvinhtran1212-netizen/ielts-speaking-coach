const STATUSES = new Set(['draft', 'published', 'archived']);
const TEST_TYPES = new Set(['full', 'mini', 'drill', 'practice']);
const AUDIO_MODES = new Set(['full_premixed', 'parts_auto_assembled', 'parts_only']);
const MAP_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

const objectOf = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const textOf = (value) => typeof value === 'string' ? value.trim() : '';
const nullableText = (value) => textOf(value) || null;
const finiteNumber = (value) => value === null || value === undefined || value === '' || typeof value === 'boolean'
  ? null
  : Number.isFinite(Number(value)) ? Number(value) : null;
const integer = (value) => {
  const number = finiteNumber(value);
  return number != null && Number.isInteger(number) ? number : null;
};
const safeHttpUrl = (value) => {
  const raw = nullableText(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch { return null; }
};

export const LISTENING_TEST_STATUS_LABEL = Object.freeze({
  draft: 'Bản nháp', published: 'Đã phát hành', archived: 'Đã lưu trữ',
});

export const LISTENING_TEST_TYPE_LABEL = Object.freeze({
  full: 'Full test', mini: 'Mini test', drill: 'Skill drill', practice: 'Quick practice',
});

export const LISTENING_AUDIO_MODE_LABEL = Object.freeze({
  full_premixed: 'Full pre-mixed',
  parts_auto_assembled: 'Parts + Web auto-assemble',
  parts_only: 'Parts only',
});

function normalizeSection(raw, expectedTestId) {
  const value = objectOf(raw);
  const id = textOf(value?.id);
  const number = integer(value?.section_num);
  const status = textOf(value?.status);
  const exerciseCount = integer(value?.exercise_count);
  if (!value || !id || number == null || number < 1 || number > 4
    || !STATUSES.has(status) || exerciseCount == null || exerciseCount < 0) return null;
  const audioStoragePath = nullableText(value.audio_storage_path);
  if (typeof value.audio_ready === 'boolean' && value.audio_ready !== Boolean(audioStoragePath)) return null;
  return {
    id,
    testId: expectedTestId,
    number,
    title: textOf(value.title) || `Section ${number}`,
    status,
    audioStoragePath,
    audioReady: Boolean(audioStoragePath),
    exerciseCount,
  };
}

function normalizePlanExercise(raw) {
  const value = objectOf(raw);
  const id = textOf(value?.id);
  const contentId = textOf(value?.content_id);
  const sectionNumber = integer(value?.section_num);
  if (!value || !id || !contentId || sectionNumber == null || sectionNumber < 1 || sectionNumber > 4
    || typeof value.has_map_image !== 'boolean') return null;
  const source = textOf(value.map_image_source);
  return {
    id,
    contentId,
    sectionNumber,
    mapDescription: textOf(value.map_description),
    letterOptions: Array.isArray(value.letter_options) ? value.letter_options.map(textOf).filter(Boolean) : [],
    hasMapImage: value.has_map_image,
    mapImageModel: nullableText(value.map_image_model),
    mapImageSource: source === 'manual_upload' || source === 'api_generation' ? source : null,
    mapImageGeneratedAt: nullableText(value.map_image_generated_at),
  };
}

function normalizeCue(raw) {
  const value = objectOf(raw);
  const type = textOf(value?.type);
  const sectionNumber = integer(value?.section_num);
  const timestampSeconds = finiteNumber(value?.timestamp_seconds);
  if (!value || !type || timestampSeconds == null || timestampSeconds < 0
    || (sectionNumber != null && (sectionNumber < 1 || sectionNumber > 4))) return null;
  return { type, sectionNumber, timestampSeconds };
}

export function normalizeListeningTestDetail(raw, expectedId) {
  const value = objectOf(raw);
  const id = textOf(value?.id);
  const testId = textOf(value?.test_id);
  const status = textOf(value?.status);
  const type = textOf(value?.test_type);
  const mode = textOf(value?.audio_assembly_mode);
  const band = finiteNumber(value?.band_target);
  const words = integer(value?.total_transcript_words);
  if (!value || !id || id !== expectedId || !testId || !STATUSES.has(status)
    || !TEST_TYPES.has(type) || (mode && !AUDIO_MODES.has(mode))
    || (band != null && (band < 1 || band > 9)) || (words != null && words < 0)
    || !Array.isArray(value.sections) || !Array.isArray(value.plan_label_exercises)) return null;

  const sections = [];
  let malformedSectionCount = 0;
  for (const candidate of value.sections) {
    const section = normalizeSection(candidate, id);
    if (section && !sections.some((item) => item.number === section.number || item.id === section.id)) sections.push(section);
    else malformedSectionCount += 1;
  }
  sections.sort((left, right) => left.number - right.number);

  const planExercises = [];
  let malformedPlanCount = 0;
  for (const candidate of value.plan_label_exercises) {
    const exercise = normalizePlanExercise(candidate);
    if (exercise && sections.some((section) => section.id === exercise.contentId)
      && !planExercises.some((item) => item.id === exercise.id)) planExercises.push(exercise);
    else malformedPlanCount += 1;
  }

  const cues = [];
  let malformedCueCount = 0;
  for (const candidate of Array.isArray(value.cue_points) ? value.cue_points : []) {
    const cue = normalizeCue(candidate);
    if (cue) cues.push(cue); else malformedCueCount += 1;
  }

  return {
    id,
    testId,
    title: textOf(value.title) || testId,
    status,
    type,
    version: textOf(value.version) || '1.0',
    bandTarget: band,
    accentProfile: Array.isArray(value.accent_profile) ? value.accent_profile.map(textOf).filter(Boolean) : [],
    totalTranscriptWords: words,
    examOnly: value.exam_only === true,
    createdAt: nullableText(value.created_at),
    updatedAt: nullableText(value.updated_at),
    audioMode: mode || null,
    fullAudioStoragePath: nullableText(value.full_audio_storage_path),
    fullAudioDurationSeconds: finiteNumber(value.full_audio_duration_seconds),
    fullAudioSizeBytes: integer(value.full_audio_size_bytes),
    assembledAudioStoragePath: nullableText(value.assembled_audio_storage_path),
    assembledAudioGeneratedAt: nullableText(value.assembled_audio_generated_at),
    sections,
    planExercises,
    cues,
    malformedSectionCount,
    malformedPlanCount,
    malformedCueCount,
  };
}

export function normalizeListeningTestReadback(raw, expectedId, expected = {}) {
  const row = normalizeListeningTestDetail(raw, expectedId);
  if (!row) return null;
  if (expected.status && row.status !== expected.status) return null;
  if (expected.mode && row.audioMode !== expected.mode) return null;
  if (expected.fullAudio && !row.fullAudioStoragePath) return null;
  if (expected.assembledAudio && !row.assembledAudioStoragePath) return null;
  if (expected.sectionAudio != null && !row.sections.some((section) => section.number === expected.sectionAudio && section.audioReady)) return null;
  if (expected.mapExerciseId) {
    const exercise = row.planExercises.find((item) => item.id === expected.mapExerciseId);
    if (!exercise || exercise.hasMapImage !== expected.hasMapImage) return null;
  }
  if (expected.allSectionsArchived && (row.malformedSectionCount || row.sections.some((section) => section.status !== 'archived'))) return null;
  return row;
}

function normalizeAudioAsset(raw) {
  const value = objectOf(raw);
  if (!value) return { storagePath: null, signedUrl: null, durationSeconds: null, sizeBytes: null, generatedAt: null };
  const duration = finiteNumber(value.duration_seconds);
  const size = integer(value.size_bytes);
  return {
    storagePath: nullableText(value.audio_storage_path),
    signedUrl: safeHttpUrl(value.signed_url),
    durationSeconds: duration != null && duration >= 0 ? duration : null,
    sizeBytes: size != null && size >= 0 ? size : null,
    generatedAt: nullableText(value.generated_at),
  };
}

export function normalizeListeningAudioBundle(raw) {
  const value = objectOf(raw);
  if (!value || !Array.isArray(value.sections)) return null;
  const sections = [];
  for (const candidate of value.sections) {
    const row = objectOf(candidate);
    const number = integer(row?.section_num);
    if (!row || number == null || number < 1 || number > 4 || sections.some((item) => item.number === number)) return null;
    sections.push({ number, ...normalizeAudioAsset(row) });
  }
  sections.sort((left, right) => left.number - right.number);
  const full = normalizeAudioAsset(value.full);
  const assembled = normalizeAudioAsset(value.assembled);
  const unavailableCount = [full, assembled, ...sections].filter((asset) => asset.storagePath && !asset.signedUrl).length;
  return { full, assembled, sections, unavailableCount };
}

export function normalizeListeningMapSignedUrl(raw, expectedExerciseId) {
  const value = objectOf(raw);
  const signedUrl = safeHttpUrl(value?.signed_url);
  if (!value || textOf(value.exercise_id) !== expectedExerciseId || !signedUrl) return null;
  return { signedUrl, model: nullableText(value.map_image_model), generatedAt: nullableText(value.map_image_generated_at) };
}

export function normalizeListeningHardDeleteAck(raw, expectedId, expectedTestId) {
  const value = objectOf(raw);
  const cascade = objectOf(value?.cascade_count);
  const content = integer(cascade?.content);
  const exercises = integer(cascade?.exercises);
  const attempts = integer(cascade?.attempts);
  const removed = integer(cascade?.storage_files_removed);
  if (!value || value.deleted !== true || textOf(value.id) !== expectedId || textOf(value.test_id) !== expectedTestId
    || !cascade || [content, exercises, attempts, removed].some((item) => item == null || item < 0)
    || !Array.isArray(cascade.storage_files_failed)
    || cascade.storage_files_failed.some((item) => typeof item !== 'string' || !item.trim())) return null;
  return { content, exercises, attempts, storageFilesRemoved: removed, storageFilesFailed: cascade.storage_files_failed.map(textOf).filter(Boolean) };
}

export function listeningTestDeleteReceiptKey(profileId) {
  return `aver:admin-listening-test-delete:${textOf(profileId)}`;
}

export function makeListeningTestDeleteReceipt(testId, ack) {
  const name = textOf(testId);
  if (!name || !ack || !Array.isArray(ack.storageFilesFailed)) return null;
  if (ack.storageFilesFailed.length) return {
    kind: 'warning',
    text: `Đã xóa ${name} khỏi database, nhưng ${ack.storageFilesFailed.length} storage file chưa dọn được: ${ack.storageFilesFailed.join(', ')}. Ops cần kiểm tra orphan.`,
  };
  return {
    kind: 'success',
    text: `Đã xóa vĩnh viễn ${name}: ${ack.content} section, ${ack.exercises} exercise, ${ack.attempts} attempt và ${ack.storageFilesRemoved} storage file.`,
  };
}

export function parseListeningTestDeleteReceipt(raw) {
  if (typeof raw !== 'string' || raw.length > 4000) return null;
  try {
    const value = objectOf(JSON.parse(raw));
    const kind = textOf(value?.kind);
    const text = textOf(value?.text);
    return value && (kind === 'success' || kind === 'warning') && text && text.length <= 2000 ? { kind, text } : null;
  } catch { return null; }
}

export function canPublishListeningTest(test) {
  if (test?.audioMode === 'full_premixed' && test.fullAudioStoragePath) return { ok: true, reason: 'Full audio đã sẵn sàng.' };
  if (test?.audioMode === 'parts_auto_assembled' && test.assembledAudioStoragePath) return { ok: true, reason: 'Assembled audio đã sẵn sàng.' };
  if (test?.audioMode === 'parts_only') return { ok: false, reason: 'Parts only không thể phát hành full test.' };
  return { ok: false, reason: 'Cần full audio hoặc assembled audio trước khi phát hành.' };
}

export function validateListeningAudioFile(file) {
  if (!file || typeof file.name !== 'string' || !file.name.toLocaleLowerCase().endsWith('.mp3')) return 'Chỉ chấp nhận file .mp3.';
  return null;
}

export function validateListeningMapFile(file) {
  if (!file || !MAP_TYPES.has(file.type)) return 'Chỉ chấp nhận PNG, JPG hoặc WebP.';
  if (file.size < 100) return 'File quá nhỏ, có thể rỗng hoặc bị hỏng.';
  if (file.size > 5 * 1024 * 1024) return 'File vượt giới hạn 5 MB.';
  return null;
}

export function formatListeningBytes(value) {
  const size = integer(value);
  if (size == null || size < 0) return '—';
  return size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;
}

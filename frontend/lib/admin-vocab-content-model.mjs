const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const isString = (value) => typeof value === 'string';
const isNullableString = (value) => value == null || isString(value);
const isCount = (value) => Number.isInteger(value) && value >= 0;

export const AUDIO_ENGINES = ['openai', 'elevenlabs'];
export const AUDIO_SCOPES = ['headword', 'example', 'both'];

export function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

function normalizeListRow(value) {
  if (!isObject(value) || !isUuid(value.id) || !isString(value.slug)
    || !isString(value.headword) || !isString(value.category)
    || !isNullableString(value.level) || !isNullableString(value.part_of_speech)
    || !isNullableString(value.pronunciation) || !isNullableString(value.gloss_vi)
    || !isNullableString(value.audio_headword) || !isNullableString(value.audio_example)
    || !isNullableString(value.audio_status) || !isNullableString(value.updated_at)) return null;
  return {
    id: value.id,
    slug: value.slug,
    headword: value.headword,
    category: value.category,
    level: value.level ?? '',
    partOfSpeech: value.part_of_speech ?? '',
    pronunciation: value.pronunciation ?? '',
    glossVi: value.gloss_vi ?? '',
    audioHeadword: value.audio_headword ?? '',
    audioExample: value.audio_example ?? '',
    audioStatus: value.audio_status ?? '',
    updatedAt: value.updated_at ?? '',
  };
}

export function normalizeVocabList(value, expectedLimit, expectedOffset) {
  if (!isObject(value) || !Array.isArray(value.words) || !isCount(value.total)
    || value.limit !== expectedLimit || value.offset !== expectedOffset) return null;
  const words = value.words.map(normalizeListRow);
  if (!words.every(Boolean) || value.words.length > expectedLimit
    || expectedOffset > value.total && value.words.length) return null;
  return { words, total: value.total, limit: value.limit, offset: value.offset };
}

const isJsonValue = (value) => value == null || typeof value === 'string'
  || typeof value === 'number' || typeof value === 'boolean'
  || (Array.isArray(value) && value.every(isJsonValue))
  || (isObject(value) && Object.values(value).every(isJsonValue));

export function normalizeVocabDetail(value, expectedId = '') {
  if (!isObject(value) || !isUuid(value.id) || (expectedId && value.id !== expectedId)
    || !isString(value.slug) || !isString(value.headword) || !isString(value.category)) return null;
  const scalarKeys = ['level', 'part_of_speech', 'pronunciation', 'syllables', 'definition_en',
    'definition_vi', 'gloss_vi', 'example', 'register', 'common_error', 'memory_hook',
    'source', 'group', 'body_html'];
  if (!scalarKeys.every((key) => isNullableString(value[key]))) return null;
  const stringListKeys = ['synonyms', 'antonyms', 'collocations', 'related_words'];
  if (!stringListKeys.every((key) => value[key] == null || (Array.isArray(value[key]) && value[key].every(isString)))
    || !(value.word_family == null || (Array.isArray(value.word_family) && value.word_family.every(isJsonValue)))) return null;
  return {
    id: value.id,
    slug: value.slug,
    headword: value.headword,
    category: value.category,
    level: value.level ?? '',
    partOfSpeech: value.part_of_speech ?? '',
    pronunciation: value.pronunciation ?? '',
    syllables: value.syllables ?? '',
    definitionEn: value.definition_en ?? '',
    definitionVi: value.definition_vi ?? '',
    glossVi: value.gloss_vi ?? '',
    example: value.example ?? '',
    register: value.register ?? '',
    commonError: value.common_error ?? '',
    memoryHook: value.memory_hook ?? '',
    source: value.source ?? '',
    group: value.group ?? '',
    bodyHtml: value.body_html ?? '',
    synonyms: value.synonyms ?? [],
    antonyms: value.antonyms ?? [],
    collocations: value.collocations ?? [],
    relatedWords: value.related_words ?? [],
    wordFamily: value.word_family ?? [],
  };
}

export function normalizeDeleteAck(value, expectedId) {
  return isObject(value) && value.id === expectedId && isString(value.message);
}

export function normalizeBulkDeleteAck(value, expectedIds) {
  if (!isObject(value) || !isCount(value.deleted_count) || !Array.isArray(value.not_found)
    || !value.not_found.every(isUuid) || value.deleted_count + value.not_found.length !== expectedIds.length) return null;
  const expected = new Set(expectedIds);
  if (!value.not_found.every((id) => expected.has(id))) return null;
  return { deletedCount: value.deleted_count, notFound: value.not_found };
}

export function normalizeAudioAck(value, expectedEngine, expectedScope, selectedCount) {
  if (!isObject(value) || !isCount(value.queued_count) || value.queued_count < 1
    || value.queued_count > selectedCount || value.engine !== expectedEngine || value.scope !== expectedScope) return null;
  return { queuedCount: value.queued_count, engine: value.engine, scope: value.scope };
}

function normalizeImportError(value) {
  if (!isObject(value) || !Number.isInteger(value.block) || value.block < 0
    || !isString(value.headword) || !isString(value.field) || !isString(value.message)) return null;
  return { block: value.block, headword: value.headword, field: value.field, message: value.message };
}

function normalizeImportBlock(value) {
  if (!isObject(value) || !Number.isInteger(value.index) || value.index < 0
    || !isString(value.headword) || !isString(value.slug) || !Array.isArray(value.validation_errors)
    || !(value.action == null || value.action === 'created' || value.action === 'updated')
    || !(value.db_action == null || value.db_action === 'created' || value.db_action === 'updated')) return null;
  const errors = value.validation_errors.map((row) => isObject(row) && isString(row.field) && isString(row.message)
    ? { field: row.field, message: row.message } : null);
  if (!errors.every(Boolean) || !(value.parsed_data == null || isObject(value.parsed_data))) return null;
  const category = value.parsed_data && isString(value.parsed_data.category) ? value.parsed_data.category : '';
  return { index: value.index, headword: value.headword, slug: value.slug, category, errors, action: value.action ?? '', forecastAction: value.db_action ?? '' };
}

export function normalizeVocabImport(value, expectedDryRun) {
  if (!isObject(value) || value.dry_run !== expectedDryRun || !Array.isArray(value.blocks)
    || !Array.isArray(value.validation_errors) || !Array.isArray(value.committed_ids)
    || !Array.isArray(value.duplicate_slugs) || !isObject(value.summary)) return null;
  const blocks = value.blocks.map(normalizeImportBlock);
  const errors = value.validation_errors.map(normalizeImportError);
  const committedIds = value.committed_ids;
  const duplicateSlugs = value.duplicate_slugs;
  const summary = value.summary;
  if (!blocks.every(Boolean) || !errors.every(Boolean) || !committedIds.every(isString)
    || !duplicateSlugs.every(isString) || !['total', 'created', 'updated', 'errors', 'forecast_created', 'forecast_updated'].every((key) => isCount(summary[key]))
    || summary.total !== blocks.length || summary.errors !== blocks.filter((block) => block.errors.length).length
    || (!expectedDryRun && committedIds.length !== summary.created + summary.updated)) return null;
  return {
    dryRun: expectedDryRun,
    blocks,
    errors,
    committedIds,
    duplicateSlugs,
    summary: {
      total: summary.total,
      created: summary.created,
      updated: summary.updated,
      errors: summary.errors,
      forecastCreated: summary.forecast_created,
      forecastUpdated: summary.forecast_updated,
    },
  };
}

export function parseStringList(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

export function parseJsonList(value) {
  let parsed;
  try { parsed = JSON.parse(String(value || '[]')); } catch { return null; }
  return Array.isArray(parsed) && parsed.every(isJsonValue) ? parsed : null;
}

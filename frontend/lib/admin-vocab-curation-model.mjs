const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const isString = (value) => typeof value === 'string';
const isNullableString = (value) => value == null || isString(value);
const isNonNegativeInteger = (value) => Number.isInteger(value) && value >= 0;

export const D1_SOURCES = ['', 'haiku', 'gemini', 'fallback_evidence'];
export const D1_ACTIVE_FILTERS = ['', 'true', 'false'];
export const LEMMA_POS_TAGS = ['', 'NOUN', 'VERB', 'ADJ', 'ADV', 'PROPN'];

export function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}
function normalizeD1Row(value) {
  if (!isObject(value)
    || !isUuid(value.id)
    || !isUuid(value.user_id)
    || !isUuid(value.vocabulary_id)
    || !isString(value.context_sentence)
    || !isString(value.target_answer)
    || !isNullableString(value.hint)
    || !isNullableString(value.source_evidence_substring)
    || !['haiku', 'gemini', 'fallback_evidence'].includes(value.generated_by)
    || !isNullableString(value.generated_at)
    || typeof value.is_active !== 'boolean'
    || !isNonNegativeInteger(value.attempt_count)
    || !isNullableString(value.last_used_at)
    || !isString(value.created_at)
    || !isNullableString(value.headword)
    || !Array.isArray(value.acceptable_variants)
    || !value.acceptable_variants.every(isString)) return null;
  return {
    id: value.id,
    userId: value.user_id,
    vocabularyId: value.vocabulary_id,
    contextSentence: value.context_sentence,
    targetAnswer: value.target_answer,
    acceptableVariants: [...value.acceptable_variants],
    hint: value.hint ?? '',
    sourceEvidenceSubstring: value.source_evidence_substring ?? '',
    generatedBy: value.generated_by,
    generatedAt: value.generated_at ?? '',
    isActive: value.is_active,
    attemptCount: value.attempt_count,
    lastUsedAt: value.last_used_at ?? '',
    createdAt: value.created_at,
    headword: value.headword ?? '',
  };
}

export function normalizeD1ListPayload(value) {
  if (!isObject(value)
    || !Array.isArray(value.items)
    || !isNonNegativeInteger(value.total)
    || !isNonNegativeInteger(value.offset)
    || !Number.isInteger(value.limit)
    || value.limit < 1
    || value.limit > 200) return null;
  const items = value.items.map(normalizeD1Row).filter(Boolean);
  return { items, total: value.total, offset: value.offset, limit: value.limit };
}

function normalizeLemmaRow(value) {
  if (!isObject(value)
    || !isUuid(value.id)
    || !isString(value.original_word)
    || !value.original_word.trim()
    || !isString(value.lemma)
    || !value.lemma.trim()
    || !isNullableString(value.pos_tag)
    || !isNullableString(value.notes)
    || !isString(value.created_at)) return null;
  return {
    id: value.id,
    originalWord: value.original_word,
    lemma: value.lemma,
    posTag: value.pos_tag ?? '',
    notes: value.notes ?? '',
    createdAt: value.created_at,
  };
}

export function normalizeLemmaListPayload(value) {
  if (!isObject(value)
    || !Array.isArray(value.items)
    || !isNonNegativeInteger(value.total)
    || !isNonNegativeInteger(value.offset)
    || !Number.isInteger(value.limit)
    || value.limit < 1
    || value.limit > 500) return null;
  return {
    items: value.items.map(normalizeLemmaRow).filter(Boolean),
    total: value.total,
    offset: value.offset,
    limit: value.limit,
  };
}

export function normalizeD1PatchAck(value, expectedId, expectedFields) {
  if (!isObject(value)
    || value.ok !== true
    || value.id !== expectedId
    || !Array.isArray(value.updated_fields)
    || !value.updated_fields.every(isString)) return null;
  const actual = [...new Set(value.updated_fields)].sort();
  const expected = [...new Set(expectedFields)].sort();
  return actual.length === expected.length && actual.every((field, index) => field === expected[index])
    ? { ok: true, id: expectedId, updatedFields: actual }
    : null;
}

export function normalizeLemmaCreateAck(value) {
  if (!isObject(value) || value.ok !== true) return null;
  const item = normalizeLemmaRow(value.item);
  return item ? { ok: true, item } : null;
}

export function d1Query({ source = '', active = 'true', userId = '', offset = 0, limit = 50 } = {}) {
  if (!D1_SOURCES.includes(source) || !D1_ACTIVE_FILTERS.includes(active)) return null;
  const canonicalUserId = String(userId || '').trim();
  if (canonicalUserId && !isUuid(canonicalUserId)) return null;
  if (!isNonNegativeInteger(offset) || !Number.isInteger(limit) || limit < 1 || limit > 200) return null;
  const params = new URLSearchParams();
  if (source) params.set('source', source);
  if (active) params.set('active', active);
  if (canonicalUserId) params.set('user_id', canonicalUserId);
  params.set('offset', String(offset));
  params.set('limit', String(limit));
  return params.toString();
}

export function lemmaQuery({ search = '', offset = 0, limit = 100 } = {}) {
  if (!isNonNegativeInteger(offset) || !Number.isInteger(limit) || limit < 1 || limit > 500) return null;
  const params = new URLSearchParams();
  const canonicalSearch = String(search || '').trim();
  if (canonicalSearch) params.set('search', canonicalSearch);
  params.set('offset', String(offset));
  params.set('limit', String(limit));
  return params.toString();
}

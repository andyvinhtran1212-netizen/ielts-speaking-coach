const PARTS = new Set([1, 2, 3]);

const objectOf = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const stringOf = (value) => typeof value === 'string' ? value : '';
const nullableString = (value) => typeof value === 'string' && value.trim() ? value : null;
const intOf = (value, fallback = 0) => Number.isInteger(Number(value)) ? Number(value) : fallback;

export function normalizeSpeakingTopic(raw) {
  const row = objectOf(raw);
  if (!row) return null;
  const id = stringOf(row.id).trim();
  const title = stringOf(row.title).trim();
  const part = intOf(row.part);
  if (!id || !title || !PARTS.has(part)) return null;
  const metadataFailed = row.question_metadata_lookup_failed === true;
  const count = metadataFailed || row.question_count == null ? null : intOf(row.question_count, -1);
  if (count != null && count < 0) return null;
  return {
    id,
    title,
    part,
    category: stringOf(row.category).trim(),
    isActive: row.is_active !== false,
    questionCount: count,
    questionMetadataLookupFailed: metadataFailed,
    status: stringOf(row.status) || (metadataFailed ? 'metadata_unavailable' : count === 0 ? 'no_questions' : 'has_questions'),
    statusLabel: stringOf(row.status_label),
    lastUpdatedAt: nullableString(row.last_updated_at || row.updated_at),
    lastRotatedAt: nullableString(row.last_rotated_at),
  };
}

export function normalizeSpeakingTopicList(raw) {
  if (!Array.isArray(raw)) return null;
  const rows = [];
  let malformedCount = 0;
  for (const value of raw) {
    const row = normalizeSpeakingTopic(value);
    if (row) rows.push(row); else malformedCount += 1;
  }
  return { rows, malformedCount };
}

export function normalizeSpeakingQuestion(raw, topicId = '') {
  const row = objectOf(raw);
  if (!row) return null;
  const id = stringOf(row.id).trim();
  const resolvedTopicId = stringOf(row.topic_id).trim() || topicId;
  const text = stringOf(row.question_text).trim();
  const part = intOf(row.part);
  if (!id || !resolvedTopicId || !text || !PARTS.has(part)) return null;
  const bullets = Array.isArray(row.cue_card_bullets)
    ? row.cue_card_bullets.map((item) => stringOf(item).trim()).filter(Boolean)
    : [];
  return {
    id,
    topicId: resolvedTopicId,
    part,
    orderNum: Math.max(0, intOf(row.order_num)),
    text,
    questionType: stringOf(row.question_type).trim(),
    cueCardBullets: bullets,
    cueCardReflection: stringOf(row.cue_card_reflection).trim(),
    audioReady: Boolean(nullableString(row.audio_url) || nullableString(row.audio_path)),
  };
}

export function normalizeSpeakingQuestionList(raw, topicId) {
  const source = Array.isArray(raw) ? raw : objectOf(raw) && Array.isArray(raw.questions) ? raw.questions : null;
  if (!source) return null;
  const rows = [];
  let malformedCount = 0;
  for (const value of source) {
    const row = normalizeSpeakingQuestion(value, topicId);
    if (row && row.topicId === topicId) rows.push(row); else malformedCount += 1;
  }
  rows.sort((a, b) => a.part - b.part || a.orderNum - b.orderNum || a.id.localeCompare(b.id));
  return { rows, malformedCount };
}

export function normalizeTopicWrite(raw, expectedId = '') {
  const row = normalizeSpeakingTopic(raw);
  return row && (!expectedId || row.id === expectedId) ? row : null;
}

export function normalizeQuestionWrite(raw, topicId, expectedId = '') {
  const row = normalizeSpeakingQuestion(raw, topicId);
  return row && row.topicId === topicId && (!expectedId || row.id === expectedId) ? row : null;
}

export function normalizeBulkTopicResult(raw, expectedIds, successKey = 'success_ids') {
  const data = objectOf(raw);
  if (!data) return null;
  const expected = [...new Set((expectedIds || []).map((id) => stringOf(id).trim()).filter(Boolean))];
  const success = Array.isArray(data[successKey]) ? data[successKey].map((id) => stringOf(id).trim()).filter(Boolean) : [];
  const failed = Array.isArray(data.failed_ids) ? data.failed_ids.map((id) => stringOf(id).trim()).filter(Boolean) : [];
  const processed = intOf(data.processed_count, -1);
  if (processed !== expected.length || [...success, ...failed].some((id) => !expected.includes(id))) return null;
  if (new Set(success).size !== success.length || new Set(failed).size !== failed.length || success.some((id) => failed.includes(id))) return null;
  const accounted = new Set([...success, ...failed]);
  if (accounted.size !== expected.length || expected.some((id) => !accounted.has(id))) return null;
  return {
    processed,
    successIds: success,
    failedIds: failed,
    errors: Array.isArray(data.errors) ? data.errors.map((error) => {
      const item = objectOf(error) || {};
      return { topicId: nullableString(item.topic_id), title: nullableString(item.topic_title), message: stringOf(item.message) || 'Lỗi không xác định' };
    }) : [],
  };
}

export function normalizeBulkCreate(raw) {
  const data = objectOf(raw);
  if (!data || !Array.isArray(data.topics)) return null;
  const normalized = normalizeSpeakingTopicList(data.topics);
  const count = intOf(data.created_count ?? data.created, -1);
  if (!normalized || count !== normalized.rows.length || normalized.malformedCount || new Set(normalized.rows.map((row) => row.id)).size !== normalized.rows.length) return null;
  return { count, topics: normalized.rows };
}

export function normalizeGenerateResult(raw, topicId, mode) {
  const data = objectOf(raw);
  if (!data || stringOf(data.topic_id) !== topicId || stringOf(data.mode) !== mode) return null;
  const questions = normalizeSpeakingQuestionList(data.questions, topicId);
  const count = intOf(data.question_count, -1);
  if (!questions || questions.malformedCount || count !== questions.rows.length) return null;
  return { mode, questions: questions.rows };
}

/** @param {number} part @param {string} search @param {string | null} [topicId] */
export function speakingTopicsQuery(part, search, topicId = null) {
  const params = new URLSearchParams();
  params.set('part', String(PARTS.has(Number(part)) ? Number(part) : 1));
  const q = stringOf(search).trim();
  if (q) params.set('q', q);
  const topic = stringOf(topicId).trim();
  if (topic) params.set('topic', topic);
  return params.toString();
}

export function topicMatches(row, part, search) {
  const query = stringOf(search).trim().toLocaleLowerCase('vi');
  return row.part === part && (!query || `${row.title} ${row.category}`.toLocaleLowerCase('vi').includes(query));
}

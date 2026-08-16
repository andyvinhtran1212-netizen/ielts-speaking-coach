const STATUSES = new Set(['draft', 'published', 'archived']);

export const MAX_GIST_PROMPT_LENGTH = 1000;
export const MAX_GIST_MODEL_ANSWER_LENGTH = 5000;
export const MAX_GIST_KEYWORDS = 10;
export const MAX_GIST_KEYWORD_LENGTH = 100;

const objectOf = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const textOf = (value) => typeof value === 'string' ? value.trim() : '';
const integer = (value) => typeof value === 'number' && Number.isInteger(value) ? value : null;
const finite = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;

function safeHttpUrl(value) {
  const raw = textOf(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname ? raw : null;
  } catch { return null; }
}

export function normalizeListeningGistContent(raw, expectedId) {
  const value = objectOf(raw);
  const id = textOf(value?.id);
  const title = textOf(value?.title);
  const transcript = typeof value?.transcript === 'string' ? value.transcript : '';
  const durationSeconds = finite(value?.audio_duration_seconds);
  const status = textOf(value?.status);
  if (!value || id !== expectedId || !title || durationSeconds == null || durationSeconds < 0 || !STATUSES.has(status)) return null;
  return {
    id, title, transcript, durationSeconds, status,
    audioUrl: safeHttpUrl(value.audio_signed_url),
    sourceType: textOf(value.source_type) || null,
  };
}

function normalizeKeywordList(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_GIST_KEYWORDS) return null;
  const keywords = [];
  const seen = new Set();
  for (const candidate of raw) {
    if (typeof candidate !== 'string') return null;
    const keyword = candidate.trim();
    const key = keyword.toLocaleLowerCase('en-US');
    if (!keyword || keyword.length > MAX_GIST_KEYWORD_LENGTH || seen.has(key)) return null;
    seen.add(key); keywords.push(keyword);
  }
  return keywords;
}

function normalizeBlock(raw, expectedContentId) {
  const value = objectOf(raw);
  const payload = objectOf(value?.payload);
  const id = textOf(value?.id);
  const contentId = textOf(value?.content_id);
  const orderNum = integer(value?.order_num);
  const status = textOf(value?.status);
  const updatedAt = textOf(value?.updated_at);
  const promptText = typeof payload?.prompt_text === 'string' ? payload.prompt_text.trim() : '';
  const modelAnswer = typeof payload?.model_answer === 'string' ? payload.model_answer.trim() : '';
  const keywords = normalizeKeywordList(payload?.rubric_keywords);
  if (!value || !payload || !id || contentId !== expectedContentId || value.exercise_type !== 'gist'
    || orderNum == null || orderNum < 1 || orderNum > 200 || !STATUSES.has(status)
    || !updatedAt || !Number.isFinite(Date.parse(updatedAt)) || !promptText || !modelAnswer
    || keywords == null) return null;
  return { id, contentId, orderNum, status, updatedAt, promptText, modelAnswer, keywords };
}

export function normalizeListeningGistBlocks(raw, expectedContentId) {
  const value = objectOf(raw);
  if (!value || !Array.isArray(value.exercises)) return null;
  const items = [];
  let malformedCount = 0;
  for (const candidate of value.exercises) {
    const block = normalizeBlock(candidate, expectedContentId);
    if (block) items.push(block); else malformedCount += 1;
  }
  items.sort((left, right) => left.orderNum - right.orderNum || left.id.localeCompare(right.id));
  const seen = new Set();
  const duplicateOrders = [];
  for (const item of items) {
    if (seen.has(item.orderNum)) duplicateOrders.push(item.orderNum);
    seen.add(item.orderNum);
  }
  return { items, malformedCount, duplicateOrders: [...new Set(duplicateOrders)] };
}

export function listeningGistDraft(block) {
  return block
    ? { promptText: block.promptText, modelAnswer: block.modelAnswer, keywords: [...block.keywords] }
    : { promptText: '', modelAnswer: '', keywords: [] };
}

export function validateListeningGistDraft(raw) {
  const value = objectOf(raw) || {};
  const promptText = typeof value.promptText === 'string' ? value.promptText.trim() : '';
  const modelAnswer = typeof value.modelAnswer === 'string' ? value.modelAnswer.trim() : '';
  const keywords = normalizeKeywordList(value.keywords);
  const errors = {};
  if (!promptText) errors.promptText = 'Nhập câu hỏi cho học viên.';
  else if (promptText.length > MAX_GIST_PROMPT_LENGTH) errors.promptText = `Tối đa ${MAX_GIST_PROMPT_LENGTH.toLocaleString('vi-VN')} ký tự.`;
  if (!modelAnswer) errors.modelAnswer = 'Nhập đáp án mẫu làm ground truth.';
  else if (modelAnswer.length > MAX_GIST_MODEL_ANSWER_LENGTH) errors.modelAnswer = `Tối đa ${MAX_GIST_MODEL_ANSWER_LENGTH.toLocaleString('vi-VN')} ký tự.`;
  if (keywords == null) errors.keywords = `Tối đa ${MAX_GIST_KEYWORDS} từ khóa, mỗi từ khóa không quá ${MAX_GIST_KEYWORD_LENGTH} ký tự và không trùng nhau.`;
  return { ok: Object.keys(errors).length === 0, errors, draft: { promptText, modelAnswer, keywords: keywords || [] } };
}

export function addListeningGistKeywords(existing, raw) {
  const current = Array.isArray(existing) ? existing : [];
  const additions = String(raw ?? '').split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);
  const out = [...current];
  const seen = new Set(out.map((item) => String(item).trim().toLocaleLowerCase('en-US')));
  const rejected = [];
  for (const keyword of additions) {
    const key = keyword.toLocaleLowerCase('en-US');
    if (keyword.length > MAX_GIST_KEYWORD_LENGTH || seen.has(key) || out.length >= MAX_GIST_KEYWORDS) rejected.push(keyword);
    else { seen.add(key); out.push(keyword); }
  }
  return { keywords: out, rejected };
}

export function buildListeningGistOperation({ contentId, block, orderNum, draft, status }) {
  const validation = validateListeningGistDraft(draft);
  if (!validation.ok || !STATUSES.has(status) || !Number.isInteger(orderNum) || orderNum < 1 || orderNum > 200) {
    return { ok: false, errors: validation.errors, operation: null };
  }
  const operation = {
    content_id: contentId,
    exercise_type: 'gist',
    order_num: orderNum,
    payload: {
      prompt_text: validation.draft.promptText,
      model_answer: validation.draft.modelAnswer,
      rubric_keywords: validation.draft.keywords,
    },
    status,
  };
  if (block) {
    operation.exercise_id = block.id;
    operation.expected_updated_at = block.updatedAt;
  } else operation.expected_absent = true;
  return { ok: true, errors: {}, operation };
}

function samePayload(block, operation) {
  const payload = objectOf(operation.payload);
  return payload && block.promptText === payload.prompt_text && block.modelAnswer === payload.model_answer
    && Array.isArray(payload.rubric_keywords) && block.keywords.length === payload.rubric_keywords.length
    && block.keywords.every((keyword, index) => keyword === payload.rubric_keywords[index]);
}

export function findListeningGistOperationMatch(collection, operation) {
  if (!collection || !operation) return null;
  const block = operation.exercise_id
    ? collection.items.find((item) => item.id === operation.exercise_id)
    : collection.items.find((item) => item.orderNum === operation.order_num);
  if (!block || block.contentId !== operation.content_id || block.status !== operation.status
    || block.orderNum !== operation.order_num || !samePayload(block, operation)) return null;
  return block;
}

export function normalizePendingListeningGistSave(raw, account, contentId) {
  const value = objectOf(raw);
  const operation = objectOf(value?.operation);
  if (!value || textOf(value.account) !== account || textOf(value.contentId) !== contentId
    || !textOf(value.startedAt) || !Number.isFinite(Date.parse(value.startedAt))
    || !operation || operation.content_id !== contentId || operation.exercise_type !== 'gist'
    || !integer(operation.order_num) || !objectOf(operation.payload)
    || !(textOf(operation.expected_updated_at) || operation.expected_absent === true)) return null;
  const validation = validateListeningGistDraft({
    promptText: operation.payload.prompt_text,
    modelAnswer: operation.payload.model_answer,
    keywords: operation.payload.rubric_keywords,
  });
  return validation.ok ? { account, contentId, startedAt: value.startedAt, operation } : null;
}

/** @param {string} contentId @param {string|null} [exerciseId] */
export const listeningGistHref = (contentId, exerciseId = null) => {
  const query = new URLSearchParams({ content_id: contentId });
  if (exerciseId) query.set('exercise_id', exerciseId);
  return `/admin/listening/gist?${query}`;
};

export const listeningGistRollbackHref = (contentId) => `/pages/admin/listening/gist.html?content_id=${encodeURIComponent(contentId)}`;

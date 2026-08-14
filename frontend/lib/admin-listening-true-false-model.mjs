const STATUSES = new Set(['draft', 'published', 'archived']);
const ANSWERS = new Set(['T', 'F', 'NG']);

export const MIN_TF_STATEMENTS = 3;
export const MAX_TF_STATEMENTS = 12;
export const MAX_TF_STATEMENT_LENGTH = 1000;

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

export function normalizeListeningTrueFalseContent(raw, expectedId) {
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

function normalizeStatements(raw) {
  if (!Array.isArray(raw) || raw.length < MIN_TF_STATEMENTS || raw.length > MAX_TF_STATEMENTS) return null;
  const statements = [];
  for (let index = 0; index < raw.length; index += 1) {
    const value = objectOf(raw[index]);
    const idx = integer(value?.idx);
    const text = typeof value?.text === 'string' ? value.text.trim() : '';
    const answer = textOf(value?.answer).toUpperCase();
    // Keep oversized legacy text readable so the admin can repair it in-place.
    // The write validator below still blocks saving until it is shortened.
    if (!value || idx !== index || !text || !ANSWERS.has(answer)) return null;
    statements.push({ text, answer });
  }
  return statements;
}

function normalizeBlock(raw, expectedContentId) {
  const value = objectOf(raw);
  const payload = objectOf(value?.payload);
  const id = textOf(value?.id);
  const contentId = textOf(value?.content_id);
  const orderNum = integer(value?.order_num);
  const status = textOf(value?.status);
  const updatedAt = textOf(value?.updated_at);
  const statements = normalizeStatements(payload?.statements);
  if (!value || !payload || !id || contentId !== expectedContentId || value.exercise_type !== 'true_false'
    || orderNum == null || orderNum < 1 || orderNum > 200 || !STATUSES.has(status)
    || !updatedAt || !Number.isFinite(Date.parse(updatedAt)) || !statements) return null;
  return { id, contentId, orderNum, status, updatedAt, statements };
}

export function normalizeListeningTrueFalseBlocks(raw, expectedContentId) {
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

export function listeningTrueFalseDraft(block) {
  return block
    ? block.statements.map((statement) => ({ ...statement }))
    : Array.from({ length: MIN_TF_STATEMENTS }, () => ({ text: '', answer: 'T' }));
}

export function validateListeningTrueFalseDraft(raw) {
  const errors = {};
  if (!Array.isArray(raw) || raw.length < MIN_TF_STATEMENTS || raw.length > MAX_TF_STATEMENTS) {
    errors.statements = `Cần từ ${MIN_TF_STATEMENTS} đến ${MAX_TF_STATEMENTS} nhận định.`;
    return { ok: false, errors, statements: [] };
  }
  const statements = raw.map((candidate, index) => {
    const value = objectOf(candidate) || {};
    const text = typeof value.text === 'string' ? value.text.trim() : '';
    const answer = textOf(value.answer).toUpperCase();
    if (!text) errors[`statement-${index}`] = `Nhận định ${index + 1} chưa có nội dung.`;
    else if (text.length > MAX_TF_STATEMENT_LENGTH) errors[`statement-${index}`] = `Nhận định ${index + 1} vượt ${MAX_TF_STATEMENT_LENGTH} ký tự.`;
    if (!ANSWERS.has(answer)) errors[`answer-${index}`] = `Chọn ground truth cho nhận định ${index + 1}.`;
    return { text, answer };
  });
  return { ok: Object.keys(errors).length === 0, errors, statements };
}

export function buildListeningTrueFalseOperation({ contentId, block, orderNum, draft, status }) {
  const result = validateListeningTrueFalseDraft(draft);
  if (!textOf(contentId) || !STATUSES.has(status) || !Number.isInteger(orderNum) || orderNum < 1 || orderNum > 200) {
    return { ok: false, errors: { ...result.errors, form: 'Identity hoặc trạng thái block không hợp lệ.' }, operation: null };
  }
  if (!result.ok) return { ok: false, errors: result.errors, operation: null };
  const operation = {
    content_id: contentId,
    exercise_type: 'true_false',
    order_num: orderNum,
    status,
    payload: { statements: result.statements.map((statement, idx) => ({ idx, ...statement })) },
  };
  if (block) {
    operation.exercise_id = block.id;
    operation.expected_updated_at = block.updatedAt;
  } else operation.expected_absent = true;
  return { ok: true, errors: {}, operation };
}

function sameStatements(block, operation) {
  const expected = normalizeStatements(objectOf(operation?.payload)?.statements);
  return Boolean(expected) && JSON.stringify(block.statements) === JSON.stringify(expected);
}

export function findListeningTrueFalseOperationMatch(collection, operation) {
  const value = objectOf(operation);
  if (!collection || !Array.isArray(collection.items) || !value || value.exercise_type !== 'true_false') return null;
  const target = textOf(value.exercise_id)
    ? collection.items.find((item) => item.id === textOf(value.exercise_id))
    : collection.items.find((item) => item.orderNum === integer(value.order_num));
  if (!target || target.contentId !== textOf(value.content_id) || target.orderNum !== integer(value.order_num)
    || target.status !== textOf(value.status) || !sameStatements(target, value)) return null;
  return target;
}

export function normalizePendingListeningTrueFalseSave(raw, account, contentId) {
  const value = objectOf(raw);
  const operation = objectOf(value?.operation);
  if (!value || textOf(value.account) !== account || textOf(value.contentId) !== contentId
    || !textOf(value.startedAt) || !Number.isFinite(Date.parse(value.startedAt))
    || !operation || operation.exercise_type !== 'true_false' || textOf(operation.content_id) !== contentId
    || !integer(operation.order_num) || !STATUSES.has(textOf(operation.status))
    || !normalizeStatements(objectOf(operation.payload)?.statements)
    || !(textOf(operation.expected_updated_at) || operation.expected_absent === true)) return null;
  return { account, contentId, startedAt: value.startedAt, operation };
}

/** @param {string} contentId @param {string|null} [exerciseId] */
export function listeningTrueFalseHref(contentId, exerciseId = null) {
  const params = new URLSearchParams({ content_id: contentId });
  if (exerciseId) params.set('exercise_id', exerciseId);
  return `/admin/listening/tf?${params.toString()}`;
}

export function listeningTrueFalseRollbackHref(contentId) {
  return `/pages/admin/listening/tf.html?content_id=${encodeURIComponent(contentId)}`;
}

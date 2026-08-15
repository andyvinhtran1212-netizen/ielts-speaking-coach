const STATUSES = new Set(['draft', 'published', 'archived']);

export const MIN_MCQ_QUESTIONS = 1;
export const MAX_MCQ_QUESTIONS = 20;
export const MCQ_OPTION_COUNT = 4;
export const MAX_MCQ_STEM_LENGTH = 1000;
export const MAX_MCQ_OPTION_LENGTH = 500;

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

export function normalizeListeningMcqContent(raw, expectedId) {
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

function normalizeQuestions(raw) {
  if (!Array.isArray(raw) || raw.length < MIN_MCQ_QUESTIONS || raw.length > MAX_MCQ_QUESTIONS) return null;
  const questions = [];
  for (let index = 0; index < raw.length; index += 1) {
    const value = objectOf(raw[index]);
    const idx = integer(value?.idx);
    const stem = typeof value?.stem === 'string' ? value.stem.trim() : '';
    const rawOptions = Array.isArray(value?.options) ? value.options : null;
    const answerIdx = integer(value?.answer_idx);
    if (!value || idx !== index || !stem || !rawOptions || rawOptions.length !== MCQ_OPTION_COUNT
      || answerIdx == null || answerIdx < 0 || answerIdx >= MCQ_OPTION_COUNT) return null;
    const options = rawOptions.map((option) => typeof option === 'string' ? option.trim() : '');
    if (options.some((option) => !option)) return null;
    // Oversized legacy text remains readable for in-place repair. The write
    // validator below still blocks persistence until every field is bounded.
    questions.push({ stem, options, answerIdx });
  }
  return questions;
}

function normalizeBlock(raw, expectedContentId) {
  const value = objectOf(raw);
  const payload = objectOf(value?.payload);
  const id = textOf(value?.id);
  const contentId = textOf(value?.content_id);
  const orderNum = integer(value?.order_num);
  const status = textOf(value?.status);
  const updatedAt = textOf(value?.updated_at);
  const questions = normalizeQuestions(payload?.questions);
  if (!value || !payload || !id || contentId !== expectedContentId || value.exercise_type !== 'mcq'
    || orderNum == null || orderNum < 1 || orderNum > 200 || !STATUSES.has(status)
    || !updatedAt || !Number.isFinite(Date.parse(updatedAt)) || !questions) return null;
  return { id, contentId, orderNum, status, updatedAt, questions };
}

function normalizeImportedBlock(raw, expectedContentId) {
  const value = objectOf(raw);
  const payload = objectOf(value?.payload);
  const questions = Array.isArray(payload?.questions) ? payload.questions : null;
  const orderNum = integer(value?.order_num);
  const updatedAt = textOf(value?.updated_at);
  const importerShape = ['mcq_3option', 'mcq_letter_label'].includes(textOf(payload?.variant))
    && typeof payload?.template_kind === 'string'
    && Array.isArray(payload?.answers)
    && questions?.length > 0
    && questions.every((question) => integer(objectOf(question)?.q_num) != null);
  if (!value || !payload || !textOf(value.id) || textOf(value.content_id) !== expectedContentId
    || value.exercise_type !== 'mcq' || orderNum == null || orderNum < 1 || orderNum > 200
    || !STATUSES.has(textOf(value.status)) || !updatedAt || !Number.isFinite(Date.parse(updatedAt))
    || !importerShape) return null;
  return { id: textOf(value.id), orderNum, status: textOf(value.status) };
}

export function normalizeListeningMcqBlocks(raw, expectedContentId) {
  const value = objectOf(raw);
  if (!value || !Array.isArray(value.exercises)) return null;
  const items = [];
  let malformedCount = 0;
  const importedItems = [];
  for (const candidate of value.exercises) {
    const block = normalizeBlock(candidate, expectedContentId);
    if (block) {
      items.push(block);
      continue;
    }
    const imported = normalizeImportedBlock(candidate, expectedContentId);
    if (imported) importedItems.push(imported);
    else malformedCount += 1;
  }
  items.sort((left, right) => left.orderNum - right.orderNum || left.id.localeCompare(right.id));
  const seen = new Set();
  const duplicateOrders = [];
  for (const item of items) {
    if (seen.has(item.orderNum)) duplicateOrders.push(item.orderNum);
    seen.add(item.orderNum);
  }
  return {
    items,
    malformedCount,
    importedCount: importedItems.length,
    importedIds: importedItems.map((item) => item.id),
    importedOrders: [...new Set(importedItems.map((item) => item.orderNum))].sort((left, right) => left - right),
    importedPublishedOrders: [...new Set(importedItems.filter((item) => item.status === 'published').map((item) => item.orderNum))].sort((left, right) => left - right),
    duplicateOrders: [...new Set(duplicateOrders)],
  };
}

export function nextListeningMcqOrder(collection) {
  const value = objectOf(collection);
  if (!value || !Array.isArray(value.items) || !Array.isArray(value.importedOrders)) return null;
  const orders = [
    ...value.items.map((item) => integer(objectOf(item)?.orderNum)),
    ...value.importedOrders.map(integer),
  ];
  if (orders.some((orderNum) => orderNum == null || orderNum < 1 || orderNum > 200)) return null;
  const next = Math.max(0, ...orders) + 1;
  return next <= 200 ? next : null;
}

export function listeningMcqDraft(block) {
  return block
    ? block.questions.map((question) => ({ ...question, options: [...question.options] }))
    : [{ stem: '', options: ['', '', '', ''], answerIdx: null }];
}

export function validateListeningMcqDraft(raw) {
  const errors = {};
  if (!Array.isArray(raw) || raw.length < MIN_MCQ_QUESTIONS || raw.length > MAX_MCQ_QUESTIONS) {
    errors.questions = `Cần từ ${MIN_MCQ_QUESTIONS} đến ${MAX_MCQ_QUESTIONS} câu hỏi.`;
    return { ok: false, errors, questions: [] };
  }
  const questions = raw.map((candidate, index) => {
    const value = objectOf(candidate) || {};
    const stem = typeof value.stem === 'string' ? value.stem.trim() : '';
    const rawOptions = Array.isArray(value.options) ? value.options : [];
    const options = Array.from({ length: MCQ_OPTION_COUNT }, (_, optionIndex) => (
      typeof rawOptions[optionIndex] === 'string' ? rawOptions[optionIndex].trim() : ''
    ));
    const answerIdx = integer(value.answerIdx);
    if (!stem) errors[`question-${index}`] = `Câu ${index + 1} chưa có đề bài.`;
    else if (stem.length > MAX_MCQ_STEM_LENGTH) errors[`question-${index}`] = `Câu ${index + 1} vượt ${MAX_MCQ_STEM_LENGTH} ký tự.`;
    options.forEach((option, optionIndex) => {
      if (!option) errors[`option-${index}-${optionIndex}`] = `Lựa chọn ${String.fromCharCode(65 + optionIndex)} chưa có nội dung.`;
      else if (option.length > MAX_MCQ_OPTION_LENGTH) errors[`option-${index}-${optionIndex}`] = `Lựa chọn ${String.fromCharCode(65 + optionIndex)} vượt ${MAX_MCQ_OPTION_LENGTH} ký tự.`;
    });
    const firstOption = new Map();
    options.forEach((option, optionIndex) => {
      if (!option) return;
      const key = option.toLocaleLowerCase('en');
      const firstIndex = firstOption.get(key);
      if (firstIndex == null) firstOption.set(key, optionIndex);
      else {
        errors[`option-${index}-${firstIndex}`] = `Các lựa chọn của câu ${index + 1} phải khác nhau.`;
        errors[`option-${index}-${optionIndex}`] = `Các lựa chọn của câu ${index + 1} phải khác nhau.`;
      }
    });
    if (answerIdx == null || answerIdx < 0 || answerIdx >= MCQ_OPTION_COUNT) errors[`answer-${index}`] = `Chọn một đáp án đúng cho câu ${index + 1}.`;
    return { stem, options, answerIdx };
  });
  return { ok: Object.keys(errors).length === 0, errors, questions };
}

export function buildListeningMcqOperation({ contentId, block, orderNum, draft, status }) {
  const result = validateListeningMcqDraft(draft);
  if (!textOf(contentId) || !STATUSES.has(status) || !Number.isInteger(orderNum) || orderNum < 1 || orderNum > 200) {
    return { ok: false, errors: { ...result.errors, form: 'Identity hoặc trạng thái block không hợp lệ.' }, operation: null };
  }
  if (!result.ok) return { ok: false, errors: result.errors, operation: null };
  const operation = {
    content_id: contentId,
    exercise_type: 'mcq',
    order_num: orderNum,
    status,
    payload: {
      questions: result.questions.map((question, idx) => ({
        idx,
        stem: question.stem,
        options: question.options,
        answer_idx: question.answerIdx,
      })),
    },
  };
  if (block) {
    operation.exercise_id = block.id;
    operation.expected_updated_at = block.updatedAt;
  } else operation.expected_absent = true;
  return { ok: true, errors: {}, operation };
}

function sameQuestions(block, operation) {
  const expected = normalizeQuestions(objectOf(operation?.payload)?.questions);
  return Boolean(expected) && JSON.stringify(block.questions) === JSON.stringify(expected);
}

export function findListeningMcqOperationMatch(collection, operation) {
  const value = objectOf(operation);
  if (!collection || !Array.isArray(collection.items) || !value || value.exercise_type !== 'mcq') return null;
  const target = textOf(value.exercise_id)
    ? collection.items.find((item) => item.id === textOf(value.exercise_id))
    : collection.items.find((item) => item.orderNum === integer(value.order_num));
  if (!target || target.contentId !== textOf(value.content_id) || target.orderNum !== integer(value.order_num)
    || target.status !== textOf(value.status) || !sameQuestions(target, value)) return null;
  return target;
}

export function normalizePendingListeningMcqSave(raw, account, contentId) {
  const value = objectOf(raw);
  const operation = objectOf(value?.operation);
  if (!value || textOf(value.account) !== account || textOf(value.contentId) !== contentId
    || !textOf(value.startedAt) || !Number.isFinite(Date.parse(value.startedAt))
    || !operation || operation.exercise_type !== 'mcq' || textOf(operation.content_id) !== contentId
    || !integer(operation.order_num) || !STATUSES.has(textOf(operation.status))
    || !normalizeQuestions(objectOf(operation.payload)?.questions)
    || !(textOf(operation.expected_updated_at) || operation.expected_absent === true)) return null;
  return { account, contentId, startedAt: value.startedAt, operation };
}

/** @param {string} contentId @param {string|null} [exerciseId] */
export function listeningMcqHref(contentId, exerciseId = null) {
  const params = new URLSearchParams({ content_id: contentId });
  if (exerciseId) params.set('exercise_id', exerciseId);
  return `/admin/listening/mcq?${params.toString()}`;
}

export function listeningMcqRollbackHref(contentId) {
  return `/pages/admin/listening/mcq.html?content_id=${encodeURIComponent(contentId)}`;
}

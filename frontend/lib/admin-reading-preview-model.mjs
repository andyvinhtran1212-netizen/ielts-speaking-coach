const objectOf = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const textOf = (value) => typeof value === 'string' ? value.trim() : '';
const optionalText = (value) => textOf(value) || null;
const integerOf = (value) => {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  return Number.isInteger(Number(value)) ? Number(value) : null;
};

export const READING_QUESTION_LABELS = Object.freeze({
  mcq_single: 'MCQ · 1 đáp án', mcq_multi: 'MCQ · nhiều đáp án',
  true_false_not_given: 'True / False / Not Given', yes_no_not_given: 'Yes / No / Not Given',
  matching_headings: 'Matching Headings', matching_information: 'Matching Information',
  matching_features: 'Matching Features', matching_sentence_endings: 'Matching Sentence Endings',
  sentence_completion: 'Sentence Completion', summary_completion: 'Summary Completion',
  notes_completion: 'Notes Completion', table_completion: 'Table Completion',
  form_completion: 'Form Completion', flow_chart_completion: 'Flow Chart Completion',
  diagram_label_completion: 'Diagram Label Completion', short_answer: 'Short Answer',
});

export const READING_DIAGRAM_TYPES = new Set(['diagram_label_completion', 'flow_chart_completion']);

function normalizePrompt(raw) {
  const value = objectOf(raw);
  const prompt = textOf(value?.prompt);
  if (!value || !prompt) return null;
  return { id: optionalText(value.id), type: optionalText(value.type), qrange: optionalText(value.qrange), prompt };
}

function normalizePassage(raw, index, issues) {
  const value = objectOf(raw);
  const id = textOf(value?.id); const order = integerOf(value?.passage_order);
  if (!value || !id || order == null || order < 1) {
    issues.push(`Passage #${index + 1} thiếu id hoặc passage_order hợp lệ và đã bị loại khỏi preview.`);
    return null;
  }
  const prompts = Array.isArray(value.img_prompts) ? value.img_prompts.map(normalizePrompt).filter(Boolean) : [];
  const malformedPrompts = Array.isArray(value.img_prompts) ? value.img_prompts.length - prompts.length : 0;
  if (malformedPrompts) issues.push(`Passage ${order} có ${malformedPrompts} IMG-PROMPT sai contract.`);
  return {
    id, order, slug: textOf(value.slug) || `passage-${order}`, title: textOf(value.title) || `Passage ${order}`,
    bodyMarkdown: typeof value.body_markdown === 'string' ? value.body_markdown : '',
    wordCount: integerOf(value.word_count), estimatedMinutes: integerOf(value.estimated_minutes),
    topicTags: Array.isArray(value.topic_tags) ? value.topic_tags.map(textOf).filter(Boolean) : [],
    status: optionalText(value.status), imagePrompts: prompts,
  };
}

function normalizeOptions(value) {
  if (!Array.isArray(value)) return [];
  return value.map((option, index) => {
    if (typeof option === 'string') return { label: String.fromCharCode(65 + index), text: option };
    const row = objectOf(option); if (!row) return null;
    const label = textOf(row.label); const text = textOf(row.text);
    return label || text ? { label: label || String.fromCharCode(65 + index), text } : null;
  }).filter(Boolean);
}

function normalizeQuestion(raw, index, passageIds, issues) {
  const value = objectOf(raw); const qNum = integerOf(value?.q_num); const passageId = textOf(value?.passage_id);
  if (!value || qNum == null || qNum < 1 || !passageId || !passageIds.has(passageId)) {
    issues.push(`Question #${index + 1} thiếu q_num/passage_id hợp lệ và đã bị loại khỏi preview.`);
    return null;
  }
  const id = optionalText(value.id);
  if (!id) issues.push(`Question Q${qNum} thiếu id canonical; preview giữ nội dung nhưng khóa quản lý ảnh.`);
  const payload = objectOf(value.payload) || {}; const template = objectOf(payload.template) || {};
  const answer = objectOf(value.answer) || {};
  const rawAnswer = answer.answer;
  const accepted = Array.isArray(rawAnswer) ? rawAnswer.map((item) => String(item)) : rawAnswer == null ? [] : [String(rawAnswer)];
  const alternatives = Array.isArray(answer.alternatives) ? answer.alternatives.map((item) => String(item)) : [];
  return {
    id, qNum, passageId, passageOrder: integerOf(value.passage_order),
    type: textOf(value.question_type) || 'unknown', prompt: typeof value.prompt === 'string' ? value.prompt : '',
    skillTag: optionalText(value.skill_tag), subSkill: optionalText(value.sub_skill), orderNum: integerOf(value.order_num),
    options: normalizeOptions(payload.options), imageUrl: optionalText(payload.image_url),
    template: {
      summaryText: typeof template.summary_text === 'string' ? template.summary_text : null,
      imageStoragePath: optionalText(template.image_storage_path), imageSource: optionalText(template.image_source),
      choose: integerOf(template.choose), paragraphLabels: Array.isArray(template.paragraph_labels) ? template.paragraph_labels.map(textOf).filter(Boolean) : [],
      extras: Object.fromEntries(Object.entries(template).filter(([key]) => !['summary_text', 'image_storage_path', 'image_source', 'image_size_bytes', 'image_format', 'image_uploaded_at', 'image_uploaded_by', 'choose', 'paragraph_labels'].includes(key))),
    },
    answers: accepted, alternatives, explanation: optionalText(value.explanation),
  };
}

export function normalizeReadingAdminPreview(raw) {
  const value = objectOf(raw); if (!value || !Array.isArray(value.passages) || !Array.isArray(value.questions)) return null;
  const testId = textOf(value.test_id); const title = textOf(value.title); if (!testId) return null;
  const issues = [];
  if (!title) issues.push(`Đề ${testId} thiếu title; preview dùng test_id làm nhãn tạm.`);
  const passages = value.passages.map((row, index) => normalizePassage(row, index, issues)).filter(Boolean).sort((a, b) => a.order - b.order);
  const duplicatePassageIds = passages.filter((passage, index) => passages.findIndex((item) => item.id === passage.id) !== index).map((passage) => passage.id);
  const duplicatePassageOrders = passages.filter((passage, index) => passages.findIndex((item) => item.order === passage.order) !== index).map((passage) => passage.order);
  if (duplicatePassageIds.length) issues.push(`Trùng passage id: ${[...new Set(duplicatePassageIds)].join(', ')}.`);
  if (duplicatePassageOrders.length) issues.push(`Trùng passage_order: ${[...new Set(duplicatePassageOrders)].join(', ')}.`);
  const passageIds = new Set(passages.map((passage) => passage.id));
  const questions = value.questions.map((row, index) => normalizeQuestion(row, index, passageIds, issues)).filter(Boolean).sort((a, b) => a.qNum - b.qNum);
  const duplicates = questions.filter((question, index) => questions.findIndex((item) => item.qNum === question.qNum) !== index).map((question) => question.qNum);
  const duplicateQuestionIds = questions.filter((question, index) => question.id && questions.findIndex((item) => item.id === question.id) !== index).map((question) => question.id);
  if (duplicates.length) issues.push(`Trùng số câu: ${[...new Set(duplicates)].join(', ')}.`);
  if (duplicateQuestionIds.length) issues.push(`Trùng question id: ${[...new Set(duplicateQuestionIds)].join(', ')}.`);
  const declaredPassages = integerOf(value.passage_count); const declaredQuestions = integerOf(value.total_questions);
  if (declaredPassages != null && declaredPassages !== passages.length) issues.push(`Đề khai báo ${declaredPassages} passage nhưng API trả ${passages.length}.`);
  if (declaredQuestions != null && declaredQuestions !== questions.length) issues.push(`Đề khai báo ${declaredQuestions} câu nhưng preview hợp lệ có ${questions.length}.`);
  return {
    test: {
      id: optionalText(value.id), testId, title: title || testId, module: optionalText(value.module), status: optionalText(value.status),
      timeLimitMinutes: integerOf(value.time_limit_minutes), passageCount: declaredPassages ?? passages.length,
      totalQuestions: declaredQuestions ?? questions.length,
      bandTarget: value.band_target == null || value.band_target === '' || !Number.isFinite(Number(value.band_target)) ? null : Number(value.band_target),
      createdAt: optionalText(value.created_at), updatedAt: optionalText(value.updated_at), passages, questions,
    },
    issues,
  };
}

export function questionsByPassage(test, passageId) {
  return (test?.questions || []).filter((question) => question.passageId === passageId).sort((a, b) => a.qNum - b.qNum);
}

export function diagramRole(questions, index) {
  const question = questions[index]; if (!question || !READING_DIAGRAM_TYPES.has(question.type)) return null;
  const previous = questions[index - 1];
  if (!previous || previous.type !== question.type) return { lead: true, leadQNum: question.qNum };
  let lead = index - 1; while (lead > 0 && questions[lead - 1].type === question.type) lead -= 1;
  return { lead: false, leadQNum: questions[lead].qNum };
}

export function imagePromptForQuestion(passage, qNum) {
  return (passage?.imagePrompts || []).find((prompt) => Number(/\d+/.exec(prompt.qrange || '')?.[0]) === qNum) || null;
}

export function normalizeReadingImageUploadAck(raw, questionId) {
  const value = objectOf(raw); const path = textOf(value?.image_storage_path);
  if (!value || textOf(value.question_id) !== questionId || !path) return null;
  return { path, signedUrl: optionalText(value.signed_url), size: integerOf(value.image_size_bytes), format: optionalText(value.image_format) };
}

export function normalizeReadingImageDeleteAck(raw, questionId) {
  const value = objectOf(raw);
  return value && textOf(value.question_id) === questionId && typeof value.deleted === 'boolean' ? { deleted: value.deleted } : null;
}

export function readingPreviewHref(testId) {
  return `/admin/reading/preview?test_id=${encodeURIComponent(textOf(testId))}`;
}

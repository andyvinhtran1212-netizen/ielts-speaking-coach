import { adminReadingSearch } from './admin-reading-navigation.mjs';
import { readingDisplayQuestionRuns } from './reading-exam-controller.mjs';
import { duplicatedBlankNumbers, hasDiagramPromptMarkup } from './numbered-blank.mjs';

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

// Mirrors WORD_LIMITS in reading-exam-controller.mjs (pinned by a parity test):
// any other word_limit makes the student player fall back to its default rubric.
export const READING_PLAYER_WORD_LIMITS = new Set([
  'ONE WORD', 'ONE WORD ONLY', 'ONE WORD AND/OR A NUMBER',
  'NO MORE THAN TWO WORDS', 'NO MORE THAN TWO WORDS AND/OR A NUMBER',
  'NO MORE THAN THREE WORDS', 'NO MORE THAN THREE WORDS AND/OR A NUMBER',
]);
const GAP_FILL_TYPES = new Set([
  'sentence_completion', 'summary_completion', 'notes_completion', 'table_completion',
  'form_completion', 'flow_chart_completion', 'diagram_label_completion', 'short_answer',
]);
const qRange = (first, last) => first === last ? `Q${first}` : `Q${first}–${last}`;
const rawOptions = (row) => Array.isArray(row?.payload?.options) ? row.payload.options : [];
const rawInstruction = (row) => typeof row?.payload?.instruction === 'string' ? row.payload.instruction.trim() : '';

/** Flag rubric data the student player would silently replace with a hard-coded default. */
function playerDefaultIssues(rows, issues) {
  for (const run of readingDisplayQuestionRuns(rows)) {
    const first = run[0]; const type = String(first?.question_type || '');
    if (type === 'matching_information') {
      let start = null; let previous = null;
      const flush = () => {
        if (start != null) issues.push(`${qRange(start, previous)} (matching_information) thiếu paragraph_labels/options; học viên sẽ thấy A–H mặc định — khai báo đúng danh sách đoạn.`);
        start = null;
      };
      for (const row of run) {
        const payload = objectOf(row.payload) || {};
        const labels = Array.isArray(payload.paragraph_labels) && payload.paragraph_labels.length
          ? payload.paragraph_labels : objectOf(payload.template)?.paragraph_labels;
        const fallback = !(Array.isArray(labels) && labels.length) && !rawOptions(row).length;
        const qNum = Number(row.q_num);
        if (fallback && start != null && qNum !== previous + 1) flush();
        if (fallback) { if (start == null) start = qNum; previous = qNum; } else flush();
      }
      flush();
      continue;
    }
    if (!GAP_FILL_TYPES.has(type) || rawInstruction(first)) continue;
    if (type === 'summary_completion' && rawOptions(first).length) continue;
    const authoredLimit = String(first?.payload?.word_limit || '').trim().toUpperCase();
    if (READING_PLAYER_WORD_LIMITS.has(authoredLimit)) continue;
    const fallback = type === 'short_answer' ? 'NO MORE THAN THREE WORDS' : 'NO MORE THAN TWO WORDS';
    const current = authoredLimit ? ` (word_limit hiện tại "${String(first.payload.word_limit).trim()}" không thuộc danh sách chuẩn)` : '';
    issues.push(`${qRange(Number(first.q_num), Number(run.at(-1).q_num))} (${type}) không có instruction/word_limit hợp lệ${current}; học viên sẽ thấy "${fallback}" mặc định.`);
  }
}

const templateStrings = (value) => typeof value === 'string' ? [value]
  : Array.isArray(value) ? value.flatMap(templateStrings)
    : objectOf(value) ? Object.values(value).flatMap(templateStrings) : [];

/** Flag authored blank markup the player has to repair at render time (RV-05, T-DIAG). */
function blankMarkupIssues(rows, issues) {
  const duplicated = new Set();
  const diagramPrompts = [];
  for (const row of rows) {
    const template = objectOf(row?.payload)?.template;
    for (const value of [row?.prompt, template?.summary_text, template?.heading, template?.headers, template?.rows]) {
      for (const qNum of templateStrings(value).flatMap(duplicatedBlankNumbers)) duplicated.add(qNum);
    }
    if (READING_DIAGRAM_TYPES.has(String(row?.question_type || '')) && hasDiagramPromptMarkup(row?.prompt)) diagramPrompts.push(Number(row.q_num));
  }
  if (duplicated.size) issues.push(`${[...duplicated].sort((a, b) => a - b).map((qNum) => `{{${qNum}}}`).join(', ')} có dãy "___" ngay sau; player và trang chữa bài hiển thị thành một ô — nên xoá dãy gạch dưới khỏi template.`);
  if (diagramPrompts.length) issues.push(`${diagramPrompts.map((qNum) => `Q${qNum}`).join(', ')} (sơ đồ) có prompt chứa ảnh markdown hoặc {{n}}; player bỏ ảnh và hiện {{n}} thành "(n) ______" — nên để mỗi câu một bước sạch.`);
}

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

function normalizeSolution(value) {
  const texts = (raw) => (Array.isArray(raw) ? raw : [raw])
    .filter((item) => typeof item === 'string' && item.trim());
  if (typeof value === 'string') return texts(value).length ? [{ key: 'text', label: 'Lời giải authored', values: [value] }] : [];
  const solution = objectOf(value); if (!solution) return [];
  const steps = Array.isArray(solution.solution_steps)
    ? solution.solution_steps.map((step) => textOf(objectOf(step)?.instruction_vi)).filter(Boolean) : [];
  const distractors = Array.isArray(solution.distractor_analysis)
    ? solution.distractor_analysis.map((entry) => {
      const row = objectOf(entry); const why = textOf(row?.why_wrong_vi); const option = textOf(row?.option);
      return why ? option ? `${option} — ${why}` : why : '';
    }).filter(Boolean) : [];
  const fields = [
    ['question_text', 'Câu hỏi trong lời giải'], ['steps', 'Các bước giải'],
    ['source_excerpt', 'Trích đoạn nguồn'], ['source_location', 'Vị trí nguồn'],
    ['source_paragraph', 'Đoạn nguồn'],
    ['vocab', 'Từ vựng'], ['paraphrase', 'Paraphrase'],
    ['trap_analysis', 'Phân tích bẫy & kỹ năng'], ['tips', 'Mẹo làm bài'],
    ['skill_code', 'Mã kỹ năng'], ['skill_name', 'Kỹ năng'],
  ];
  const sections = fields.map(([key, label]) => {
    if (key === 'steps' && steps.length) return { key: 'solution_steps', label, values: steps };
    if (key === 'trap_analysis' && distractors.length) return { key: 'distractor_analysis', label: 'Phân tích đáp án nhiễu', values: distractors };
    return { key, label, values: texts(solution[key]) };
  }).filter((section) => section.values.length);
  if (typeof solution.band === 'number' && Number.isFinite(solution.band)) sections.push({ key: 'band', label: 'Band', values: [String(solution.band)] });
  return sections;
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
  const paragraphLabels = Array.isArray(payload.paragraph_labels) && payload.paragraph_labels.length
    ? payload.paragraph_labels : template.paragraph_labels;
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
      choose: integerOf(template.choose), paragraphLabels: Array.isArray(paragraphLabels) ? paragraphLabels.map(textOf).filter(Boolean) : [],
      extras: Object.fromEntries(Object.entries(template).filter(([key]) => !['summary_text', 'image_storage_path', 'image_source', 'image_size_bytes', 'image_format', 'image_uploaded_at', 'image_uploaded_by', 'choose', 'paragraph_labels'].includes(key))),
    },
    answers: accepted, alternatives, explanation: optionalText(value.explanation),
    solutionSections: normalizeSolution(payload.solution),
    instruction: optionalText(payload.instruction), wordLimit: optionalText(payload.word_limit),
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
  const kept = [];
  const questions = value.questions.map((row, index) => {
    const question = normalizeQuestion(row, index, passageIds, issues);
    if (question) kept.push({ question, row });
    return question;
  }).filter(Boolean).sort((a, b) => a.qNum - b.qNum);
  const duplicates = questions.filter((question, index) => questions.findIndex((item) => item.qNum === question.qNum) !== index).map((question) => question.qNum);
  const duplicateQuestionIds = questions.filter((question, index) => question.id && questions.findIndex((item) => item.id === question.id) !== index).map((question) => question.id);
  if (duplicates.length) issues.push(`Trùng số câu: ${[...new Set(duplicates)].join(', ')}.`);
  if (duplicateQuestionIds.length) issues.push(`Trùng question id: ${[...new Set(duplicateQuestionIds)].join(', ')}.`);
  for (const passageId of passageIds) {
    const passageRows = kept.filter((entry) => entry.question.passageId === passageId)
      .sort((a, b) => a.question.qNum - b.question.qNum).map((entry) => entry.row);
    playerDefaultIssues(passageRows, issues);
    blankMarkupIssues(passageRows, issues);
  }
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

/** @param {unknown} testId @param {unknown} questionNumber @param {object | null} context */
export function readingPreviewHref(testId, questionNumber = null, context = null) {
  const qNum = integerOf(questionNumber);
  const anchor = qNum != null && qNum >= 1 ? `#q${qNum}` : '';
  const query = new URLSearchParams({ test_id: textOf(testId) });
  if (context) {
    query.set('from', 'reading-content');
    for (const [key, value] of new URLSearchParams(adminReadingSearch(context))) query.set(key, value);
  }
  return `/admin/reading/preview?${query.toString().replace(/\+/g, '%20')}${anchor}`;
}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  diagramRole, imagePromptForQuestion, normalizeReadingAdminPreview,
  normalizeReadingImageDeleteAck, normalizeReadingImageUploadAck,
  questionsByPassage, READING_PLAYER_WORD_LIMITS, readingPreviewHref,
} from '../lib/admin-reading-preview-model.mjs';
import { readingQuestionInstruction } from '../lib/reading-exam-controller.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
const CLIENT = read('app', '(authed-admin-reading-preview)', 'admin', 'reading', 'preview', 'admin-reading-preview.tsx');
const PAGE = read('app', '(authed-admin-reading-preview)', 'admin', 'reading', 'preview', 'page.tsx');
const LAYOUT = read('app', '(authed-admin-reading-preview)', 'layout.tsx');
const CSS = read('public', 'css', 'admin-reading-preview-next.css');
const CONTENT = read('app', '(authed-admin-reading-content)', 'admin', 'reading', 'content', 'admin-reading-content.tsx');
const FEEDBACK_MODEL = read('lib', 'admin-feedback-model.mjs');
const WORKFLOW = read('..', '.github', 'workflows', 'next-native-browser.yml');
const CANONICAL = JSON.parse(read('tests', 'fixtures', 'reading-admin-canonical-solutions.json'));

const payload = (overrides = {}) => ({
  id: 'uuid-t1', test_id: 'T 1', title: 'Reading paper', module: 'academic',
  status: 'published', passage_count: 1, total_questions: 3,
  time_limit_minutes: 60, band_target: 7,
  passages: [{
    id: 'p1', passage_order: 1, slug: 'passage-one', title: 'Passage one',
    body_markdown: '# Safe', word_count: 700, estimated_minutes: 20,
    status: 'published', topic_tags: ['science'], img_prompts: [{
      id: 'IMG-2-3', type: 'diagram', qrange: '2–3', prompt: 'Draw a safe diagram',
    }],
  }],
  questions: [
    { id: 'q1', q_num: 1, passage_id: 'p1', passage_order: 1, question_type: 'mcq_single', prompt: 'Pick', payload: { options: [{ label: 'A', text: 'One' }] }, answer: { answer: 'A', alternatives: [] }, explanation: 'Because A' },
    { id: 'q2', q_num: 2, passage_id: 'p1', passage_order: 1, question_type: 'diagram_label_completion', prompt: 'Label', payload: { template: { image_storage_path: 'tests/t1/q2.png', image_source: 'admin_upload' }, image_url: 'https://signed.test/q2' }, answer: { answer: 'tree', alternatives: ['a tree'] }, explanation: 'Look left' },
    { id: 'q3', q_num: 3, passage_id: 'p1', passage_order: 1, question_type: 'diagram_label_completion', prompt: 'Label next', payload: { template: {} }, answer: { answer: 'root' }, explanation: null },
  ],
  ...overrides,
});

test('normalizes the answer-key contract without turning nullable values into zero', () => {
  const normalized = normalizeReadingAdminPreview(payload({ time_limit_minutes: null }));
  assert.ok(normalized);
  assert.equal(normalized.test.timeLimitMinutes, null);
  assert.equal(normalized.test.passages[0].estimatedMinutes, 20);
  assert.deepEqual(normalized.test.questions[0].options, [{ label: 'A', text: 'One' }]);
  assert.deepEqual(normalized.test.questions[1].answers, ['tree']);
  assert.deepEqual(normalized.test.questions[1].alternatives, ['a tree']);
  assert.equal(normalizeReadingAdminPreview({ title: 'missing arrays' }), null);
  assert.equal(normalizeReadingAdminPreview(payload({ test_id: '' })), null);
  const untitled = normalizeReadingAdminPreview(payload({ title: '' }));
  assert.equal(untitled.test.title, 'T 1');
  assert.ok(untitled.issues.some((issue) => issue.includes('thiếu title')));
});

test('shows native top-level paragraph labels ahead of legacy template labels and retains template-only papers', () => {
  const source = payload();
  source.questions[0].payload = { paragraph_labels: ['A', 'F', 'I'], template: { paragraph_labels: ['A', 'H'] } };
  source.questions[1].payload = { template: { paragraph_labels: ['A', 'G'] } };
  const original = JSON.stringify(source);
  const normalized = normalizeReadingAdminPreview(source).test;
  assert.deepEqual(normalized.questions[0].template.paragraphLabels, ['A', 'F', 'I']);
  assert.deepEqual(normalized.questions[1].template.paragraphLabels, ['A', 'G']);
  assert.equal(JSON.stringify(source), original);
});

test('retains authored solutions and rubrics alongside legacy explanations without changing keys or source', () => {
  const source = payload();
  source.questions[0].payload = { instruction: 'Complete the notes.', word_limit: 'ONE WORD ONLY', solution: {
    question_text: 'Original question', steps: 'Locate the line.\nRead the noun.',
    source_excerpt: 'The outer layer of sheep intestines.', source_paragraph: 'A', vocab: ['intestines = ruột'],
    paraphrase: 'animals ↔ sheep', trap_analysis: 'Do not add a second word.', tips: 'Keep the plural.', skill_code: 'LEX', band: 6.5,
  } };
  source.questions[1].payload.solution = 'Authored plain-text solution';
  const original = JSON.stringify(source);
  const rows = normalizeReadingAdminPreview(source).test.questions;
  assert.equal(rows[0].explanation, 'Because A');
  assert.equal(rows[0].instruction, 'Complete the notes.');
  assert.equal(rows[0].wordLimit, 'ONE WORD ONLY');
  assert.deepEqual(rows[0].solutionSections.find(({ key }) => key === 'steps').values, ['Locate the line.\nRead the noun.']);
  assert.deepEqual(rows[0].solutionSections.find(({ key }) => key === 'vocab').values, ['intestines = ruột']);
  // AVR001 Q1 and native packets use source_paragraph independently of source_location.
  assert.deepEqual(rows[0].solutionSections.find(({ key }) => key === 'source_paragraph'), { key: 'source_paragraph', label: 'Đoạn nguồn', values: ['A'] });
  assert.deepEqual(rows[0].solutionSections.find(({ key }) => key === 'band').values, ['6.5']);
  assert.deepEqual(rows[1].solutionSections, [{ key: 'text', label: 'Lời giải authored', values: ['Authored plain-text solution'] }]);
  assert.deepEqual(rows[0].answers, ['A']);
  assert.equal(JSON.stringify(source), original);
});

test('does not invent prose from malformed or empty solution/rubric values', () => {
  const source = payload();
  source.questions[0].payload = { instruction: {}, word_limit: 2, solution: { steps: {}, vocab: ['', null, {}, 42], band: '6.5' } };
  source.questions[1].payload.solution = [];
  source.questions[2].payload.solution = '  ';
  const rows = normalizeReadingAdminPreview(source).test.questions;
  assert.deepEqual(rows.map(({ solutionSections }) => solutionSections), [[], [], []]);
  assert.equal(rows[0].instruction, null); assert.equal(rows[0].wordLimit, null);
  assert.equal(rows[0].explanation, 'Because A');
});

test('renders the actual structured L3 Q10 and canonical MCQ distractor without a root explanation', () => {
  const source = payload({ total_questions: 2, questions: [CANONICAL.q10, CANONICAL.mcq] });
  const before = JSON.stringify(source);
  const rows = normalizeReadingAdminPreview(source).test.questions;
  const q10 = rows.find((row) => row.qNum === 10);
  assert.equal(q10.explanation, null);
  assert.deepEqual(q10.solutionSections.find(({ key }) => key === 'solution_steps')?.values,
    CANONICAL.q10.payload.solution.solution_steps.map((step) => step.instruction_vi));
  assert.deepEqual(q10.answers, ['coal']);
  const mcq = rows.find((row) => row.qNum === 1);
  assert.deepEqual(mcq.solutionSections.find(({ key }) => key === 'distractor_analysis')?.values,
    ["B — " + CANONICAL.mcq.payload.solution.distractor_analysis[0].why_wrong_vi]);
  assert.equal(JSON.stringify(source), before);
});

test('guards structured entries and preserves legacy prose when structured fields contain no readable content', () => {
  const source = payload();
  source.questions[0].payload.solution = { solution_steps: [null, 42, {}, { instruction_vi: ' ' }],
    distractor_analysis: [null, { why_wrong_vi: {} }], steps: 'Legacy steps.', trap_analysis: 'Legacy trap.' };
  source.questions[1].payload.solution = { solution_steps: {}, distractor_analysis: 'not an array' };
  const rows = normalizeReadingAdminPreview(source).test.questions;
  assert.deepEqual(rows[0].solutionSections.map(({ values }) => values), [['Legacy steps.'], ['Legacy trap.']]);
  assert.deepEqual(rows[1].solutionSections, []);
});

test('uses canonical instructions and distractors ahead of legacy fallbacks without hiding other prose fields', () => {
  const source = payload();
  source.questions[0].payload.solution = { ...CANONICAL.mcq.payload.solution,
    steps: 'Old prose steps.', trap_analysis: 'Old prose trap.', source_excerpt: 'Original source.' };
  const sections = normalizeReadingAdminPreview(source).test.questions[0].solutionSections;
  assert.equal(sections.some(({ key }) => key === 'steps' || key === 'trap_analysis'), false);
  assert.equal(sections.find(({ key }) => key === 'solution_steps').values.length, 2);
  assert.equal(sections.find(({ key }) => key === 'distractor_analysis').values.length, 1);
  assert.deepEqual(sections.find(({ key }) => key === 'source_excerpt').values, ['Original source.']);
});

test('reports malformed/count drift instead of inventing preview rows', () => {
  const normalized = normalizeReadingAdminPreview(payload({
    passage_count: 2,
    total_questions: 4,
    passages: [...payload().passages, { title: 'broken' }],
    questions: [...payload().questions, { id: 'bad', q_num: 4, passage_id: 'missing' }],
  }));
  assert.ok(normalized);
  assert.equal(normalized.test.passages.length, 1);
  assert.equal(normalized.test.questions.length, 3);
  assert.ok(normalized.issues.some((issue) => issue.includes('Passage #2')));
  assert.ok(normalized.issues.some((issue) => issue.includes('Question #4')));
  assert.ok(normalized.issues.some((issue) => issue.includes('khai báo 2 passage')));
  assert.ok(normalized.issues.some((issue) => issue.includes('khai báo 4 câu')));
});

test('surfaces missing and duplicate canonical identities', () => {
  const source = payload();
  const normalized = normalizeReadingAdminPreview({
    ...source,
    passages: [...source.passages, { ...source.passages[0], title: 'Duplicate passage' }],
    questions: [
      { ...source.questions[0], id: null },
      source.questions[1],
      { ...source.questions[2], id: source.questions[1].id },
    ],
    passage_count: 2,
  });
  assert.ok(normalized);
  assert.ok(normalized.issues.some((issue) => issue.includes('thiếu id canonical')));
  assert.ok(normalized.issues.some((issue) => issue.includes('Trùng passage id')));
  assert.ok(normalized.issues.some((issue) => issue.includes('Trùng passage_order')));
  assert.ok(normalized.issues.some((issue) => issue.includes('Trùng question id')));
});

const rubricPaper = (questions, passages = [{ id: 'p1', passage_order: 1, title: 'Passage one' }]) => ({
  test_id: 'RUBRIC', title: 'Rubric paper', passages,
  questions: questions.map((row) => ({ passage_id: 'p1', passage_order: 1, prompt: `Q${row.q_num}`, answer: { answer: 'x' }, ...row, id: `q${row.q_num}` })),
});
const block = (type, from, to, payload = {}) => Array.from({ length: to - from + 1 }, (_, index) => (
  { q_num: from + index, question_type: type, payload: typeof payload === 'function' ? payload(from + index) : { ...payload } }));
const defaultIssues = (paper) => normalizeReadingAdminPreview(paper).issues.filter((issue) => issue.includes('mặc định'));

test('warns once per matching_information block that would fall back to the hard-coded A–H dropdown', () => {
  assert.deepEqual(defaultIssues(rubricPaper(block('matching_information', 14, 18))), [
    'Q14–18 (matching_information) thiếu paragraph_labels/options; học viên sẽ thấy A–H mặc định — khai báo đúng danh sách đoạn.',
  ]);
  for (const payload of [
    { template: { paragraph_labels: ['A', 'B', 'C', 'D', 'E'] } },
    { paragraph_labels: ['A', 'B', 'C', 'D', 'E'] },
    { options: ['A', 'B', 'C', 'D', 'E'] },
  ]) assert.deepEqual(defaultIssues(rubricPaper(block('matching_information', 14, 18, payload))), []);
  // The player resolves labels per question, so only the unlabeled rows are named and gaps split the range.
  const mixed = block('matching_information', 14, 18, (qNum) => qNum === 16 ? { paragraph_labels: ['A', 'B'] } : {});
  assert.deepEqual(defaultIssues(rubricPaper(mixed)).map((issue) => issue.split(' ')[0]), ['Q14–15', 'Q17–18']);
  assert.deepEqual(defaultIssues(rubricPaper(block('matching_information', 9, 9))).map((issue) => issue.split(' ')[0]), ['Q9']);
});

test('warns once per gap-fill display group whose rubric the player would replace with its word-limit default', () => {
  assert.deepEqual(defaultIssues(rubricPaper(block('notes_completion', 1, 6))), [
    'Q1–6 (notes_completion) không có instruction/word_limit hợp lệ; học viên sẽ thấy "NO MORE THAN TWO WORDS" mặc định.',
  ]);
  assert.deepEqual(defaultIssues(rubricPaper(block('notes_completion', 1, 6, { word_limit: 'ONE WORD ONLY' }))), []);
  assert.deepEqual(defaultIssues(rubricPaper(block('notes_completion', 1, 6, { word_limit: ' one word only ' }))), []);
  assert.deepEqual(defaultIssues(rubricPaper(block('notes_completion', 1, 6, { instruction: 'Choose ONE WORD ONLY from the passage.' }))), []);
  assert.deepEqual(defaultIssues(rubricPaper(block('summary_completion', 33, 37, { options: ['A one', 'B two', 'C three'] }))), []);
  assert.deepEqual(defaultIssues(rubricPaper(block('summary_completion', 33, 37, { word_limit: 'TWO WORDS' }))), [
    'Q33–37 (summary_completion) không có instruction/word_limit hợp lệ (word_limit hiện tại "TWO WORDS" không thuộc danh sách chuẩn); học viên sẽ thấy "NO MORE THAN TWO WORDS" mặc định.',
  ]);
  assert.match(defaultIssues(rubricPaper(block('short_answer', 7, 9)))[0], /^Q7–9 \(short_answer\).*"NO MORE THAN THREE WORDS" mặc định\.$/);
  for (const type of ['sentence_completion', 'table_completion', 'form_completion', 'flow_chart_completion', 'diagram_label_completion']) {
    assert.equal(defaultIssues(rubricPaper(block(type, 1, 3))).length, 1, type);
  }
  for (const type of ['true_false_not_given', 'mcq_single', 'matching_headings', 'matching_features']) {
    assert.deepEqual(defaultIssues(rubricPaper(block(type, 1, 3))), [], type);
  }
});

test('splits rubric warnings exactly like the student player display groups', () => {
  // Only the first row's rubric is rendered; a later authored rubric starts a new group with its own header.
  const rows = [...block('notes_completion', 1, 3), ...block('notes_completion', 4, 6, { word_limit: 'ONE WORD ONLY' }), ...block('table_completion', 7, 8)];
  assert.deepEqual(defaultIssues(rubricPaper(rows)).map((issue) => issue.split(' ')[0]), ['Q1–3', 'Q7–8']);
  // Consecutive rows without their own rubric inherit the first row's valid one.
  const inherited = [{ q_num: 1, question_type: 'notes_completion', payload: { word_limit: 'ONE WORD ONLY' } }, ...block('notes_completion', 2, 6)];
  assert.deepEqual(defaultIssues(rubricPaper(inherited)), []);
  // The player groups per passage, so a block that crosses passages is reported per passage.
  const passages = [{ id: 'p1', passage_order: 1 }, { id: 'p2', passage_order: 2 }];
  const crossing = block('sentence_completion', 12, 15).map((row) => row.q_num > 13 ? { ...row, passage_id: 'p2', passage_order: 2 } : row);
  assert.deepEqual(defaultIssues(rubricPaper(crossing, passages)).map((issue) => issue.split(' ')[0]), ['Q12–13', 'Q14–15']);
});

test('warns about a {{n}} marker followed by an underscore run and diagram prompts with raw markup (RV-05, T-DIAG)', () => {
  const markupIssues = (paper) => normalizeReadingAdminPreview(paper).issues.filter((issue) => issue.includes('{{') || issue.includes('(sơ đồ)'));
  // B15-T1 shape: every Q19–22 row repeats the summary, so the marker is reported once.
  const summary = 'drop in {{21}} ________ of cars; yearly {{22}} of each car; {{ 23 }}___ end';
  const summaryRows = block('summary_completion', 21, 23, (qNum) => ({ word_limit: 'ONE WORD ONLY', ...(qNum === 21 ? { template: { summary_text: summary } } : {}) }))
    .map((row) => ({ ...row, prompt: summary }));
  assert.deepEqual(markupIssues(rubricPaper(summaryRows)), [
    '{{21}}, {{23}} có dãy "___" ngay sau; player và trang chữa bài hiển thị thành một ô — nên xoá dãy gạch dưới khỏi template.',
  ]);
  const tableRows = block('table_completion', 31, 31, { word_limit: 'ONE WORD ONLY', template: { headers: ['Stage', 'Detail'], rows: [['Start', ['{{31}}\t____ wide']]] } });
  assert.match(markupIssues(rubricPaper(tableRows))[0], /^\{\{31\}\} có dãy/);
  assert.deepEqual(markupIssues(rubricPaper(block('summary_completion', 1, 2, { word_limit: 'ONE WORD ONLY', template: { summary_text: 'a {{1}} b ____ {{2}} __ c' } }))), []);
  // B21-T4 shape: the flow chart, a markdown image and markers sit in each diagram row prompt.
  const diagramRows = block('flow_chart_completion', 8, 10, { word_limit: 'ONE WORD ONLY' })
    .map((row) => ({ ...row, prompt: row.q_num === 8 ? 'Steps\n![Flow](assets/q8.png)\nuse {{10}} to transport' : 'Use the visual shown with Question 8.' }));
  assert.deepEqual(markupIssues(rubricPaper(diagramRows)), [
    'Q8 (sơ đồ) có prompt chứa ảnh markdown hoặc {{n}}; player bỏ ảnh và hiện {{n}} thành "(n) ______" — nên để mỗi câu một bước sạch.',
  ]);
  assert.deepEqual(markupIssues(rubricPaper(block('sentence_completion', 1, 1, { word_limit: 'ONE WORD ONLY' }).map((row) => ({ ...row, prompt: '![x](y) {{1}}' })))), []);
});

test('admin word-limit list stays in lockstep with the student player', () => {
  const controller = read('lib', 'reading-exam-controller.mjs');
  const literal = /const WORD_LIMITS = new Set\(\[([\s\S]*?)\]\);/.exec(controller)?.[1];
  assert.ok(literal, 'reading-exam-controller.mjs no longer declares WORD_LIMITS');
  assert.deepEqual([...literal.matchAll(/'([^']+)'/g)].map((match) => match[1]).sort(), [...READING_PLAYER_WORD_LIMITS].sort());
  for (const limit of READING_PLAYER_WORD_LIMITS) {
    const type = limit === 'NO MORE THAN THREE WORDS' ? 'sentence_completion' : 'short_answer';
    assert.match(readingQuestionInstruction([{ q_num: 1, question_type: type, payload: { word_limit: limit } }]), new RegExp(`Choose ${limit.replace('/', '\\/')} from`));
  }
});

test('pins passage grouping, diagram block ownership and IMG-PROMPT matching', () => {
  const normalized = normalizeReadingAdminPreview(payload()).test;
  const rows = questionsByPassage(normalized, 'p1');
  assert.equal(rows.length, 3);
  assert.equal(diagramRole(rows, 0), null);
  assert.deepEqual(diagramRole(rows, 1), { lead: true, leadQNum: 2 });
  assert.deepEqual(diagramRole(rows, 2), { lead: false, leadQNum: 2 });
  assert.equal(imagePromptForQuestion(normalized.passages[0], 2).prompt, 'Draw a safe diagram');
});

test('requires mutation ACK identity and exact upload path', () => {
  assert.deepEqual(normalizeReadingImageUploadAck({ question_id: 'q2', image_storage_path: 'tests/t1/q2.png', image_size_bytes: 100, image_format: 'png' }, 'q2'), { path: 'tests/t1/q2.png', signedUrl: null, size: 100, format: 'png' });
  assert.equal(normalizeReadingImageUploadAck({ question_id: 'wrong', image_storage_path: 'x' }, 'q2'), null);
  assert.deepEqual(normalizeReadingImageDeleteAck({ question_id: 'q2', deleted: false }, 'q2'), { deleted: false });
  assert.equal(normalizeReadingImageDeleteAck({ question_id: 'q2', deleted: 'yes' }, 'q2'), null);
});

test('native route owns QA without a retired HTML rollback and retains student-like preview', () => {
  assert.equal(readingPreviewHref('T 1'), '/admin/reading/preview?test_id=T%201');
  assert.equal(readingPreviewHref('T 1', 21), '/admin/reading/preview?test_id=T%201#q21');
  assert.match(PAGE, /<AdminAccessGate>/);
  assert.match(PAGE, /active="reading" subsection="content"/);
  assert.match(LAYOUT, /admin-reading-preview-next\.css/);
  assert.match(LAYOUT, /markdown\.js/);
  assert.doesNotMatch(CLIENT, /\/pages\/admin\/reading\/preview\.html/);
  assert.match(CLIENT, /\/reading\/review\?admin_test_id=/);
  assert.match(CONTENT, /readingPreviewHref\(row\.slug, null, context\)/);
  assert.match(FEEDBACK_MODEL, /return readingPreviewHref\(item\.testId, item\.questionNumber\)/);
  assert.doesNotMatch(CLIENT, /window\.confirm|window\.alert/);
});

test('write flow validates files and reconciles every ACK with canonical GET', () => {
  assert.match(CLIENT, /\['image\/png', 'image\/jpeg', 'image\/webp'\]/);
  assert.match(CLIENT, /5 \* 1024 \* 1024/);
  assert.match(CLIENT, /normalizeReadingImageUploadAck[\s\S]*await load\(false\)[\s\S]*imageStoragePath !== ack\.path/);
  assert.match(CLIENT, /normalizeReadingImageDeleteAck[\s\S]*await load\(false\)[\s\S]*imageStoragePath/);
  assert.match(CLIENT, /Không tự upload lại/);
  assert.match(CLIENT, /Không tự gửi lại mutation/);
  assert.match(CLIENT, /const owner = key/);
  assert.match(CLIENT, /scope\.current !== owner/);
  assert.match(CLIENT, /setDeleteAction\(null\)/);
  assert.doesNotMatch(CLIENT, /setSnapshot\([^\n]*(image|template)/i);
});

test('governed UI covers responsive, focus and reduced-motion behavior', () => {
  assert.match(CSS, /grid-template-columns:minmax\(220px,270px\) minmax\(0,1fr\)/);
  assert.match(CSS, /position:sticky/);
  assert.match(CSS, /@media \(max-width:700px\)/);
  assert.match(CSS, /@media \(prefers-reduced-motion:reduce\)/);
  assert.match(CSS, /min-height:44px/);
  assert.match(CLIENT, /className="arp-file-input" type="file" aria-label=/);
  assert.match(CLIENT, /Boolean\(question\.id\) && busyQuestion === question\.id/);
  assert.match(CSS, /arp-file-label:has\(\.arp-file-input:focus-visible\)/);
  assert.match(WORKFLOW, /verify-admin-reading-preview-flow\.mjs/);
});

test('feedback deep links select the owning passage before scrolling to the question', () => {
  assert.match(CLIENT, /\^#q\(\\d\+\)\$[\s\S]*deepLinkedPassage[\s\S]*item\.qNum === Number/);
  assert.match(CLIENT, /setActivePassage\(\(previous\) => deepLinkedPassage \|\|/);
  assert.match(CLIENT, /addEventListener\('hashchange', selectDeepLinkedPassage\)/);
  assert.match(CLIENT, /removeEventListener\('hashchange', selectDeepLinkedPassage\)/);
  assert.match(CLIENT, /\[activePassage, test\]/);
});

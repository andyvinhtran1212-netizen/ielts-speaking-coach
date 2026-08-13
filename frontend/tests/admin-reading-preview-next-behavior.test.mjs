import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  diagramRole, imagePromptForQuestion, normalizeReadingAdminPreview,
  normalizeReadingImageDeleteAck, normalizeReadingImageUploadAck,
  questionsByPassage, readingPreviewHref,
} from '../lib/admin-reading-preview-model.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
const CLIENT = read('app', '(authed-admin-reading-preview)', 'admin', 'reading', 'preview', 'admin-reading-preview.tsx');
const PAGE = read('app', '(authed-admin-reading-preview)', 'admin', 'reading', 'preview', 'page.tsx');
const LAYOUT = read('app', '(authed-admin-reading-preview)', 'layout.tsx');
const CSS = read('public', 'css', 'admin-reading-preview-next.css');
const CONTENT = read('app', '(authed-admin-reading-content)', 'admin', 'reading', 'content', 'admin-reading-content.tsx');
const FEEDBACK_MODEL = read('lib', 'admin-feedback-model.mjs');
const WORKFLOW = read('..', '.github', 'workflows', 'parity-gate.yml');

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

test('native route owns QA while retaining explicit rollback and student-like preview', () => {
  assert.equal(readingPreviewHref('T 1'), '/admin/reading/preview?test_id=T%201');
  assert.equal(readingPreviewHref('T 1', 21), '/admin/reading/preview?test_id=T%201#q21');
  assert.match(PAGE, /<AdminAccessGate>/);
  assert.match(PAGE, /active="reading" subsection="content"/);
  assert.match(LAYOUT, /admin-reading-preview-next\.css/);
  assert.match(LAYOUT, /markdown\.js/);
  assert.match(CLIENT, /\/pages\/admin\/reading\/preview\.html\?test_id=/);
  assert.match(CLIENT, /\/pages\/reading-review\.html\?admin_test_id=/);
  assert.match(CONTENT, /readingPreviewHref\(row\.slug\)/);
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

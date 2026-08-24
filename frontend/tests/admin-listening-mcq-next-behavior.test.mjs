import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildListeningMcqOperation,
  findListeningMcqOperationMatch,
  listeningMcqDraft,
  listeningMcqHref,
  listeningMcqRollbackHref,
  MAX_MCQ_OPTION_LENGTH,
  MAX_MCQ_QUESTIONS,
  MAX_MCQ_STEM_LENGTH,
  nextListeningMcqOrder,
  normalizeListeningMcqBlocks,
  normalizeListeningMcqContent,
  normalizePendingListeningMcqSave,
  validateListeningMcqDraft,
} from '../lib/admin-listening-mcq-model.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const read = (...parts) => readFileSync(join(here, '..', ...parts), 'utf8');
const CLIENT = read('app', '(authed-admin-listening)', 'admin', 'listening', 'mcq', 'admin-listening-mcq.tsx');
const PAGE = read('app', '(authed-admin-listening)', 'admin', 'listening', 'mcq', 'page.tsx');
const LAYOUT = read('app', '(authed-admin-listening)', 'layout.tsx');
const LIST = read('app', '(authed-admin-listening)', 'admin', 'listening', 'admin-listening-content.tsx');
const DETAIL = read('app', '(authed-admin-listening)', 'admin', 'listening', 'content', '[contentId]', 'admin-listening-content-detail.tsx');
const CSS = read('public', 'css', 'admin-listening-mcq-next.css');
const CHROME = read('public', 'js', 'components', 'aver-admin-chrome.js');
const LEDGER = readFileSync(join(here, '..', '..', 'docs', 'ROUTE_LEDGER.md'), 'utf8');
const WORKFLOW = readFileSync(join(here, '..', '..', '.github', 'workflows', 'parity-gate.yml'), 'utf8');
const BACKEND = readFileSync(join(here, '..', '..', 'backend', 'routers', 'listening.py'), 'utf8');
const MIGRATION = readFileSync(join(here, '..', '..', 'backend', 'migrations', '209_listening_single_published_standalone_block.sql'), 'utf8');

const content = (patch = {}) => ({
  id: 'content-1', title: 'Transport update', transcript: 'The route reopens on Wednesday.',
  audio_duration_seconds: 42, audio_signed_url: 'https://audio.example/signed',
  status: 'published', source_type: 'upload_mp3', ...patch,
});
const questions = (prefix = 'A') => [
  { idx: 0, stem: `${prefix} cause?`, options: ['Weather', 'Traffic', 'Staffing', 'Equipment'], answer_idx: 1 },
  { idx: 1, stem: `${prefix} reopening day?`, options: ['Monday', 'Tuesday', 'Wednesday', 'Thursday'], answer_idx: 2 },
];
const block = (patch = {}) => ({
  id: 'exercise-1', content_id: 'content-1', exercise_type: 'mcq', order_num: 1,
  status: 'draft', updated_at: '2026-08-14T00:00:00+00:00', payload: { questions: questions() }, ...patch,
});
const importedBlock = (patch = {}) => ({
  id: 'imported-1', content_id: 'content-1', exercise_type: 'mcq', order_num: 7,
  status: 'draft', updated_at: '2026-08-14T00:00:00+00:00', payload: {
    variant: 'mcq_3option', template_kind: 'plain', instruction: 'Choose one.',
    questions: [{ q_num: 1, prompt: 'Imported prompt', options: ['A', 'B', 'C'] }],
    answers: [{ q_num: 1, answer: 'B' }],
  },
  ...patch,
});

describe('Admin Listening MCQ canonical model', () => {
  test('normalizes exact content identity and safe audio URL', () => {
    assert.equal(normalizeListeningMcqContent(content(), 'content-1').audioUrl, 'https://audio.example/signed');
    assert.equal(normalizeListeningMcqContent(content({ id: 'other' }), 'content-1'), null);
    assert.equal(normalizeListeningMcqContent(content({ audio_signed_url: 'javascript:bad()' }), 'content-1').audioUrl, null);
    assert.equal(normalizeListeningMcqContent(content({ audio_duration_seconds: '42' }), 'content-1'), null);
  });

  test('preserves ordered blocks and fails closed on malformed questions or duplicate identity', () => {
    const raw = { exercises: [
      block({ id: 'exercise-2', order_num: 2, status: 'published', payload: { questions: questions('B') } }),
      block(),
      block({ id: 'bad', order_num: 3, payload: { questions: [{ idx: 0, stem: 'Bad', options: ['A'], answer_idx: 0 }] } }),
      block({ id: 'duplicate', order_num: 2, payload: { questions: questions('C') } }),
    ] };
    const out = normalizeListeningMcqBlocks(raw, 'content-1');
    assert.deepEqual(out.items.map((item) => item.id), ['exercise-1', 'duplicate', 'exercise-2']);
    assert.equal(out.malformedCount, 1);
    assert.deepEqual(out.duplicateOrders, [2]);
    assert.equal(normalizeListeningMcqBlocks([], 'content-1'), null);
  });

  test('loads oversized legacy text for repair but blocks an oversized write', () => {
    const legacy = block({ payload: { questions: [{
      idx: 0,
      stem: 's'.repeat(MAX_MCQ_STEM_LENGTH + 1),
      options: ['a'.repeat(MAX_MCQ_OPTION_LENGTH + 1), 'B', 'C', 'D'],
      answer_idx: 0,
    }] } });
    const normalized = normalizeListeningMcqBlocks({ exercises: [legacy] }, 'content-1');
    assert.equal(normalized.malformedCount, 0);
    const draft = normalized.items[0].questions;
    const validation = validateListeningMcqDraft(draft);
    assert.equal(validation.ok, false);
    assert.match(validation.errors['question-0'], /1000/);
    assert.match(validation.errors['option-0-0'], /500/);
  });

  test('keeps importer-owned MCQ rows separate from malformed standalone blocks', () => {
    const out = normalizeListeningMcqBlocks({ exercises: [block(), importedBlock()] }, 'content-1');
    assert.deepEqual(out.items.map((item) => item.id), ['exercise-1']);
    assert.equal(out.importedCount, 1);
    assert.deepEqual(out.importedIds, ['imported-1']);
    assert.deepEqual(out.importedOrders, [7]);
    assert.deepEqual(out.importedPublishedOrders, []);
    assert.equal(out.malformedCount, 0);
    assert.equal(nextListeningMcqOrder(out), 8);
    const importerOnly = normalizeListeningMcqBlocks({ exercises: [importedBlock({ order_num: 1 })] }, 'content-1');
    assert.equal(nextListeningMcqOrder(importerOnly), 2);
    assert.deepEqual(normalizeListeningMcqBlocks({ exercises: [importedBlock({ status: 'published' })] }, 'content-1').importedPublishedOrders, [7]);
    assert.equal(listeningMcqDraft(null)[0].answerIdx, null);
    assert.equal(validateListeningMcqDraft(listeningMcqDraft(null)).ok, false);
  });

  test('validates count, exact option shape and answer index', () => {
    assert.equal(validateListeningMcqDraft([]).ok, false);
    assert.equal(validateListeningMcqDraft(Array.from({ length: MAX_MCQ_QUESTIONS + 1 }, () => ({ stem: 'Q', options: ['A', 'B', 'C', 'D'], answerIdx: 0 }))).ok, false);
    const invalid = validateListeningMcqDraft([{ stem: '', options: ['A', '', 'C', 'D'], answerIdx: 9 }]);
    assert.match(invalid.errors['question-0'], /chưa có đề bài/);
    assert.match(invalid.errors['option-0-1'], /chưa có nội dung/);
    assert.match(invalid.errors['answer-0'], /đáp án đúng/);
    const duplicate = validateListeningMcqDraft([{ stem: 'Q', options: ['Same', 'same', 'C', 'D'], answerIdx: 0 }]);
    assert.match(duplicate.errors['option-0-0'], /phải khác nhau/);
    assert.match(duplicate.errors['option-0-1'], /phải khác nhau/);
  });

  test('builds exact update or expected-absent create and reconciles every answer-key field', () => {
    const collection = normalizeListeningMcqBlocks({ exercises: [block()] }, 'content-1');
    const existing = collection.items[0];
    const update = buildListeningMcqOperation({ contentId: 'content-1', block: existing, orderNum: 1, draft: existing.questions, status: 'archived' });
    assert.equal(update.ok, true);
    assert.equal(update.operation.exercise_id, 'exercise-1');
    assert.equal(update.operation.expected_updated_at, '2026-08-14T00:00:00+00:00');
    const archived = normalizeListeningMcqBlocks({ exercises: [block({ status: 'archived' })] }, 'content-1');
    assert.equal(findListeningMcqOperationMatch(archived, update.operation).id, 'exercise-1');
    assert.equal(findListeningMcqOperationMatch(archived, { ...update.operation, content_id: 'other' }), null);
    assert.equal(findListeningMcqOperationMatch(archived, { ...update.operation, order_num: 2 }), null);
    assert.equal(findListeningMcqOperationMatch(archived, { ...update.operation, status: 'draft' }), null);
    const changed = structuredClone(update.operation);
    changed.payload.questions[0].answer_idx = 3;
    assert.equal(findListeningMcqOperationMatch(archived, changed), null);
    const create = buildListeningMcqOperation({ contentId: 'content-1', block: null, orderNum: 2, draft: existing.questions, status: 'draft' });
    assert.equal(create.operation.expected_absent, true);
    assert.equal(Object.hasOwn(create.operation, 'exercise_id'), false);
  });

  test('scopes durable receipts and route identity', () => {
    const pending = { account: 'admin-1', contentId: 'content-1', startedAt: '2026-08-14T00:00:00Z', operation: {
      content_id: 'content-1', exercise_type: 'mcq', order_num: 1, status: 'draft', expected_absent: true,
      payload: { questions: questions() },
    } };
    assert.deepEqual(normalizePendingListeningMcqSave(pending, 'admin-1', 'content-1'), pending);
    assert.equal(normalizePendingListeningMcqSave(pending, 'admin-2', 'content-1'), null);
    assert.equal(listeningMcqHref('a/b', 'x/y'), '/admin/listening/mcq?content_id=a%2Fb&exercise_id=x%2Fy');
    assert.equal(listeningMcqRollbackHref('a/b'), '/pages/admin/listening/mcq.html?content_id=a%2Fb');
  });
});

describe('native MCQ route and persistence contract', () => {
  test('owns the clean admin route and native inventory/detail links', () => {
    assert.match(PAGE, /<AdminAccessGate>/);
    assert.match(PAGE, /subsection="mcq"/);
    assert.match(PAGE, /content_id\?: string/);
    assert.match(PAGE, /if \(!contentId\) redirect\('\/admin\/listening'\)/);
    assert.match(PAGE, /<HydratedSignal \/>/);
    assert.match(PAGE, /<LegacyModule src="\/js\/components\/audio-player\.js" \/>/);
    assert.match(PAGE, /watchdogScript\('\/pages\/admin\/listening\/mcq\.html'\)/);
    assert.doesNotMatch(CHROME, /slug: 'mcq'/);
    assert.match(LIST, /\/admin\/listening\/mcq\?content_id=/);
    assert.match(DETAIL, /`\/admin\/listening\/mcq\?content_id=/);
    assert.match(LEDGER, /`\/admin\/listening\/mcq`[^\n]+required `content_id`; optional exact `exercise_id`/);
  });

  test('uses exact version, durable receipt and GET-only reconciliation', () => {
    assert.match(CLIENT, /buildListeningMcqOperation/);
    assert.match(CLIENT, /window\.api\.postWith\('\/admin\/listening\/exercises'/);
    assert.match(CLIENT, /noRedirect: true/);
    assert.match(CLIENT, /const focusId = useRef\(requestedExerciseId\)/);
    assert.match(CLIENT, /findListeningMcqOperationMatch/);
    assert.match(CLIENT, /let postAcknowledged = false/);
    assert.match(CLIENT, /!postAcknowledged && definitive\(statusCode\)/);
    assert.match(CLIENT, /không tự phát lại POST/);
    assert.match(CLIENT, /sessionStorage\.getItem\(key\) === value/);
    assert.match(CLIENT, /expected_absent/);
    assert.match(CLIENT, /targetStatus === 'archived'/);
    assert.match(BACKEND, /stem must not exceed.*MAX_MCQ_STEM_LENGTH/);
    assert.match(BACKEND, /option.*must be a string/);
    assert.match(BACKEND, /content_row\.get\("test_id"\).*_SINGLE_PUBLISHED_EXERCISE_TYPES/);
    assert.match(BACKEND, /_is_standalone_authoring_exercise/);
    assert.match(MIGRATION, /exercise_type IN \('gist', 'true_false', 'mcq'\)/);
  });

  test('explains scoring and provides accessible focus-stable authoring controls', () => {
    assert.match(CLIENT, /Điểm toàn block = số câu đúng chia tổng số câu/);
    assert.match(CLIENT, /đúng 100% câu hỏi/);
    assert.match(CLIENT, /aria-label=\{`Chọn \$\{LETTERS/);
    assert.match(CLIENT, /aria-label=\{`Xóa câu/);
    assert.match(CLIENT, /aria-disabled=\{index === 0\} disabled=\{locked\}/);
    assert.match(CLIENT, /aria-live="polite"/);
    assert.match(CLIENT, /beforeunload/);
    assert.match(CLIENT, /<Dialog open=\{confirm !== null\}/);
    assert.match(CLIENT, /className="alc-banner is-error" role="alert"/);
    assert.match(CLIENT, /MCQ block thuộc kho đề/);
    assert.match(CLIENT, /const importerOwned = Boolean\(collection\?\.importedCount\)/);
    assert.match(CLIENT, /Không thể tạo MCQ standalone/);
    assert.match(CLIENT, /!collection\.importedCount && <a className="alc-rollback"/);
    assert.match(CLIENT, /answerIdx: null/);
    assert.match(CLIENT, /text: messageOf\(caught\)/);
    assert.doesNotMatch(CLIENT, /\b(?:window\.)?(?:alert|confirm)\s*\(/i);
  });

  test('loads token-only responsive CSS and parity verifier', () => {
    assert.match(LAYOUT, /admin-listening-mcq-next\.css/);
    assert.match(CSS, /:focus-visible/);
    assert.match(CSS, /@media \(max-width: 760px\)/);
    assert.match(CSS, /min-height: 44px/);
    assert.match(CSS, /-webkit-backdrop-filter: blur\(16px\)/);
    assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)/);
    assert.doesNotMatch(CSS, /#[0-9a-fA-F]{3,8}\b/);
    assert.match(WORKFLOW, /verify-admin-listening-mcq-flow\.mjs/);
  });
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildListeningTrueFalseOperation, findListeningTrueFalseOperationMatch,
  listeningTrueFalseHref, listeningTrueFalseRollbackHref, MAX_TF_STATEMENTS,
  MAX_TF_STATEMENT_LENGTH,
  normalizeListeningTrueFalseBlocks, normalizeListeningTrueFalseContent,
  normalizePendingListeningTrueFalseSave, validateListeningTrueFalseDraft,
} from '../lib/admin-listening-true-false-model.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const read = (...parts) => readFileSync(join(here, '..', ...parts), 'utf8');
const CLIENT = read('app', '(authed-admin-listening)', 'admin', 'listening', 'tf', 'admin-listening-true-false.tsx');
const PAGE = read('app', '(authed-admin-listening)', 'admin', 'listening', 'tf', 'page.tsx');
const LAYOUT = read('app', '(authed-admin-listening)', 'layout.tsx');
const LIST = read('app', '(authed-admin-listening)', 'admin', 'listening', 'admin-listening-content.tsx');
const DETAIL = read('app', '(authed-admin-listening)', 'admin', 'listening', 'content', '[contentId]', 'admin-listening-content-detail.tsx');
const CSS = read('public', 'css', 'admin-listening-true-false-next.css');
const CHROME = read('public', 'js', 'components', 'aver-admin-chrome.js');
const LEDGER = readFileSync(join(here, '..', '..', 'docs', 'ROUTE_LEDGER.md'), 'utf8');
const WORKFLOW = readFileSync(join(here, '..', '..', '.github', 'workflows', 'parity-gate.yml'), 'utf8');
const BACKEND = readFileSync(join(here, '..', '..', 'backend', 'routers', 'listening.py'), 'utf8');
const MIGRATION = readFileSync(join(here, '..', '..', 'backend', 'migrations', '209_listening_single_published_standalone_block.sql'), 'utf8');

const content = (patch = {}) => ({
  id: 'content-1', title: 'Urban transport', transcript: 'The route closes on Sunday.',
  audio_duration_seconds: 42, audio_signed_url: 'https://audio.example/signed',
  status: 'published', source_type: 'upload_mp3', ...patch,
});
const statements = (prefix = 'A') => [
  { idx: 0, text: `${prefix} route closes on Sunday.`, answer: 'T' },
  { idx: 1, text: `${prefix} route stays open.`, answer: 'F' },
  { idx: 2, text: `${prefix} route opened in 1980.`, answer: 'NG' },
];
const block = (patch = {}) => ({
  id: 'exercise-1', content_id: 'content-1', exercise_type: 'true_false', order_num: 1,
  status: 'draft', updated_at: '2026-08-14T00:00:00+00:00', payload: { statements: statements() }, ...patch,
});

describe('Admin Listening True/False canonical model', () => {
  test('normalizes exact content identity and safe audio URL', () => {
    assert.equal(normalizeListeningTrueFalseContent(content(), 'content-1').title, 'Urban transport');
    assert.equal(normalizeListeningTrueFalseContent(content({ audio_signed_url: 'javascript:bad' }), 'content-1').audioUrl, null);
    assert.equal(normalizeListeningTrueFalseContent(content(), 'other'), null);
    assert.equal(normalizeListeningTrueFalseContent(content({ status: 'unknown' }), 'content-1'), null);
  });

  test('preserves ordered blocks and fails closed on malformed statements or duplicate identity', () => {
    const value = normalizeListeningTrueFalseBlocks({ exercises: [
      block({ id: 'exercise-2', order_num: 2 }), block(),
      block({ id: 'duplicate', order_num: 1 }), block({ id: '', order_num: 3 }),
    ] }, 'content-1');
    assert.deepEqual(value.items.map((item) => item.orderNum), [1, 1, 2]);
    assert.deepEqual(value.duplicateOrders, [1]);
    assert.equal(value.malformedCount, 1);
    assert.equal(normalizeListeningTrueFalseBlocks({ exercises: [block({ payload: { statements: [{ idx: 0, text: 'only', answer: 'T' }] } })] }, 'content-1').malformedCount, 1);
  });

  test('validates statement count, text and exact ground truth', () => {
    assert.equal(validateListeningTrueFalseDraft([{ text: '', answer: 'T' }]).ok, false);
    assert.equal(validateListeningTrueFalseDraft([{ text: 'a', answer: 'T' }, { text: 'b', answer: 'F' }, { text: '', answer: 'NG' }]).ok, false);
    assert.equal(validateListeningTrueFalseDraft([{ text: 'a', answer: 'T' }, { text: 'b', answer: 'maybe' }, { text: 'c', answer: 'NG' }]).ok, false);
    assert.equal(validateListeningTrueFalseDraft(Array.from({ length: MAX_TF_STATEMENTS + 1 }, (_, index) => ({ text: `q${index}`, answer: 'T' }))).ok, false);
    const oversized = [{ text: 'a'.repeat(MAX_TF_STATEMENT_LENGTH + 1), answer: 'T' }, { text: 'b', answer: 'F' }, { text: 'c', answer: 'NG' }];
    assert.equal(validateListeningTrueFalseDraft(oversized).ok, false);
    assert.match(validateListeningTrueFalseDraft(oversized).errors['statement-0'], /1000/);
    assert.equal(normalizeListeningTrueFalseBlocks({ exercises: [block({ payload: { statements: statements().map((item, index) => index ? item : { ...item, text: 'a'.repeat(MAX_TF_STATEMENT_LENGTH + 1) }) } })] }, 'content-1').malformedCount, 0);
  });

  test('builds exact update or expected-absent create and reconciles every answer', () => {
    const collection = normalizeListeningTrueFalseBlocks({ exercises: [block()] }, 'content-1');
    const existing = collection.items[0];
    const update = buildListeningTrueFalseOperation({ contentId: 'content-1', block: existing, orderNum: 1, draft: existing.statements, status: 'draft' });
    assert.equal(update.operation.exercise_id, 'exercise-1');
    assert.equal(update.operation.expected_updated_at, '2026-08-14T00:00:00+00:00');
    assert.equal(findListeningTrueFalseOperationMatch(collection, update.operation).id, 'exercise-1');
    const changed = structuredClone(update.operation);
    changed.payload.statements[1].answer = 'T';
    assert.equal(findListeningTrueFalseOperationMatch(collection, changed), null);
    const wrongStatus = structuredClone(update.operation); wrongStatus.status = 'published';
    assert.equal(findListeningTrueFalseOperationMatch(collection, wrongStatus), null);
    const wrongOrder = structuredClone(update.operation); wrongOrder.order_num = 2;
    assert.equal(findListeningTrueFalseOperationMatch(collection, wrongOrder), null);
    const wrongContent = structuredClone(update.operation); wrongContent.content_id = 'content-2';
    assert.equal(findListeningTrueFalseOperationMatch(collection, wrongContent), null);

    const create = buildListeningTrueFalseOperation({ contentId: 'content-1', block: null, orderNum: 2, draft: existing.statements, status: 'published' });
    assert.equal(create.operation.expected_absent, true);
    assert.equal(create.operation.order_num, 2);
    assert.equal(Object.hasOwn(create.operation, 'exercise_id'), false);
  });

  test('scopes durable receipts and route identity', () => {
    const pending = { account: 'admin-1', contentId: 'content-1', startedAt: '2026-08-14T00:00:00Z', operation: {
      content_id: 'content-1', exercise_type: 'true_false', order_num: 1, status: 'draft', expected_absent: true,
      payload: { statements: statements() },
    } };
    assert.deepEqual(normalizePendingListeningTrueFalseSave(pending, 'admin-1', 'content-1'), pending);
    assert.equal(normalizePendingListeningTrueFalseSave(pending, 'admin-2', 'content-1'), null);
    assert.equal(listeningTrueFalseHref('a/b', 'x/y'), '/admin/listening/tf?content_id=a%2Fb&exercise_id=x%2Fy');
    assert.equal(listeningTrueFalseRollbackHref('a/b', 'x/y'), '/pages/admin/listening/tf.html?content_id=a%2Fb&exercise_id=x%2Fy');
  });
});

describe('native True/False route and persistence contract', () => {
  test('owns the clean admin route and native inventory/detail links', () => {
    assert.match(PAGE, /<AdminAccessGate>/);
    assert.match(PAGE, /subsection="tf"/);
    assert.match(PAGE, /content_id\?: string/);
    assert.match(PAGE, /if \(!contentId\) redirect\('\/admin\/listening'\)/);
    assert.match(PAGE, /<HydratedSignal \/>/);
    assert.match(PAGE, /<LegacyModule src="\/js\/components\/audio-player\.js" \/>/);
    assert.match(PAGE, /watchdogScript\('\/pages\/admin\/listening\/tf\.html'\)/);
    assert.doesNotMatch(CHROME, /slug: 'tf'/);
    assert.match(LIST, /\/admin\/listening\/tf\?content_id=/);
    assert.match(DETAIL, /item\.type === 'true_false' \? `\/admin\/listening\/tf\?content_id=/);
    assert.match(LEDGER, /`\/admin\/listening\/tf`[^\n]+required `content_id`; optional exact `exercise_id`/);
  });

  test('uses exact version, durable receipt and GET-only reconciliation', () => {
    assert.match(CLIENT, /buildListeningTrueFalseOperation/);
    assert.match(CLIENT, /window\.api\.postWith\('\/admin\/listening\/exercises'/);
    assert.match(CLIENT, /noRedirect: true/);
    assert.match(CLIENT, /const focusId = useRef\(requestedExerciseId\)/);
    assert.match(CLIENT, /const focusOrder = useRef<number \| null>\(null\)/);
    assert.match(CLIENT, /if \(!baseline\) focusOrder\.current = orderNum/);
    assert.match(CLIENT, /const nextCollection = await readCollection\(\)/);
    assert.match(CLIENT, /findListeningTrueFalseOperationMatch/);
    assert.match(CLIENT, /let postAcknowledged = false/);
    assert.match(CLIENT, /!postAcknowledged && definitive\(statusCode\)/);
    assert.match(CLIENT, /không tự phát lại POST/);
    assert.match(CLIENT, /sessionStorage\.getItem\(key\) === value/);
    assert.match(CLIENT, /if \(!writeReceipt/);
    assert.match(CLIENT, /if \(!dirty && !pending\) return/);
    assert.match(CLIENT, /nextCollection\.malformedCount/);
    assert.match(CLIENT, /const startNewBlock = \(\) =>/);
    assert.match(CLIENT, /expected_absent/);
    assert.match(CLIENT, /targetStatus === 'archived'/);
    assert.match(BACKEND, /text must not exceed 1000 characters/);
    assert.match(BACKEND, /answer must be a string/);
    assert.match(BACKEND, /Only one published/);
    assert.match(BACKEND, /_is_unique_violation\(exc\)/);
    assert.match(MIGRATION, /CREATE UNIQUE INDEX IF NOT EXISTS idx_listening_exercises_single_published_standalone/);
    assert.match(MIGRATION, /WHERE status = 'published'/);
    assert.match(MIGRATION, /exercise_type IN \('gist', 'true_false', 'mcq'\)/);
    assert.match(CLIENT, /listeningTrueFalseRollbackHref\(contentId, baseline\?\.id \|\| null\)/);
    assert.match(read('public', 'js', 'admin-listening-tf.js'), /getExerciseIdFromUrl[\s\S]+exercises\.find[\s\S]+expected_updated_at/);
  });

  test('explains exact scoring and provides accessible authoring controls', () => {
    assert.match(CLIENT, /Điểm toàn block = số câu đúng chia tổng số câu/);
    assert.match(CLIENT, /đúng 100% nhận định/);
    assert.match(CLIENT, /Audio không đủ dữ kiện để xác nhận hay phủ định/);
    assert.match(CLIENT, /aria-invalid=\{Boolean\(errors\[`statement-/);
    assert.match(CLIENT, /aria-label=\{`Xóa câu/);
    assert.match(CLIENT, /aria-disabled=\{index === 0\} disabled=\{locked\}/);
    assert.match(CLIENT, /aria-disabled=\{index === draft\.length - 1\} disabled=\{locked\}/);
    assert.match(CLIENT, /setReorderNotice/);
    assert.match(CLIENT, /beforeunload/);
    assert.match(CLIENT, /<Dialog open=\{confirm !== null\}/);
    assert.match(CLIENT, /<fieldset className="altf-answer-options"[^>]*>/);
    assert.doesNotMatch(CLIENT, /\b(?:window\.)?(?:alert|confirm)\s*\(/i);
  });

  test('loads token-only responsive CSS and parity verifier', () => {
    assert.match(LAYOUT, /admin-listening-true-false-next\.css/);
    assert.match(CSS, /:focus-visible/);
    assert.match(CSS, /@media \(max-width: 760px\)/);
    assert.match(CSS, /min-height: 44px/);
    assert.match(CSS, /-webkit-backdrop-filter: blur\(16px\)/);
    assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)/);
    assert.doesNotMatch(CSS, /#[0-9a-fA-F]{3,8}\b/);
    assert.match(WORKFLOW, /verify-admin-listening-true-false-flow\.mjs/);
  });
});

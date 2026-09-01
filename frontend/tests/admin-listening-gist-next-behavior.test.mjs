import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  addListeningGistKeywords, buildListeningGistOperation, findListeningGistOperationMatch,
  listeningGistHref, listeningGistRollbackHref, MAX_GIST_KEYWORDS,
  MAX_GIST_PROMPT_LENGTH,
  normalizeListeningGistBlocks, normalizeListeningGistContent, normalizePendingListeningGistSave,
  validateListeningGistDraft,
} from '../lib/admin-listening-gist-model.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const read = (...parts) => readFileSync(join(here, '..', ...parts), 'utf8');
const CLIENT = read('app', '(authed-admin-listening)', 'admin', 'listening', 'gist', 'admin-listening-gist.tsx');
const PAGE = read('app', '(authed-admin-listening)', 'admin', 'listening', 'gist', 'page.tsx');
const LAYOUT = read('app', '(authed-admin-listening)', 'layout.tsx');
const LIST = read('app', '(authed-admin-listening)', 'admin', 'listening', 'admin-listening-content.tsx');
const DETAIL = read('app', '(authed-admin-listening)', 'admin', 'listening', 'content', '[contentId]', 'admin-listening-content-detail.tsx');
const CSS = read('public', 'css', 'admin-listening-gist-next.css');
const CHROME = read('public', 'js', 'components', 'aver-admin-chrome.js');
const LEDGER = readFileSync(join(here, '..', '..', 'docs', 'ROUTE_LEDGER.md'), 'utf8');
const WORKFLOW = readFileSync(join(here, '..', '..', '.github', 'workflows', 'parity-gate.yml'), 'utf8');
const BACKEND = readFileSync(join(here, '..', '..', 'backend', 'routers', 'listening.py'), 'utf8');

const content = (patch = {}) => ({
  id: 'content-1', title: 'Coastal erosion', transcript: 'The coast is changing.',
  audio_duration_seconds: 42, audio_signed_url: 'https://audio.example/signed',
  status: 'published', source_type: 'upload_mp3', ...patch,
});
const block = (patch = {}) => ({
  id: 'exercise-1', content_id: 'content-1', exercise_type: 'gist', order_num: 1,
  status: 'draft', updated_at: '2026-08-14T00:00:00+00:00', payload: {
    prompt_text: 'What is the main idea?', model_answer: 'The speaker explains coastal erosion.',
    rubric_keywords: ['coastal erosion', 'sea level'],
  }, ...patch,
});

describe('Admin Listening Gist canonical model', () => {
  test('normalizes exact content identity and safe audio URL', () => {
    assert.equal(normalizeListeningGistContent(content(), 'content-1').title, 'Coastal erosion');
    assert.equal(normalizeListeningGistContent(content({ audio_signed_url: 'javascript:bad' }), 'content-1').audioUrl, null);
    assert.equal(normalizeListeningGistContent(content(), 'other'), null);
    assert.equal(normalizeListeningGistContent(content({ status: 'unknown' }), 'content-1'), null);
  });

  test('preserves multiple ordered blocks and fails closed on malformed or duplicate identity', () => {
    const value = normalizeListeningGistBlocks({ exercises: [
      block({ id: 'exercise-2', order_num: 2 }), block(),
      block({ id: 'duplicate', order_num: 1 }), block({ id: '', order_num: 3 }),
    ] }, 'content-1');
    assert.deepEqual(value.items.map((item) => item.orderNum), [1, 1, 2]);
    assert.deepEqual(value.duplicateOrders, [1]);
    assert.equal(value.malformedCount, 1);
    assert.equal(normalizeListeningGistBlocks({ exercises: [block({ payload: { prompt_text: 'x', model_answer: 'y', rubric_keywords: ['Same', 'same'] } })] }, 'content-1').malformedCount, 1);
  });

  test('validates explicit rubric limits and never silently truncates keywords', () => {
    assert.equal(validateListeningGistDraft({ promptText: '', modelAnswer: '', keywords: [] }).ok, false);
    const tooMany = Array.from({ length: MAX_GIST_KEYWORDS + 1 }, (_, index) => `keyword-${index}`);
    assert.equal(validateListeningGistDraft({ promptText: 'Question', modelAnswer: 'Answer', keywords: tooMany }).ok, false);
    const added = addListeningGistKeywords(['Climate'], 'climate, sea level; erosion');
    assert.deepEqual(added.keywords, ['Climate', 'sea level', 'erosion']);
    assert.deepEqual(added.rejected, ['climate']);
    const full = addListeningGistKeywords(Array.from({ length: 10 }, (_, index) => `k${index}`), 'overflow');
    assert.equal(full.keywords.length, 10);
    assert.deepEqual(full.rejected, ['overflow']);
    const oversized = 'x'.repeat(MAX_GIST_PROMPT_LENGTH + 1);
    assert.equal(validateListeningGistDraft({ promptText: oversized, modelAnswer: 'Answer', keywords: [] }).ok, false);
    assert.equal(normalizeListeningGistBlocks({ exercises: [block({ payload: { prompt_text: oversized, model_answer: 'Answer', rubric_keywords: [] } })] }, 'content-1').malformedCount, 0);
  });

  test('builds exact update or expected-absent create and reconciles every rubric field', () => {
    const collection = normalizeListeningGistBlocks({ exercises: [block()] }, 'content-1');
    const existing = collection.items[0];
    const update = buildListeningGistOperation({ contentId: 'content-1', block: existing, orderNum: 1, draft: {
      promptText: existing.promptText, modelAnswer: existing.modelAnswer, keywords: existing.keywords,
    }, status: 'draft' });
    assert.equal(update.operation.exercise_id, 'exercise-1');
    assert.equal(update.operation.expected_updated_at, '2026-08-14T00:00:00+00:00');
    assert.equal(findListeningGistOperationMatch(collection, update.operation).id, 'exercise-1');
    const changed = structuredClone(update.operation);
    changed.payload.rubric_keywords = ['different'];
    assert.equal(findListeningGistOperationMatch(collection, changed), null);

    const create = buildListeningGistOperation({ contentId: 'content-1', block: null, orderNum: 2, draft: {
      promptText: 'Summarise the point.', modelAnswer: 'The point is clear.', keywords: [],
    }, status: 'published' });
    assert.equal(create.operation.expected_absent, true);
    assert.equal(create.operation.order_num, 2);
    assert.equal(Object.hasOwn(create.operation, 'exercise_id'), false);
  });

  test('scopes durable receipts and route identity', () => {
    const pending = { account: 'admin-1', contentId: 'content-1', startedAt: '2026-08-14T00:00:00Z', operation: {
      content_id: 'content-1', exercise_type: 'gist', order_num: 1, status: 'draft', expected_absent: true,
      payload: { prompt_text: 'Question', model_answer: 'Answer', rubric_keywords: ['keyword'] },
    } };
    assert.deepEqual(normalizePendingListeningGistSave(pending, 'admin-1', 'content-1'), pending);
    assert.equal(normalizePendingListeningGistSave(pending, 'admin-2', 'content-1'), null);
    assert.equal(listeningGistHref('a/b', 'x/y'), '/admin/listening/gist?content_id=a%2Fb&exercise_id=x%2Fy');
    assert.equal(listeningGistRollbackHref('a/b'), '/pages/admin/listening/gist.html?content_id=a%2Fb');
  });
});

describe('native Gist route and persistence contract', () => {
  test('owns the clean admin route and native inventory/detail links', () => {
    assert.match(PAGE, /<AdminAccessGate>/);
    assert.match(PAGE, /subsection="gist"/);
    assert.match(PAGE, /content_id\?: string/);
    assert.match(PAGE, /if \(!contentId\) redirect\('\/admin\/listening'\)/);
    assert.match(PAGE, /<HydratedSignal \/>/);
    assert.match(PAGE, /<LegacyModule src="\/js\/components\/audio-player\.js" \/>/);
    assert.match(PAGE, /watchdogScript\('\/pages\/admin\/listening\/gist\.html'\)/);
    assert.doesNotMatch(CHROME, /slug: 'gist'/);
    assert.match(LIST, /\/admin\/listening\/gist\?content_id=/);
    assert.match(DETAIL, /item\.type === 'gist' \? `\/admin\/listening\/gist\?content_id=/);
    assert.match(LEDGER, /`\/admin\/listening\/gist`[^\n]+required `content_id`; optional exact `exercise_id`/);
  });

  test('uses exact version, durable receipt and canonical GET-only reconciliation', () => {
    assert.match(CLIENT, /buildListeningGistOperation/);
    assert.match(CLIENT, /window\.api\.postWith\('\/admin\/listening\/exercises'/);
    assert.match(CLIENT, /noRedirect: true/);
    assert.match(CLIENT, /const focusId = useRef\(requestedExerciseId\)/);
    assert.match(CLIENT, /const nextCollection = await readCollection\(\)/);
    assert.match(CLIENT, /findListeningGistOperationMatch/);
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
    assert.match(BACKEND, /rubric_keywords must contain at most 10 items/);
    assert.match(BACKEND, /duplicates another keyword/);
    assert.match(BACKEND, /Only one published/);
  });

  test('makes scoring truth and accessible authoring boundaries explicit', () => {
    assert.match(CLIENT, /AI so khớp ngữ nghĩa/);
    assert.match(CLIENT, /giới hạn tối đa 60 điểm/);
    assert.match(CLIENT, /đạt khi điểm cuối cùng từ 80 trở lên/);
    assert.match(CLIENT, /aria-invalid=\{Boolean\(errors\.promptText\)\}/);
    assert.match(CLIENT, /aria-label=\{`Xóa từ khóa/);
    assert.match(CLIENT, /beforeunload/);
    assert.match(CLIENT, /<Dialog open=\{confirm !== null\}/);
    assert.match(CLIENT, /<fieldset className="alge-status-options">/);
    assert.doesNotMatch(CLIENT, /\b(?:window\.)?(?:alert|confirm)\s*\(/i);
  });

  test('loads token-only responsive CSS and parity verifier', () => {
    assert.match(LAYOUT, /admin-listening-gist-next\.css/);
    assert.match(CSS, /:focus-visible/);
    assert.match(CSS, /@media \(max-width: 760px\)/);
    assert.match(CSS, /min-height: 44px/);
    assert.match(CSS, /-webkit-backdrop-filter: blur\(16px\)/);
    assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)/);
    assert.doesNotMatch(CSS, /#[0-9a-fA-F]{3,8}\b/);
    assert.match(WORKFLOW, /verify-admin-listening-gist-flow\.mjs/);
  });
});

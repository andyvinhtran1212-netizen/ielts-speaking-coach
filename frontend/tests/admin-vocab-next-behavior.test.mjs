import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-admin-vocab)', 'admin', 'vocab', 'page.tsx');
const STATS_PAGE = read('app', '(authed-admin-vocab)', 'admin', 'vocab', 'stats', 'page.tsx');
const CLIENT = read('app', '(authed-admin-vocab)', 'admin', 'vocab', 'stats', 'admin-vocab-stats.tsx');
const LAYOUT = read('app', '(authed-admin-vocab)', 'layout.tsx');
const CHROME = read('public', 'js', 'components', 'aver-admin-chrome.js');
const OVERVIEW = read('app', '(authed-admin-overview)', 'admin', 'admin-overview.tsx');
const LEGACY_HUB = read('public', 'pages', 'admin', 'vocab', 'index.html');
const WORKFLOW = read('..', '.github', 'workflows', 'parity-gate.yml');

describe('Admin Vocabulary native ownership', () => {
  test('owns clean hub and stats routes while retaining rollback HTML', () => {
    assert.match(PAGE, /<AdminAccessGate>/);
    assert.match(STATS_PAGE, /<AdminAccessGate>/);
    assert.match(CHROME, /section: 'vocab',[^\n]*href: '\/admin\/vocab'/);
    assert.match(CHROME, /slug: 'stats'[^\n]*href: '\/admin\/vocab\/stats'/);
    assert.match(OVERVIEW, /vocab: '\/admin\/vocab'/);
    assert.match(LEGACY_HUB, /href="\/admin\/vocab\/stats"/);
    assert.ok(existsSync(join(ROOT, 'public', 'pages', 'admin', 'vocab', 'stats.html')));
  });

  test('hub exposes all real consoles and learner preview without business reads', () => {
    for (const href of ['/vocabulary/hub', '/admin/vocab/stats', '/admin/vocab/content', '/admin/vocab/topics', '/admin/vocab/quiz', '/admin/vocab/quiz-analytics', '/admin/vocab/d1-curation', '/admin/vocab/lemmas', '/pages/admin/vocab/exercises.html']) assert.ok(PAGE.includes(href), href);
    assert.doesNotMatch(PAGE, /window\.api\.|\bfetch\(/);
  });

  test('stats uses independent canonical reads and readback after the only write', () => {
    assert.match(CLIENT, /Promise\.allSettled/);
    assert.match(CLIENT, /window\.api\.get<unknown>\('\/admin\/vocab\/stats'\)/);
    assert.match(CLIENT, /\/admin\/flashcards\/stats\?days=/);
    assert.match(CLIENT, /window\.api\.post<\{ ok\?: unknown; message\?: unknown \}>/);
    assert.match(CLIENT, /\/vocab-flag/);
    assert.match(CLIENT, /result\?\.ok !== true/);
    assert.match(CLIENT, /const requestId = \+\+sequence\.current/);
    assert.ok((CLIENT.match(/requestId !== sequence\.current/g) || []).length >= 4, 'flag ACK/readback shares the refresh freshness boundary');
    assert.match(CLIENT, /Backend đã xác nhận thay đổi nhưng chưa đọc lại được số liệu chuẩn/);
    assert.ok((CLIENT.match(/window\.api\.get<unknown>\('\/admin\/vocab\/stats'\)/g) || []).length >= 2, 'initial read plus post-write readback');
    assert.match(CLIENT, /isUuid\(canonicalId\)/);
  });

  test('CI pins the route group, model, responsive CSS and browser flow', () => {
    assert.match(LAYOUT, /admin-vocab-next\.css/);
    assert.match(WORKFLOW, /frontend\/app\/\(authed-admin-vocab\)\/\*\*/);
    assert.match(WORKFLOW, /verify-admin-vocab-flow\.mjs/);
  });
});

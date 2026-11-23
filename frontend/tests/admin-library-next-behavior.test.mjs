// LIBRARY-0061 T020 (G06-T20): /admin/library model and wiring.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  TABS,
  hasVietnameseMarks,
  libraryQuery,
  normalizeLibraryFilters,
  normalizeLibraryList,
  normalizePublishResult,
  normalizeTab,
  publishSummary,
  titleProblem,
} from '../lib/admin-library-model.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const DIR = ['app', '(authed-admin)', '(library)'];
const CLIENT = read(...DIR, 'admin', 'library', 'admin-library.tsx');
const PAGE = read(...DIR, 'admin', 'library', 'page.tsx');
const LAYOUT = read(...DIR, 'layout.tsx');

const writingList = (over = {}) => ({
  items: [{
    id: 'w1', slug: 'online-learning', title_en: 'Online learning', task_type: 'task2',
    question_type: 'opinion', task1_subtype: null, topic_slug: 'education', published: false,
    published_at: null, updated_at: '2026-11-01T00:00:00+00:00',
    blockers: [{ code: 'E_NO_REVIEW', message: 'Bộ bài chưa được duyệt nội dung.' }],
  }],
  total: 1, page: 1, page_size: 50, counts: { all: 3, published: 2, draft: 1 },
  topics: [{ slug: 'education', label_vi: 'Giáo dục' }],
  ...over,
});

describe('admin library model', () => {
  test('tabs: three live tabs, shelves and seo are placeholders (open question 12)', () => {
    assert.deepEqual(TABS.filter((t) => t.live).map((t) => t.id), ['writing', 'speaking', 'import']);
    assert.deepEqual(TABS.filter((t) => !t.live).map((t) => t.id), ['shelves', 'seo']);
    assert.equal(normalizeTab('speaking'), 'speaking');
    assert.equal(normalizeTab('bogus'), 'writing');
  });

  test('filters fall back on unknown values and the query omits defaults', () => {
    const w = normalizeLibraryFilters('writing', { status: 'x', task: 'task9', topic: 'Bad Topic', page: '0', q: '  bus  ' });
    assert.deepEqual(w, { status: 'all', q: 'bus', topic: '', page: 1, task: '' });
    assert.equal(libraryQuery('writing', w), 'q=bus');
    const s = normalizeLibraryFilters('speaking', { status: 'draft', part: '2', topic: 'hobbies', page: '3' });
    assert.equal(libraryQuery('speaking', s), 'status=draft&part=2&topic=hobbies&page=3');
  });

  test('list keeps server counts and refuses a malformed answer', () => {
    const list = normalizeLibraryList('writing', writingList());
    assert.deepEqual(list.counts, { all: 3, published: 2, draft: 1 });
    assert.equal(list.items[0].blockers[0].code, 'E_NO_REVIEW');
    assert.equal(list.pageCount, 1);
    assert.equal(normalizeLibraryList('writing', writingList({ counts: { all: 3, published: 2, draft: 2 } })), null);
    assert.equal(normalizeLibraryList('writing', writingList({ items: [{ id: 'w1' }] })), null);
    assert.equal(normalizeLibraryList('writing', { items: [] }), null);
    assert.equal(normalizeLibraryList('speaking', writingList()), null); // no part on a speaking row
  });

  test('publish result keeps every refusal with its reasons', () => {
    const result = normalizePublishResult({
      changed: ['w2'], unchanged: ['w1'], audit_logged: true,
      rejected: [{ id: 'w3', slug: 'chart', reasons: [{ code: 'E_FIGURE', message: 'Đề Task 1 chưa có hình đề.' }] }],
    });
    assert.equal(result.rejected[0].reasons[0].code, 'E_FIGURE');
    assert.equal(publishSummary(result, { published: true }), 'Đã đăng 1 mục · 1 mục không đổi · 1 mục bị loại');
    assert.equal(normalizePublishResult({ changed: [], unchanged: [], rejected: [] }), null); // audit flag required
    assert.equal(normalizePublishResult({ changed: [], unchanged: [], audit_logged: true, rejected: [{ id: 'x', reasons: [] }] }), null);
  });

  test('title pre-check matches the backend rule', () => {
    assert.equal(hasVietnameseMarks('Đi học'), true);
    assert.equal(hasVietnameseMarks('Tiếng'), true);
    assert.equal(hasVietnameseMarks('Online learning'), false);
    assert.equal(titleProblem('writing', 'ab'), 'Tiêu đề dài 3–70 ký tự (hiện 2).');
    assert.match(titleProblem('writing', 'Học online'), /không có dấu/);
    assert.equal(titleProblem('writing', 'Online learning'), null);
    assert.equal(titleProblem('speaking', 'Hi'), null); // speaking has no length bound
  });
});

describe('admin library wiring', () => {
  test('page sits in the (authed-admin) group behind the admin gate, noindex', () => {
    assert.match(PAGE, /<AdminAccessGate><AdminLibrary \/><\/AdminAccessGate>/);
    assert.match(PAGE, /robots: \{ index: false, follow: false \}/);
    assert.match(LAYOUT, /\/css\/admin-library-next\.css/);
    assert.doesNotMatch(LAYOUT, /AuthedShell/); // the shell is owned by (authed-admin)/layout.tsx
  });

  test('client calls the typed admin API and refetches after every mutation', () => {
    assert.match(CLIENT, /'\/admin\/library\/writing-samples'/);
    assert.match(CLIENT, /'\/admin\/library\/speaking-samples'/);
    assert.match(CLIENT, /postBrowserJsonAt\(CONTRACT\[shelf\]\.publish, `\$\{API\[shelf\]\}\/publish`/);
    assert.match(CLIENT, /from '@\/lib\/browser-api'/); // typed adapter, not raw window.api
    assert.doesNotMatch(CLIENT, /window\.api\./);
    assert.match(CLIENT, /await load\(\); \/\/ canonical state after every mutation/);
    assert.match(CLIENT, /Chưa có dữ liệu lô nhập\./);
    assert.match(CLIENT, /Chưa có ở đợt này\./);
    assert.match(CLIENT, /disabled=\{saving \|\| Boolean\(problem\)/); // Save off while the title is invalid
    assert.doesNotMatch(CLIENT, /type="file"/); // no upload box in this batch
  });
});

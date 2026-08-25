import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const GRAMMAR = path.join(FRONTEND, 'app', '(public-content)', 'grammar');
const PAGE_PATH = path.join(GRAMMAR, 'compare', 'page.tsx');
const PAGE = readFileSync(PAGE_PATH, 'utf8');
const API = readFileSync(path.join(FRONTEND, 'lib', 'grammar-api.ts'), 'utf8');
const SHELL = readFileSync(path.join(GRAMMAR, '[category]', '[slug]', 'page-shell.tsx'), 'utf8');
const LEGACY_JS = readFileSync(path.join(FRONTEND, 'public', 'js', 'grammar.js'), 'utf8');
const LEGACY = path.join(FRONTEND, 'public', 'pages', 'grammar-compare.html');
const LEDGER = readFileSync(path.join(FRONTEND, '../docs/ROUTE_LEDGER.md'), 'utf8');
const PARITY = readFileSync(path.join(FRONTEND, 'tooling', 'parity-diff.mjs'), 'utf8');
const PARITY_CORE = readFileSync(path.join(FRONTEND, 'tooling', 'parity-core.mjs'), 'utf8');

describe('/grammar/compare native ownership', () => {
  test('route Next tồn tại còn rollback legacy vẫn phục vụ độc lập', () => {
    assert.ok(existsSync(PAGE_PATH));
    assert.ok(existsSync(LEGACY));
    assert.match(LEDGER, /`\/grammar\/compare`[^\n]+app\/\(public-content\)\/grammar\/compare\/page\.tsx[^\n]+CUTOVER/);
    assert.match(LEDGER, /`slug` theo dạng `<left>-vs-<right>`/);
  });

  test('đọc query sau Suspense và fetch qua tầng public dùng chung', () => {
    assert.match(PAGE, /<Suspense fallback=\{<CompareSkeleton \/>\}>/);
    assert.match(PAGE, /async function CompareBody[\s\S]*await searchParams/);
    assert.match(PAGE, /await getCompare\(slug\)/);
    assert.ok(!PAGE.includes('fetch('));
    assert.match(API, /getPublicJson\(`\/api\/grammar\/compare\/\$\{encodeURIComponent\(slug\)\}`\)/);
    assert.match(API, /export const getCompare = cache\(fetchCompare\)/);
  });

  test('giữ đủ compare contract và chỉ trust HTML bài viết biên soạn', () => {
    for (const id of ['breadcrumb', 'compare-container', 'compare-title', 'compare-left', 'compare-right']) {
      assert.match(PAGE, new RegExp(`(?:id=|id:\\s*)["'{]${id}`));
    }
    assert.match(PAGE, /Thiếu tham số slug\./);
    assert.match(PAGE, /if \(!data\) notFound\(\)/);
    assert.match(PAGE, /dangerouslySetInnerHTML=\{\{ __html: article\.html \|\| '' \}\}/);
    assert.doesNotMatch(PAGE, /dangerouslySetInnerHTML[\s\S]{0,100}(article\.title|article\.summary)/);
  });

  test('mọi article compare link dùng URL canonical sạch', () => {
    assert.match(SHELL, /`\/grammar\/compare\?slug=\$\{encodeURIComponent\(compareSlug\)\}`/);
    assert.match(LEGACY_JS, /href="\/grammar\/compare\?slug=/);
    assert.doesNotMatch(SHELL, /pages\/grammar-compare\.html/);
  });

  test('parity chạy cùng fixture backend thật và ánh xạ rollback URL', () => {
    assert.match(PARITY, /name: 'grammar-compare'[\s\S]*legacy: '\/pages\/grammar-compare\.html\?slug=past-perfect-vs-past-simple'[\s\S]*next: '\/grammar\/compare\?slug=past-perfect-vs-past-simple'/);
    assert.match(PARITY, /GET \/api\/grammar\/compare\/past-perfect-vs-past-simple/);
    assert.match(PARITY_CORE, /path === '\/pages\/grammar-compare\.html'\) path = '\/grammar\/compare'/);
  });
});

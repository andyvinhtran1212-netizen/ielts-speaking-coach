import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const GRAMMAR = path.join(FRONTEND, 'app', '(public-content)', 'grammar');
const PAGE = readFileSync(path.join(GRAMMAR, 'search', 'page.tsx'), 'utf8');
const API = readFileSync(path.join(FRONTEND, 'lib', 'grammar-api.ts'), 'utf8');
const CARDS = readFileSync(path.join(GRAMMAR, 'grammar-cards.tsx'), 'utf8');
const LEGACY = path.join(FRONTEND, 'public', 'pages', 'grammar-search.html');
const LEDGER = readFileSync(path.join(FRONTEND, '../docs/ROUTE_LEDGER.md'), 'utf8');
const PARITY = readFileSync(path.join(FRONTEND, 'tooling', 'parity-diff.mjs'), 'utf8');
const PARITY_CORE = readFileSync(path.join(FRONTEND, 'tooling', 'parity-core.mjs'), 'utf8');

describe('/grammar/search native ownership', () => {
  test('route Next tồn tại còn rollback legacy vẫn phục vụ độc lập', () => {
    assert.ok(existsSync(path.join(GRAMMAR, 'search', 'page.tsx')));
    assert.ok(existsSync(LEGACY));
    assert.match(LEDGER, /`\/grammar\/search`[^\n]+app\/\(public-content\)\/grammar\/search\/page\.tsx[^\n]+CUTOVER/);
  });

  test('đọc query sau Suspense và fetch qua tầng public dùng chung', () => {
    assert.match(PAGE, /<Suspense fallback=\{<ResultsSkeleton \/>\}>/);
    assert.match(PAGE, /async function SearchResults[\s\S]*await searchParams/);
    assert.match(PAGE, /await getSearch\(query\)/);
    assert.ok(!PAGE.includes('fetch('));
    assert.match(API, /getPublicJson\(`\/api\/grammar\/search\?q=\$\{encodeURIComponent\(query\)\}`\)/);
    assert.match(API, /export const getSearch = cache\(fetchSearch\)/);
  });

  test('level và IELTS-use facets nằm trong URL canonical và lọc metadata backend', () => {
    assert.match(PAGE, /<form method="get"/);
    assert.match(PAGE, /name="level"/);
    assert.match(PAGE, /name="use"/);
    assert.match(PAGE, /article\.speaking_relevance/);
    assert.match(PAGE, /article\.writing_relevance/);
    assert.match(PAGE, /article\.category === 'grammar-for-reading'/);
  });

  test('giữ đủ empty/result contract và React tự escape query/backend text', () => {
    assert.match(PAGE, /Nhập từ khóa để tìm kiếm\./);
    assert.match(PAGE, /Kết quả cho/);
    assert.match(PAGE, /articles\.length \? `\$\{articles\.length\} kết quả`/);
    assert.match(CARDS, /Không tìm thấy kết quả cho/);
    assert.match(CARDS, /<strong className="text-white\/80">\{query\}<\/strong>/);
    assert.ok(!PAGE.includes('dangerouslySetInnerHTML'));
    assert.ok(!CARDS.includes('dangerouslySetInnerHTML'));
  });

  test('link kết quả dùng article URL sạch và parity chạy cùng query thật', () => {
    assert.match(CARDS, /href=\{articleUrl\(article\.category, article\.slug\)\}/);
    assert.match(PARITY, /name: 'grammar-search'[\s\S]*legacy: '\/pages\/grammar-search\.html\?q=tenses'[\s\S]*next: '\/grammar\/search\?q=tenses'/);
    assert.match(PARITY, /GET \/api\/grammar\/search\?q=tenses/);
    assert.match(PARITY_CORE, /path === '\/pages\/grammar-search\.html'\) path = '\/grammar\/search'/);
  });
});

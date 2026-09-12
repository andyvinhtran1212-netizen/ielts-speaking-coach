import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalNextRouteForLegacy } from '../tooling/legacy-url-mapping.mjs';

const FRONTEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const GRAMMAR = path.join(FRONTEND, 'app', '(public-content)', 'grammar');
const PAGE = readFileSync(path.join(GRAMMAR, 'search', 'page.tsx'), 'utf8');
const API = readFileSync(path.join(FRONTEND, 'lib', 'grammar-api.ts'), 'utf8');
const CARDS = readFileSync(path.join(GRAMMAR, 'grammar-cards.tsx'), 'utf8');
const LEGACY = path.join(
  FRONTEND, 'tests', 'fixtures', 'legacy-html-retired', 'pages', 'grammar-search.html',
);
const LEDGER = readFileSync(path.join(FRONTEND, '../docs/ROUTE_LEDGER.md'), 'utf8');

describe('/grammar/search native ownership', () => {
  test('route Next tồn tại và archived predecessor vẫn kiểm được', () => {
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

  test('link kết quả và URL tương thích đều trỏ tới owner sạch', () => {
    assert.match(CARDS, /href=\{articleUrl\(article\.category, article\.slug\)\}/);
    assert.equal(canonicalNextRouteForLegacy('/pages/grammar-search.html'), '/grammar/search');
  });
});

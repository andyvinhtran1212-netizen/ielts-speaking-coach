/**
 * home-mock-tiles.test.mjs — released mock-result tile on the student home.
 *
 * When a mock sitting is released, a result tile appears next to the "Thi thử
 * Full Test" start card → opens the TRF (mock-result.html). Source-sentinels.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const HOME = read('public', 'pages', 'home.html');
// Luật CSS của mock hub tách khỏi khối <style> inline sang tệp dùng chung
// (review PR #929) để trang legacy và route Next có MỘT nguồn — chép đôi thì
// hai bản trôi khỏi nhau, mà cổng parity G1 so DOM chứ không so CSS.
const MOCK_CSS = read('css', 'mock-hub.css');
const HOME_SHELL = read('app', '(authed-home)', 'home', 'page-shell.tsx');
const LAYOUT = read('app', '(authed-home)', 'layout.tsx');
const JS = read('public', 'js', 'home-mock-tiles.js');

describe('home — mock hub (start card + result-tile slot)', () => {
  test('start card + tile grid container present, tile loader wired', () => {
    assert.match(HOME, /id="mock-hub-grid"/);
    assert.match(HOME, /class="mock-start"[\s\S]*?\/full-test|\/full-test[\s\S]*?class="mock-start"/);
    assert.doesNotMatch(HOME, /\/pages\/full-test\.html/);
    assert.match(HOME, /src="\.\.\/js\/home-mock-tiles\.js"/);
  });
  test('tile styles use design tokens (band + hover)', () => {
    assert.match(MOCK_CSS, /\.mock-result-tile\s*\{/);
    assert.match(MOCK_CSS, /\.mock-result-tile__band[\s\S]*?var\(--av-primary\)/);
  });

  test('luật mock hub chỉ có MỘT nguồn, không chép đôi', () => {
    // Bất biến của lần tách (review PR #929): chép luật trở lại trang legacy
    // hoặc sang JSX thì hai bản trôi khỏi nhau — mà cổng parity G1 so DOM,
    // KHÔNG so CSS, nên nó mù với đúng loại trôi đó.
    assert.ok(!/\.mock-result-tile\s*\{/.test(HOME),
      'luật không được quay lại khối <style> inline của home.html');
    assert.ok(!/\.mock-result-tile\s*\{/.test(HOME_SHELL),
      'không được chép luật sang JSX của route Next');
    assert.match(HOME, /href="\/css\/mock-hub\.css"/, 'trang legacy phải nạp tệp chung');
    assert.match(LAYOUT, /\/css\/mock-hub\.css/, 'route Next phải nạp cùng tệp đó');
  });
});

describe('home-mock-tiles — released results become tiles', () => {
  test('fetches the caller sittings + renders ONLY released ones', () => {
    assert.match(JS, /api\.get\('\/api\/mock-exams\/my-sittings'\)/);
    assert.match(JS, /\.filter\(function \(s\) \{ return s\.released; \}\)/);
  });
  test('tile links to the TRF (mock-result) by sitting_id + shows the overall band', () => {
    assert.match(JS, /mock-result\.html\?sitting=' \+ encodeURIComponent\(s\.sitting_id\)/);
    assert.match(JS, /mock-result-tile__band">' \+ fmtBand\(s\.overall\)/);
  });
  test('best-effort: a fetch error leaves the start card alone', () => {
    assert.match(JS, /\.catch\(function \(\) \{ \/\* silent/);
  });
});

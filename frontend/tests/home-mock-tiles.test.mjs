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
const JS = read('public', 'js', 'home-mock-tiles.js');

describe('home — mock hub (start card + result-tile slot)', () => {
  test('start card + tile grid container present, tile loader wired', () => {
    assert.match(HOME, /id="mock-hub-grid"/);
    assert.match(HOME, /class="mock-start"[\s\S]*?\/pages\/full-test\.html|\/pages\/full-test\.html[\s\S]*?class="mock-start"/);
    assert.match(HOME, /src="\.\.\/js\/home-mock-tiles\.js"/);
  });
  test('tile styles use design tokens (band + hover)', () => {
    assert.match(HOME, /\.mock-result-tile\s*\{/);
    assert.match(HOME, /\.mock-result-tile__band[\s\S]*?var\(--av-primary\)/);
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

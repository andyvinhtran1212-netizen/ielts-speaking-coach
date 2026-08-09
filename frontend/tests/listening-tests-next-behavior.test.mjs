/** Regression gate for `/listening/tests` native React behavior. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-listening)', 'listening', 'tests', 'page.tsx');
const SHELL = read('app', '(authed-listening)', 'listening', 'tests', 'page-shell.tsx');
const BEHAVIOR = read(
  'app', '(authed-listening)', 'listening', 'tests', 'listening-tests-behavior.tsx',
);
const HARD_NAV_GATE = read('tests', 'legacy-module-routes-need-hard-nav.test.mjs');

describe('/listening/tests — native React behavior', () => {
  test('removes legacy module injection, hydration sentinel and watchdog', () => {
    assert.doesNotMatch(PAGE, /LegacyModule|listening-tests-list\.js|watchdogScript|HydratedSignal/);
    assert.doesNotMatch(PAGE, /<script|dangerouslySetInnerHTML|modulepreload/);
    assert.match(PAGE, /<ListeningTestsBehavior\s*\/>/);
    assert.match(SHELL, /\{children\}/);
  });

  test('uses shared auth, fails closed and keys requests by account', () => {
    assert.match(BEHAVIOR, /useAuth\(\)/);
    assert.match(BEHAVIOR, /status === 'signed-out'/);
    assert.match(BEHAVIOR, /window\.location\.replace\('\/login\.html'\)/);
    assert.match(BEHAVIOR, /status !== 'signed-in' \|\| !user\?\.id/);
    assert.match(BEHAVIOR, /accountKey=\{user\.id\} key=\{user\.id\}/);
    assert.match(BEHAVIOR, /\[accountKey\]/);
  });

  test('pages the canonical full-test endpoint and aborts stale work', () => {
    assert.match(BEHAVIOR, /const PAGE_LIMIT = 100/);
    assert.match(BEHAVIOR, /const MAX_PAGES = 20/);
    assert.match(BEHAVIOR, /test_type=full&limit=\$\{PAGE_LIMIT\}&offset=\$\{offset\}/);
    assert.match(BEHAVIOR, /if \(pageItems\.length < PAGE_LIMIT\) return all/);
    assert.match(BEHAVIOR, /window\.api\.getWith<unknown>/);
    assert.match(BEHAVIOR, /new AbortController\(\)/);
    assert.match(BEHAVIOR, /fetchAllTests\(controller\.signal\)/);
    assert.match(BEHAVIOR, /\{ signal \}/);
    assert.match(BEHAVIOR, /controller\.abort\(\)/);
  });

  test('normalizes malformed rows and renders authored values through React', () => {
    assert.match(BEHAVIOR, /value && typeof value === 'object' \? value : \{\}/);
    assert.match(BEHAVIOR, /if \(!id\) return \[\]/);
    assert.match(BEHAVIOR, /Object\.values\(value\)/);
    assert.match(BEHAVIOR, /slice\(0, 3\)/);
    assert.match(BEHAVIOR, /title: textValue\(raw\?\.title\) \|\| 'Untitled test'/);
    assert.doesNotMatch(BEHAVIOR, /innerHTML|dangerouslySetInnerHTML|__html|eval\(/);
  });

  test('keeps all four states and honest pagination overflow error', () => {
    assert.match(BEHAVIOR, /state\.status === 'loading'/);
    assert.match(BEHAVIOR, /Chưa có test nào sẵn sàng\./);
    assert.match(BEHAVIOR, /Không tải được danh sách tests:/);
    assert.match(BEHAVIOR, /Danh sách vượt \$\{MAX_PAGES \* PAGE_LIMIT\} mục/);
    assert.match(BEHAVIOR, /<section id="lt-grid" className="lt-grid">/);
  });

  test('preserves stats, CTA modes and both player destinations', () => {
    assert.match(BEHAVIOR, /test\.bestScore[\s\S]*Điểm tốt nhất:/);
    assert.match(BEHAVIOR, /test\.attemptCount > 0/);
    assert.match(BEHAVIOR, /Làm lại/);
    assert.match(BEHAVIOR, /Bắt đầu test/);
    assert.match(BEHAVIOR, /listening-test\.html\?id=\$\{encodeURIComponent\(test\.id\)\}&from=full/);
    assert.match(BEHAVIOR, /listening-test-dictation\.html\?test_id=\$\{encodeURIComponent\(test\.id\)\}/);
  });

  test('is no longer hard-navigation-only', () => {
    const list = HARD_NAV_GATE.match(/const LEGACY_MODULE_ROUTES = \[([\s\S]*?)\];/)?.[1] || '';
    assert.doesNotMatch(list, /['"]\/listening\/tests['"]/);
  });
});

/** Regression gate for `/listening/practice` native React behavior. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-listening)', 'listening', 'practice', 'page.tsx');
const SHELL = read('app', '(authed-listening)', 'listening', 'practice', 'page-shell.tsx');
const BEHAVIOR = read(
  'app', '(authed-listening)', 'listening', 'practice', 'listening-practice-behavior.tsx',
);
const HARD_NAV_GATE = read('tests', 'legacy-module-routes-need-hard-nav.test.mjs');

describe('/listening/practice — native React behavior', () => {
  test('removes legacy injection and delegates the state machine to React', () => {
    assert.doesNotMatch(PAGE, /LegacyModule|listening-practice\.js|watchdogScript|HydratedSignal/);
    assert.doesNotMatch(PAGE, /<script|dangerouslySetInnerHTML|modulepreload/);
    assert.match(PAGE, /<ListeningPracticeBehavior\s*\/>/);
    assert.match(SHELL, /\{children\}/);
  });

  test('uses shared auth, fails closed and scopes overview/cache by account', () => {
    assert.match(BEHAVIOR, /useAuth\(\)/);
    assert.match(BEHAVIOR, /status === 'signed-out'/);
    assert.match(BEHAVIOR, /window\.location\.replace\('\/login\.html'\)/);
    assert.match(BEHAVIOR, /accountKey=\{user\.id\} key=\{user\.id\}/);
    assert.match(BEHAVIOR, /\[accountKey\]/);
    assert.match(BEHAVIOR, /\[accountKey, active\]/);
  });

  test('uses overview counts to expose only real tabs in pedagogical order', () => {
    assert.match(BEHAVIOR, /'\/api\/listening\/overview'/);
    assert.match(BEHAVIOR, /key: 'trap'[\s\S]*key: 'section'[\s\S]*key: 'curated'/);
    assert.match(BEHAVIOR, /TABS\.filter\(\(tab\) => counts\[tab\.key\] > 0\)/);
    assert.match(BEHAVIOR, /TABS\.filter\(\(tab\) => counts\[tab\.key\] > 0\)\.map/);
    assert.match(BEHAVIOR, /lp-tab-count/);
  });

  test('honors the hash, replaces it safely and caches per-tab pages', () => {
    assert.match(BEHAVIOR, /window\.location\.hash\.replace\(\/\^#\//);
    assert.match(BEHAVIOR, /TABS\.some\(\(tab\) => tab\.key === wanted\)/);
    assert.match(BEHAVIOR, /window\.history\.replaceState\(null, '', `#\$\{active\}`\)/);
    assert.match(BEHAVIOR, /hasTab\(cache, active\)/);
    assert.match(BEHAVIOR, /setCache\(\(current\) => \(\{ \.\.\.current, \[active\]: normalizeTests\(items\) \}\)\)/);
  });

  test('pages the canonical practice-group endpoint and aborts both request layers', () => {
    assert.match(BEHAVIOR, /test_type=practice&practice_group=\$\{encodeURIComponent\(groupKey\)\}/);
    assert.match(BEHAVIOR, /&limit=\$\{PAGE_LIMIT\}&offset=\$\{offset\}/);
    assert.match(BEHAVIOR, /if \(pageItems\.length < PAGE_LIMIT\) return all/);
    assert.match(BEHAVIOR, /fetchAllTests\(active, controller\.signal\)/);
    assert.match(BEHAVIOR, /Danh sách vượt \$\{MAX_PAGES \* PAGE_LIMIT\} mục/);
    assert.ok((BEHAVIOR.match(/controller\.abort\(\)/g) || []).length >= 2);
  });

  test('keeps trap grouping/sort and flat section/curated groups', () => {
    assert.match(BEHAVIOR, /if \(groupKey !== 'trap'\) return \[\{ title: null, items \}\]/);
    assert.match(BEHAVIOR, /test\.trap \|\| 'Khác'/);
    assert.match(BEHAVIOR, /b\[1\]\.length - a\[1\]\.length \|\| a\[0\]\.localeCompare\(b\[0\]\)/);
    assert.match(BEHAVIOR, /lp-group-count/);
  });

  test('preserves card stats, CTA and lightweight runner destination', () => {
    assert.match(BEHAVIOR, /textValue\(raw\.title\) \|\| testId \|\| 'Bài luyện'/);
    assert.match(BEHAVIOR, /Tốt nhất/);
    assert.match(BEHAVIOR, /đã làm \{test\.attemptCount\} lần/);
    assert.match(BEHAVIOR, /attempted \? 'Làm lại' : 'Bắt đầu'/);
    assert.match(BEHAVIOR, /listening-practice-run\.html\?id=\$\{encodeURIComponent\(test\.id\)\}/);
    assert.doesNotMatch(BEHAVIOR, /innerHTML|dangerouslySetInnerHTML|__html|eval\(/);
  });

  test('keeps overview and tab loading/empty/error states truthful', () => {
    assert.match(BEHAVIOR, /overview\.status === 'loading'/);
    assert.match(BEHAVIOR, /Chưa có bài luyện nào\./);
    assert.match(BEHAVIOR, /Không tải được Luyện nhanh:/);
    assert.match(BEHAVIOR, /Không tải được danh sách:/);
    assert.match(BEHAVIOR, /tabState\.status === 'loading'/);
  });

  test('preserves the empty navigation landmark in every overview state', () => {
    assert.match(BEHAVIOR, /function PracticeTabs\(/);
    assert.match(BEHAVIOR, /<nav className="lp-tabs" id="practice-tabs" aria-label="Nhóm bài luyện">/);
    assert.ok((BEHAVIOR.match(/<PracticeTabs \/>/g) || []).length >= 4);
    assert.match(BEHAVIOR, /<PracticeTabs counts=\{overview\.counts\} active=\{active\} onSelect=\{setActive\} \/>/);
  });

  test('is no longer hard-navigation-only', () => {
    const list = HARD_NAV_GATE.match(/const LEGACY_MODULE_ROUTES = \[([\s\S]*?)\];/)?.[1] || '';
    assert.doesNotMatch(list, /['"]\/listening\/practice['"]/);
  });
});

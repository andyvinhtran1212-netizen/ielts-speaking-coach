/** Regression gate for `/listening/analytics` native React behavior. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-listening)', 'listening', 'analytics', 'page.tsx');
const SHELL = read('app', '(authed-listening)', 'listening', 'analytics', 'page-shell.tsx');
const BEHAVIOR = read(
  'app', '(authed-listening)', 'listening', 'analytics', 'listening-analytics-behavior.tsx',
);
const HARD_NAV_GATE = read('tests', 'legacy-module-routes-need-hard-nav.test.mjs');

describe('/listening/analytics — native React behavior', () => {
  test('removes legacy injection and delegates range/data state to React', () => {
    assert.doesNotMatch(PAGE, /LegacyModule|listening-analytics\.js|watchdogScript|HydratedSignal/);
    assert.doesNotMatch(PAGE, /<script|dangerouslySetInnerHTML|modulepreload/);
    assert.match(PAGE, /<ListeningAnalyticsBehavior\s*\/>/);
    assert.match(SHELL, /\{children\}/);
  });

  test('uses shared auth, fails closed and scopes range/results by account', () => {
    assert.match(BEHAVIOR, /useAuth\(\)/);
    assert.match(BEHAVIOR, /status === 'signed-out'/);
    assert.match(BEHAVIOR, /window\.location\.replace\('\/login\.html'\)/);
    assert.match(BEHAVIOR, /accountKey=\{user\.id\} key=\{user\.id\}/);
    assert.match(BEHAVIOR, /\[accountKey, range\]/);
  });

  test('keeps controlled 7d/30d/all tabs and canonical analytics request', () => {
    assert.match(BEHAVIOR, /\['7d', '7 ngày'\][\s\S]*\['30d', '30 ngày'\][\s\S]*\['all', 'Tất cả'\]/);
    assert.match(BEHAVIOR, /useState<RangeKey>\('30d'\)/);
    assert.match(BEHAVIOR, /aria-selected=\{range === key\}/);
    assert.match(BEHAVIOR, /`\/api\/listening\/analytics\?range=\$\{encodeURIComponent\(range\)\}`/);
  });

  test('aborts stale range/account requests and ignores aborted results', () => {
    assert.match(BEHAVIOR, /window\.api\.getWith<unknown>/);
    assert.match(BEHAVIOR, /signal: controller\.signal/);
    assert.match(BEHAVIOR, /disposed = true/);
    assert.match(BEHAVIOR, /controller\.abort\(\)/);
    assert.match(BEHAVIOR, /caught instanceof DOMException && caught\.name === 'AbortError'/);
  });

  test('covers every persisted mode in canonical order', () => {
    assert.match(
      BEHAVIOR,
      /mini: 'Bài học \/ Mini test'[\s\S]*drill: 'Luyện kỹ năng \(drill\)'[\s\S]*full: 'Full test'[\s\S]*practice: 'Luyện nhanh'/,
    );
    assert.match(BEHAVIOR, /Object\.keys\(MODE_LABELS\)/);
    assert.match(BEHAVIOR, /MODE_LABELS\[mode\]/);
  });

  test('weights score by submitted count and completion by all attempts', () => {
    assert.match(BEHAVIOR, /metric\.avgScore \* metric\.scoredCount/);
    assert.match(BEHAVIOR, /scoredCount \+= metric\.scoredCount/);
    assert.match(BEHAVIOR, /metric\.completion \* metric\.attemptsCount/);
    assert.match(BEHAVIOR, /attemptsCount \+= metric\.attemptsCount/);
    assert.match(BEHAVIOR, /trong \$\{summary\.scoredCount\} bài đã nộp/);
  });

  test('trusts only a known backend weakest_mode and preserves all analytics surfaces', () => {
    assert.match(BEHAVIOR, /weakestMode: isModeKey\(weakest\) \? weakest : null/);
    assert.match(BEHAVIOR, /Dạng cần luyện thêm:/);
    assert.match(BEHAVIOR, /id="mode-table-body"/);
    assert.match(BEHAVIOR, /id="day-chart"/);
    assert.match(BEHAVIOR, /Math\.max\(4, Math\.round\(\(day\.count \/ maxCount\) \* 100\)\)/);
    assert.match(BEHAVIOR, /data-has-data=\{day\.count > 0 \? '1' : '0'\}/);
    assert.match(BEHAVIOR, /id="recent-list"/);
  });

  test('preserves abandoned/in-progress/perfect labels and React-escapes authored text', () => {
    assert.match(BEHAVIOR, /status === 'abandoned' \? 'bỏ dở' : 'đang làm'/);
    assert.match(BEHAVIOR, /perfect: accuracy === 1/);
    assert.match(BEHAVIOR, /recent-score\$\{attempt\.perfect \? ' is-perfect' : ''\}/);
    assert.match(BEHAVIOR, /\{attempt\.title\}/);
    assert.doesNotMatch(BEHAVIOR, /innerHTML|dangerouslySetInnerHTML|__html|eval\(/);
  });

  test('keeps loading, empty and error states distinct', () => {
    assert.match(BEHAVIOR, /state\.data\.totalAttempts === 0/);
    assert.match(BEHAVIOR, /Chưa có dữ liệu luyện tập trong khoảng này\./);
    assert.match(BEHAVIOR, /Không tải được thống kê\./);
    assert.match(BEHAVIOR, /state\.data\.totalAttempts > 0/);
  });

  test('closes the final hard-navigation debt entry', () => {
    const list = HARD_NAV_GATE.match(/const LEGACY_MODULE_ROUTES = \[([\s\S]*?)\];/)?.[1] || '';
    assert.equal(list.trim(), '');
  });
});

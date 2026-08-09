/** Regression gate for `/reading/test` native React behavior. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-reading)', 'reading', 'test', 'page.tsx');
const SHELL = read('app', '(authed-reading)', 'reading', 'test', 'page-shell.tsx');
const BEHAVIOR = read(
  'app', '(authed-reading)', 'reading', 'test', 'reading-test-behavior.tsx',
);
const HARD_NAV_GATE = read('tests', 'legacy-module-routes-need-hard-nav.test.mjs');

describe('/reading/test — native React behavior', () => {
  test('removes legacy module injection, hydration sentinel and watchdog', () => {
    assert.doesNotMatch(PAGE, /LegacyModule|reading-test\.js|watchdogScript|HydratedSignal/);
    assert.doesNotMatch(PAGE, /<script|dangerouslySetInnerHTML|modulepreload/);
    assert.match(PAGE, /<ReadingTestBehavior\s*\/>/);
    assert.match(SHELL, /\{children\}/);
  });

  test('uses shared auth, fails closed and keys requests by account', () => {
    assert.match(BEHAVIOR, /useAuth\(\)/);
    assert.match(BEHAVIOR, /status === 'signed-out'/);
    assert.match(BEHAVIOR, /window\.location\.replace\('\/login\.html'\)/);
    assert.match(BEHAVIOR, /status !== 'signed-in' \|\| !user\?\.id/);
    assert.match(BEHAVIOR, /accountKey=\{user\.id\} key=\{user\.id\}/);
    assert.match(BEHAVIOR, /\[accountKey, module\]/);
  });

  test('always requests only full tests and aborts stale work', () => {
    assert.match(BEHAVIOR, /query\.set\('module', module\)/);
    assert.match(BEHAVIOR, /query\.set\('limit', '50'\)/);
    assert.match(BEHAVIOR, /query\.set\('test_type', 'full'\)/);
    assert.match(BEHAVIOR, /window\.api\.getWith<unknown>/);
    assert.match(BEHAVIOR, /`\/api\/reading\/test\?\$\{query\.toString\(\)\}`/);
    assert.match(BEHAVIOR, /new AbortController\(\)/);
    assert.match(BEHAVIOR, /signal: controller\.signal/);
    assert.match(BEHAVIOR, /controller\.abort\(\)/);
  });

  test('normalizes canonical defaults and renders authored data declaratively', () => {
    assert.match(BEHAVIOR, /if \(!Array\.isArray\(items\)\) return \[\]/);
    assert.match(BEHAVIOR, /if \(!testId\) return \[\]/);
    assert.match(BEHAVIOR, /positiveInteger\(raw\?\.passage_count, 3\)/);
    assert.match(BEHAVIOR, /positiveInteger\(raw\?\.total_questions, 40\)/);
    assert.match(BEHAVIOR, /positiveInteger\(raw\?\.time_limit_minutes, 60\)/);
    assert.match(BEHAVIOR, /MODULE_LABEL\[module\] \|\| module/);
    assert.doesNotMatch(BEHAVIOR, /innerHTML|dangerouslySetInnerHTML|__html|eval\(/);
  });

  test('keeps module availability and all four render states truthful', () => {
    assert.match(BEHAVIOR, /value="academic">Academic/);
    assert.match(BEHAVIOR, /value="general_training" disabled/);
    assert.match(BEHAVIOR, /state\.status === 'loading'/);
    assert.match(BEHAVIOR, /Chưa có bài thi nào\./);
    assert.match(BEHAVIOR, /Không tải được danh sách bài thi\./);
    assert.match(BEHAVIOR, /state\.status === 'ready' && state\.tests\.length/);
  });

  test('preserves card facts, pill order and full-exam origin stamp', () => {
    assert.match(BEHAVIOR, /test\.moduleLabel[\s\S]*test\.passageCount[\s\S]*test\.totalQuestions[\s\S]*test\.timeLimitMinutes[\s\S]*test\.bandTarget/);
    assert.match(BEHAVIOR, /admitCorePlayer\('reading_exam', \{ test_id: test\.testId, from: 'full' \}\)/);
  });

  test('is no longer hard-navigation-only', () => {
    const list = HARD_NAV_GATE.match(/const LEGACY_MODULE_ROUTES = \[([\s\S]*?)\];/)?.[1] || '';
    assert.doesNotMatch(list, /['"]\/reading\/test['"]/);
  });
});

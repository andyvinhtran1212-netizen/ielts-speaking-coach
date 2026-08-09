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
const BROWSER_FLOW = read('tooling', 'verify-reading-test-flow.mjs');
const PARITY_WORKFLOW = read('..', '.github', 'workflows', 'parity-gate.yml');

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
    assert.match(BEHAVIOR, /status === 'signed-in' && user\?\.id \? user\.id : null/);
    assert.match(BEHAVIOR, /accountKey=\{accountKey\} key=\{accountKey \|\| status\}/);
    assert.match(BEHAVIOR, /if \(!accountKey\)/);
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
    assert.match(BEHAVIOR, /normalizeTotal\(payload, tests\.length\)/);
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
    assert.match(BEHAVIOR, /reading-exam\.html\?test_id=\$\{encodeURIComponent\(test\.testId\)\}&from=full/);
    assert.match(BEHAVIOR, /className="rv-card__top"/);
    assert.match(BEHAVIOR, /className="rv-card__facts"/);
    assert.match(BEHAVIOR, /className="rv-card__footer"/);
    assert.match(BEHAVIOR, /className="rv-card__cta"/);
    assert.match(BEHAVIOR, /aria-label=\{`Bắt đầu bài thi/);
  });

  test('keeps canonical live totals, reset and generic errors', () => {
    assert.match(SHELL, /totalCount = '—'/);
    assert.match(BEHAVIOR, /total > shown[\s\S]*đang hiển thị/);
    assert.match(BEHAVIOR, /hidden=\{!module\}/);
    assert.match(BEHAVIOR, /onClick=\{\(\) => setModule\(''\)\}/);
    assert.doesNotMatch(BEHAVIOR, /caught instanceof Error \? caught\.message|state\.message/);
  });

  test('runs its browser-backed flow unconditionally in the parity gate', () => {
    assert.match(BROWSER_FLOW, /const ROUTE = '\/reading\/test'/);
    assert.match(BROWSER_FLOW, /response filter cũ không ghi đè response mới/);
    assert.match(BROWSER_FLOW, /Xóa lọc reset mô-đun/);
    assert.match(PARITY_WORKFLOW, /frontend\/tooling\/verify-reading-test-flow\.mjs/);
    assert.match(PARITY_WORKFLOW, /run: node tooling\/verify-reading-test-flow\.mjs/);
  });

  test('is no longer hard-navigation-only', () => {
    const list = HARD_NAV_GATE.match(/const LEGACY_MODULE_ROUTES = \[([\s\S]*?)\];/)?.[1] || '';
    assert.doesNotMatch(list, /['"]\/reading\/test['"]/);
  });
});

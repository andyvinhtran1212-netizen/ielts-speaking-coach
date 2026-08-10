/** Regression gate for `/listening/mini-test` native React behavior. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-listening)', 'listening', 'mini-test', 'page.tsx');
const SHELL = read('app', '(authed-listening)', 'listening', 'mini-test', 'page-shell.tsx');
const BEHAVIOR = read(
  'app', '(authed-listening)', 'listening', 'mini-test', 'listening-mini-test-behavior.tsx',
);
const HARD_NAV_GATE = read('tests', 'legacy-module-routes-need-hard-nav.test.mjs');
const BROWSER_FLOW = read('tooling', 'verify-listening-mini-test-flow.mjs');
const PARITY_WORKFLOW = read('..', '.github', 'workflows', 'parity-gate.yml');

describe('/listening/mini-test — native React behavior', () => {
  test('removes legacy module injection, hydration sentinel and watchdog', () => {
    assert.doesNotMatch(PAGE, /LegacyModule|listening-mini-test\.js|watchdogScript|HydratedSignal/);
    assert.doesNotMatch(PAGE, /<script|dangerouslySetInnerHTML|modulepreload/);
    assert.match(PAGE, /<ListeningMiniTestBehavior\s*\/>/);
    assert.match(SHELL, /\{children\}/);
    assert.match(BEHAVIOR, /<ListeningMiniTestShell/);
  });

  test('uses shared auth, fails closed and keys requests by account', () => {
    assert.match(BEHAVIOR, /useAuth\(\)/);
    assert.match(BEHAVIOR, /status === 'signed-out'/);
    assert.match(BEHAVIOR, /window\.location\.replace\('\/login\.html'\)/);
    assert.match(BEHAVIOR, /status === 'signed-in' && user\?\.id \? user\.id : null/);
    assert.match(BEHAVIOR, /accountKey=\{accountKey\} key=\{accountKey \|\| status\}/);
    assert.match(BEHAVIOR, /\[accountKey\]/);
  });

  test('pages only mini tests and aborts stale work', () => {
    assert.match(BEHAVIOR, /const PAGE_LIMIT = 100/);
    assert.match(BEHAVIOR, /const MAX_PAGES = 20/);
    assert.match(BEHAVIOR, /test_type=mini&limit=\$\{PAGE_LIMIT\}&offset=\$\{offset\}/);
    assert.match(BEHAVIOR, /if \(pageItems\.length < PAGE_LIMIT\) return all/);
    assert.match(BEHAVIOR, /fetchAllMiniTests\(controller\.signal\)/);
    assert.match(BEHAVIOR, /\{ signal \}/);
    assert.match(BEHAVIOR, /controller\.abort\(\)/);
  });

  test('normalizes malformed rows and renders authored values through React', () => {
    assert.match(BEHAVIOR, /value && typeof value === 'object' \? value : \{\}/);
    assert.match(BEHAVIOR, /if \(!id\) return \[\]/);
    assert.match(BEHAVIOR, /Object\.values\(value\)/);
    assert.match(BEHAVIOR, /slice\(0, 3\)/);
    assert.match(BEHAVIOR, /sourceTitle\.toLowerCase\(\) !== catalogId\.toLowerCase\(\)/);
    assert.match(BEHAVIOR, /: 'Mini Listening Test'/);
    assert.doesNotMatch(BEHAVIOR, /innerHTML|dangerouslySetInnerHTML|__html|eval\(/);
  });

  test('keeps all four mini-specific states and honest overflow error', () => {
    assert.match(BEHAVIOR, /state\.status === 'loading'/);
    assert.match(BEHAVIOR, /Chưa có mini test nào sẵn sàng\./);
    assert.match(BEHAVIOR, /Không tải được danh sách mini tests\. Vui lòng thử lại\./);
    assert.match(BEHAVIOR, /Danh sách vượt \$\{MAX_PAGES \* PAGE_LIMIT\} mục/);
    assert.match(BEHAVIOR, /id="state-loading" role="status"/);
    assert.match(BEHAVIOR, /id="state-empty" role="status"/);
    assert.match(BEHAVIOR, /id="state-error" role="alert"/);
    assert.doesNotMatch(BEHAVIOR, /caught instanceof Error[\s\S]*caught\.message|String\(caught\)/);
  });

  test('preserves variable scores, truthful completion and mini destinations', () => {
    assert.match(BEHAVIOR, /test\.bestScore[\s\S]*Điểm tốt nhất:[\s\S]*điểm/);
    assert.doesNotMatch(BEHAVIOR, /bestScore\}\/40/);
    assert.match(BEHAVIOR, /test\.attemptCount > 0/);
    assert.match(BEHAVIOR, /test\.submittedAttemptCount > 0/);
    assert.match(BEHAVIOR, /user_submitted_attempt_count/);
    assert.doesNotMatch(BEHAVIOR, /const attempted = test\.attemptCount > 0/);
    assert.match(BEHAVIOR, /data-status=\{attempted \? 'done' : 'new'\}/);
    assert.match(BEHAVIOR, /Làm lại/);
    assert.match(BEHAVIOR, /\{attempted \? 'Làm lại' : 'Bắt đầu'\}/);
    assert.match(BEHAVIOR, /admitCorePlayer\('listening_test', \{ id: test\.id, from: 'mini' \}\)/);
    assert.match(BEHAVIOR, /admitCorePlayer\('listening_dictation', \{ test_id: test\.id \}\)/);
  });

  test('owns progress summary, status filters and live counts in React', () => {
    assert.match(BEHAVIOR, /useState<'all' \| 'new' \| 'done'>\('all'\)/);
    assert.match(BEHAVIOR, /const doneCount = tests\.filter/);
    assert.match(BEHAVIOR, /newCount=\{ready \? tests\.length - doneCount : null\}/);
    assert.match(BEHAVIOR, /if \(filter === 'done'\) return submitted/);
    assert.match(BEHAVIOR, /aria-pressed=\{filter === value\}/);
    assert.match(BEHAVIOR, /\{filteredTests\.length\} bài/);
  });

  test('runs its browser-backed flow unconditionally in the parity gate', () => {
    assert.match(BROWSER_FLOW, /const ROUTE = '\/listening\/mini-test'/);
    assert.match(BROWSER_FLOW, /attempt dang dở vẫn thuộc nhóm Chưa làm/);
    assert.match(BROWSER_FLOW, /không bịa mẫu số \/40/);
    assert.match(PARITY_WORKFLOW, /frontend\/tooling\/verify-listening-mini-test-flow\.mjs/);
    assert.match(PARITY_WORKFLOW, /run: node tooling\/verify-listening-mini-test-flow\.mjs/);
  });

  test('is no longer hard-navigation-only', () => {
    const list = HARD_NAV_GATE.match(/const LEGACY_MODULE_ROUTES = \[([\s\S]*?)\];/)?.[1] || '';
    assert.doesNotMatch(list, /['"]\/listening\/mini-test['"]/);
  });
});

/** Regression gate for `/listening/skills` native React behavior. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-listening)', 'listening', 'skills', 'page.tsx');
const SHELL = read('app', '(authed-listening)', 'listening', 'skills', 'page-shell.tsx');
const BEHAVIOR = read(
  'app', '(authed-listening)', 'listening', 'skills', 'listening-skills-behavior.tsx',
);
const HARD_NAV_GATE = read('tests', 'legacy-module-routes-need-hard-nav.test.mjs');

describe('/listening/skills — native React behavior', () => {
  test('removes legacy injection and delegates the dynamic surface to React', () => {
    assert.doesNotMatch(PAGE, /LegacyModule|listening-skills\.js|watchdogScript|HydratedSignal/);
    assert.doesNotMatch(PAGE, /<script|dangerouslySetInnerHTML|modulepreload/);
    assert.match(PAGE, /<ListeningSkillsBehavior\s*\/>/);
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

  test('pages only drills, aborts stale work and rejects silent truncation', () => {
    assert.match(BEHAVIOR, /test_type=drill&limit=\$\{PAGE_LIMIT\}&offset=\$\{offset\}/);
    assert.match(BEHAVIOR, /if \(pageItems\.length < PAGE_LIMIT\) return all/);
    assert.match(BEHAVIOR, /fetchAllDrills\(controller\.signal\)/);
    assert.match(BEHAVIOR, /\{ signal \}/);
    assert.match(BEHAVIOR, /controller\.abort\(\)/);
    assert.match(BEHAVIOR, /Danh sách vượt \$\{MAX_PAGES \* PAGE_LIMIT\} mục/);
  });

  test('keeps the exact 11-type catalogue and coming-soon groups', () => {
    for (const key of ['form', 'note', 'table', 'flowchart', 'sentence', 'summary',
      'short_answer', 'mcq', 'mcq_multi', 'matching', 'map']) {
      assert.match(BEHAVIOR, new RegExp(`key: '${key}'`));
    }
    assert.match(BEHAVIOR, /drill\.drillType === skill\.key/);
    assert.match(BEHAVIOR, /Sắp có/);
    assert.match(BEHAVIOR, /ls-group-count/);
    assert.match(BEHAVIOR, /\{' '\}<span className="ls-group-count">/,
      'badge count needs an explicit text separator for legacy heading parity');
  });

  test('preserves the L/T ladder, fallback title, stats and destinations', () => {
    assert.match(BEHAVIOR, /ladderNumber\(a\.level, 'L'\)/);
    assert.match(BEHAVIOR, /ladderNumber\(a\.task, 'T'\)/);
    assert.match(BEHAVIOR, /a\.testId\.localeCompare\(b\.testId\)/);
    assert.match(BEHAVIOR, /textValue\(raw\.title\) \|\| testId \|\| 'Skill drill'/);
    assert.match(BEHAVIOR, /Tốt nhất/);
    assert.match(BEHAVIOR, /attempted \? 'Làm lại' : 'Luyện'/);
    assert.match(BEHAVIOR, /listening-test\.html\?id=\$\{encodeURIComponent\(drill\.id\)\}/);
    assert.match(BEHAVIOR, /listening-test-dictation\.html\?test_id=\$\{encodeURIComponent\(drill\.id\)\}/);
  });

  test('uses static SVG icons and declarative escaped content', () => {
    assert.match(BEHAVIOR, /<svg[\s\S]*className=\{`lucide lucide-\$\{name\}`\}/);
    assert.doesNotMatch(BEHAVIOR, /data-lucide|createIcons|innerHTML|dangerouslySetInnerHTML|eval\(/);
  });

  test('keeps loading, empty, error and populated states distinct', () => {
    assert.match(BEHAVIOR, /state\.status === 'loading'/);
    assert.match(BEHAVIOR, /Chưa có bài luyện nào sẵn sàng\./);
    assert.match(BEHAVIOR, /Không tải được danh sách bài luyện:/);
    assert.match(BEHAVIOR, /<section id="ls-groups">/);
  });

  test('is no longer hard-navigation-only', () => {
    const list = HARD_NAV_GATE.match(/const LEGACY_MODULE_ROUTES = \[([\s\S]*?)\];/)?.[1] || '';
    assert.doesNotMatch(list, /['"]\/listening\/skills['"]/);
  });
});

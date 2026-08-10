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
const PARITY_WORKFLOW = read('..', '.github', 'workflows', 'parity-gate.yml');

describe('/listening/skills — native React behavior', () => {
  test('removes legacy injection and lets React own the complete dynamic surface', () => {
    assert.doesNotMatch(PAGE, /LegacyModule|listening-skills\.js|watchdogScript|HydratedSignal/);
    assert.doesNotMatch(PAGE, /<script|dangerouslySetInnerHTML|modulepreload/);
    assert.match(PAGE, /<ListeningSkillsBehavior\s*\/>/);
    assert.doesNotMatch(PAGE, /ListeningSkillsShell/);
    assert.match(BEHAVIOR, /<ListeningSkillsShell/);
    assert.match(SHELL, /\{children\}/);
  });

  test('uses shared auth, fails closed and keys requests by account', () => {
    assert.match(BEHAVIOR, /useAuth\(\)/);
    assert.match(BEHAVIOR, /status === 'signed-out'/);
    assert.match(BEHAVIOR, /window\.location\.replace\('\/login\.html'\)/);
    assert.match(BEHAVIOR, /status === 'signed-in' && user\?\.id \? user\.id : null/);
    assert.match(BEHAVIOR, /accountKey=\{accountKey\} key=\{accountKey \|\| status\}/);
    assert.match(BEHAVIOR, /if \(!accountKey\)/);
    assert.match(BEHAVIOR, /\[accountKey\]/);
  });

  test('pages only drills, aborts stale work and rejects silent truncation', () => {
    assert.match(BEHAVIOR, /test_type=drill&limit=\$\{PAGE_LIMIT\}&offset=\$\{offset\}/);
    assert.match(BEHAVIOR, /if \(pageItems\.length < PAGE_LIMIT\) return all/);
    assert.match(BEHAVIOR, /fetchAllDrills\(controller\.signal\)/);
    assert.match(BEHAVIOR, /\{ signal \}/);
    assert.match(BEHAVIOR, /if \(disposed\) return/);
    assert.match(BEHAVIOR, /controller\.abort\(\)/);
    assert.match(BEHAVIOR, /Danh sách vượt \$\{MAX_PAGES \* PAGE_LIMIT\} mục/);
  });

  test('keeps the exact 11-type catalogue and a disabled state for unavailable types', () => {
    for (const key of ['form', 'note', 'table', 'flowchart', 'sentence', 'summary',
      'short_answer', 'mcq', 'mcq_multi', 'matching', 'map']) {
      assert.match(BEHAVIOR, new RegExp(`key: '${key}'`));
    }
    assert.match(BEHAVIOR, /<nav className="ls-skill-nav"/);
    assert.match(BEHAVIOR, /disabled=\{!count\}/);
    assert.match(BEHAVIOR, /\{count \|\| '—'\}/);
    assert.match(BEHAVIOR, /onClick=\{\(\) => setActiveSkill\(skill\.key\)\}/);
  });

  test('preserves L/T sorting, title cleanup, scores and destinations', () => {
    assert.match(BEHAVIOR, /ladderNumber\(a\.level, 'L'\)/);
    assert.match(BEHAVIOR, /ladderNumber\(a\.task, 'T'\)/);
    assert.match(BEHAVIOR, /a\.testId\.localeCompare\(b\.testId\)/);
    assert.match(BEHAVIOR, /split\(\/\\s\+\[—·\]\\s\+\//);
    assert.match(BEHAVIOR, /Điểm tốt nhất <strong>\{drill\.bestScore\} điểm<\/strong>/);
    assert.match(BEHAVIOR, /admitCorePlayer\('listening_test', \{ id: drill\.id \}\)/);
    assert.match(BEHAVIOR, /admitCorePlayer\('listening_dictation', \{ test_id: drill\.id \}\)/);
  });

  test('uses submitted attempts for completion while retaining total activity', () => {
    assert.match(BEHAVIOR, /user_submitted_attempt_count/);
    assert.match(BEHAVIOR, /attemptCount: nonNegativeInteger\(raw\.user_attempt_count\)/);
    assert.match(BEHAVIOR, /submittedAttemptCount: nonNegativeInteger\(raw\.user_submitted_attempt_count\)/);
    assert.match(BEHAVIOR, /const attempted = drill\.submittedAttemptCount > 0/);
    assert.doesNotMatch(BEHAVIOR, /const attempted = drill\.attemptCount > 0/);
    assert.match(BEHAVIOR, /data-status=\{attempted \? 'done' : 'new'\}/);
    assert.match(BEHAVIOR, /\{attempted \? 'Làm lại' : 'Bắt đầu'\}/);
  });

  test('owns summary, initial skill choice, status filters and live counts in React', () => {
    assert.match(BEHAVIOR, /const firstIncomplete = SKILLS\.find/);
    assert.match(BEHAVIOR, /firstIncomplete \|\| firstAvailable \|\| SKILLS\[0\]/);
    assert.match(BEHAVIOR, /useState<'all' \| 'new' \| 'done'>\('all'\)/);
    assert.match(BEHAVIOR, /if \(filter === 'done'\) return submitted/);
    assert.match(BEHAVIOR, /aria-pressed=\{filter === value\}/);
    assert.match(BEHAVIOR, /\{selectedDrills\.length\}\/\{selectedTotal\} bài/);
    assert.match(SHELL, /\{totalCount\}/);
    assert.match(SHELL, /\{doneCount\}/);
    assert.match(SHELL, /\{typeCount\}/);
  });

  test('uses static SVG, React escaping and non-leaking accessible states', () => {
    assert.match(BEHAVIOR, /<svg[\s\S]*className=\{`lucide lucide-\$\{name\}`\}/);
    assert.doesNotMatch(BEHAVIOR, /data-lucide|createIcons|innerHTML|dangerouslySetInnerHTML|eval\(/);
    assert.match(BEHAVIOR, /id="state-loading" role="status"/);
    assert.match(BEHAVIOR, /id="state-empty" role="status"/);
    assert.match(BEHAVIOR, /id="state-error" role="alert"/);
    assert.match(BEHAVIOR, /Không tải được danh sách bài luyện\. Vui lòng thử lại\./);
    assert.doesNotMatch(BEHAVIOR, /caught instanceof Error[\s\S]*caught\.message|String\(caught\)/);
  });

  test('runs its browser-backed flow unconditionally in the parity gate', () => {
    assert.match(PARITY_WORKFLOW, /node tooling\/verify-listening-skills-flow\.mjs/);
  });

  test('is no longer hard-navigation-only', () => {
    const list = HARD_NAV_GATE.match(/const LEGACY_MODULE_ROUTES = \[([\s\S]*?)\];/)?.[1] || '';
    assert.doesNotMatch(list, /['"]\/listening\/skills['"]/);
  });
});

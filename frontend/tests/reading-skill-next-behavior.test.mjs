/** Regression gate for `/reading/skill` native React behavior. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-reading)', 'reading', 'skill', 'page.tsx');
const SHELL = read('app', '(authed-reading)', 'reading', 'skill', 'page-shell.tsx');
const BEHAVIOR = read(
  'app', '(authed-reading)', 'reading', 'skill', 'reading-skill-behavior.tsx',
);
const HARD_NAV_GATE = read('tests', 'legacy-module-routes-need-hard-nav.test.mjs');
const BROWSER_FLOW = read('tooling', 'verify-reading-skill-flow.mjs');
const PARITY_WORKFLOW = read('..', '.github', 'workflows', 'parity-gate.yml');
const LEGACY_BEHAVIOR = read('public', 'js', 'reading-skill.js');

describe('/reading/skill — native React behavior', () => {
  test('removes legacy module injection, hydration sentinel and watchdog', () => {
    assert.doesNotMatch(PAGE, /LegacyModule|reading-skill\.js|watchdogScript|HydratedSignal/);
    assert.doesNotMatch(PAGE, /<script|dangerouslySetInnerHTML|modulepreload/);
    assert.match(PAGE, /<ReadingSkillBehavior\s*\/>/);
    assert.match(SHELL, /\{children\}/);
  });

  test('uses shared auth, fails closed and keys requests by account', () => {
    assert.match(BEHAVIOR, /useAuth\(\)/);
    assert.match(BEHAVIOR, /status === 'signed-out'/);
    assert.match(BEHAVIOR, /window\.location\.replace\('\/login'\)/);
    assert.match(BEHAVIOR, /status === 'signed-in' && user\?\.id \? user\.id : null/);
    assert.match(BEHAVIOR, /accountKey=\{accountKey\} key=\{accountKey \|\| status\}/);
    assert.match(BEHAVIOR, /if \(!accountKey\)/);
    assert.match(BEHAVIOR, /\[accountKey, difficulty, skill, offset, retryToken\]/);
  });

  test('preserves the canonical filtered read with abort cleanup', () => {
    assert.match(BEHAVIOR, /query\.set\('difficulty', difficulty\)/);
    assert.match(BEHAVIOR, /query\.set\('skill', skill\)/);
    assert.match(BEHAVIOR, /query\.set\('limit', String\(PAGE_SIZE\)\)/);
    assert.match(BEHAVIOR, /query\.set\('offset', String\(offset\)\)/);
    assert.match(BEHAVIOR, /window\.api\.getWith<unknown>/);
    assert.match(BEHAVIOR, /`\/api\/reading\/skill\?\$\{query\.toString\(\)\}`/);
    assert.match(BEHAVIOR, /new AbortController\(\)/);
    assert.match(BEHAVIOR, /signal: controller\.signal/);
    assert.match(BEHAVIOR, /controller\.abort\(\)/);
    assert.match(LEGACY_BEHAVIOR, /const PAGE_SIZE = 24/);
    assert.match(LEGACY_BEHAVIOR, /qs\.set\('offset', String\(STATE\.offset\)\)/);
    assert.match(LEGACY_BEHAVIOR, /Xem thêm \(\$\{STATE\.items\.length\}\/\$\{STATE\.total\}\)/);
  });

  test('normalizes malformed payloads and renders authored data declaratively', () => {
    assert.match(BEHAVIOR, /if \(!Array\.isArray\(items\)\) return \[\]/);
    assert.match(BEHAVIOR, /if \(!slug\) return \[\]/);
    assert.match(BEHAVIOR, /SKILL_LABEL\[skill\] \|\| skill/);
    assert.match(BEHAVIOR, /normalizeTotal\(payload, offset \+ exercises\.length\)/);
    assert.match(BEHAVIOR, /new Set\(state\.exercises\.map/);
    assert.match(BEHAVIOR, /displaySkillTitle\(fullTitle\)/);
    assert.match(BEHAVIOR, /encodeURIComponent\(exercise\.slug\)/);
    assert.doesNotMatch(BEHAVIOR, /innerHTML|dangerouslySetInnerHTML|__html|eval\(/);
  });

  test('keeps all four states and the full skill enum', () => {
    assert.match(BEHAVIOR, /state\.status === 'loading'/);
    assert.match(BEHAVIOR, /Chưa có bài luyện kỹ năng nào khớp bộ lọc/);
    assert.match(BEHAVIOR, /Không tải được thư viện\./);
    assert.match(BEHAVIOR, /state\.status === 'ready' && state\.exercises\.length/);
    for (const skill of [
      'skimming', 'scanning', 'detail', 'main_idea', 'inference',
      'vocabulary_in_context', 'reference_cohesion', 'writer_view_TFNG',
    ]) assert.match(BEHAVIOR, new RegExp(`${skill}:|value="${skill}"`));
  });

  test('preserves pill order and the skill exercise destination', () => {
    assert.match(BEHAVIOR, /exercise\.skillLabel[\s\S]*\{difficulty \?[\s\S]*exercise\.topic/);
    assert.match(BEHAVIOR, /exercise\.estimatedMinutes[\s\S]*PHÚT/);
    assert.match(BEHAVIOR, /\/reading\/skill\/\$\{encodeURIComponent\(exercise\.slug\)\}/);
    assert.doesNotMatch(BEHAVIOR, /\/pages\/reading-skill-exercise\.html\?slug=/);
    assert.match(BEHAVIOR, /className="rv-card__top"/);
    assert.match(BEHAVIOR, /className="rv-card__footer"/);
    assert.match(BEHAVIOR, /className="rv-card__cta"/);
    assert.match(BEHAVIOR, /title=\{exercise\.fullTitle\}/);
  });

  test('keeps truthful live totals and resets both filters', () => {
    assert.match(SHELL, /focusCount = '—'/);
    assert.match(SHELL, /totalCount = '—'/);
    assert.match(BEHAVIOR, /total > shown[\s\S]*đang hiển thị/);
    assert.match(BEHAVIOR, /Xem thêm \(\$\{shown\}\/\$\{total\}\)/);
    assert.match(BEHAVIOR, /setOffset\(\(current\) => current \+ PAGE_SIZE\)/);
    assert.match(BEHAVIOR, /Chưa tải được trang tiếp theo/);
    assert.match(BEHAVIOR, /setDifficulty\(''\)[\s\S]*setSkill\(''\)/);
    assert.match(BEHAVIOR, /hidden=\{!hasFilters\}/);
    assert.doesNotMatch(BEHAVIOR, /caught instanceof Error \? caught\.message/);
  });

  test('runs its browser-backed flow unconditionally in the parity gate', () => {
    assert.match(BROWSER_FLOW, /const ROUTE = '\/reading\/skill'/);
    assert.match(BROWSER_FLOW, /response filter cũ không ghi đè response mới/);
    assert.match(BROWSER_FLOW, /Xóa lọc reset cả hai select/);
    assert.match(PARITY_WORKFLOW, /frontend\/tooling\/verify-reading-skill-flow\.mjs/);
    assert.match(PARITY_WORKFLOW, /run: node tooling\/verify-reading-skill-flow\.mjs/);
  });

  test('is no longer hard-navigation-only', () => {
    const list = HARD_NAV_GATE.match(/const LEGACY_MODULE_ROUTES = \[([\s\S]*?)\];/)?.[1] || '';
    assert.doesNotMatch(list, /['"]\/reading\/skill['"]/);
  });
});

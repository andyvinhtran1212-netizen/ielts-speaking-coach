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
    assert.match(BEHAVIOR, /window\.location\.replace\('\/login\.html'\)/);
    assert.match(BEHAVIOR, /status !== 'signed-in' \|\| !user\?\.id/);
    assert.match(BEHAVIOR, /accountKey=\{user\.id\} key=\{user\.id\}/);
    assert.match(BEHAVIOR, /\[accountKey, difficulty, skill\]/);
  });

  test('preserves the canonical filtered read with abort cleanup', () => {
    assert.match(BEHAVIOR, /query\.set\('difficulty', difficulty\)/);
    assert.match(BEHAVIOR, /query\.set\('skill', skill\)/);
    assert.match(BEHAVIOR, /query\.set\('limit', '50'\)/);
    assert.match(BEHAVIOR, /window\.api\.getWith<unknown>/);
    assert.match(BEHAVIOR, /`\/api\/reading\/skill\?\$\{query\.toString\(\)\}`/);
    assert.match(BEHAVIOR, /new AbortController\(\)/);
    assert.match(BEHAVIOR, /signal: controller\.signal/);
    assert.match(BEHAVIOR, /controller\.abort\(\)/);
  });

  test('normalizes malformed payloads and renders authored data declaratively', () => {
    assert.match(BEHAVIOR, /if \(!Array\.isArray\(items\)\) return \[\]/);
    assert.match(BEHAVIOR, /if \(!slug\) return \[\]/);
    assert.match(BEHAVIOR, /SKILL_LABEL\[skill\] \|\| skill/);
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
    assert.match(BEHAVIOR, /exercise\.skillLabel[\s\S]*exercise\.difficulty[\s\S]*exercise\.topic[\s\S]*exercise\.estimatedMinutes/);
    assert.match(BEHAVIOR, /\/pages\/reading-skill-exercise\.html\?slug=/);
  });

  test('is no longer hard-navigation-only', () => {
    const list = HARD_NAV_GATE.match(/const LEGACY_MODULE_ROUTES = \[([\s\S]*?)\];/)?.[1] || '';
    assert.doesNotMatch(list, /['"]\/reading\/skill['"]/);
  });
});

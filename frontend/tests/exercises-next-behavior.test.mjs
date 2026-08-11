/** Regression gate for `/exercises` lifecycle-safe Next orchestration. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-exercises)', 'exercises', 'page.tsx');
const BEHAVIOR = read(
  'app', '(authed-exercises)', 'exercises', 'exercises-behavior.tsx',
);
const ADAPTER = read('components', 'vocab-module-mount.tsx');
const MODULE = read('public', 'js', 'vocab-modules', 'exercises.js');
const HARD_NAV_GATE = read('tests', 'legacy-module-routes-need-hard-nav.test.mjs');

describe('/exercises — lifecycle-safe Next orchestration', () => {
  test('removes inline module injection, hydration sentinel and watchdog', () => {
    assert.doesNotMatch(PAGE, /const MOUNT|dangerouslySetInnerHTML|watchdogScript|HydratedSignal/);
    assert.match(PAGE, /<ExercisesBehavior\s*\/>/);
  });

  test('uses shared auth, fails closed and keys the mount by account', () => {
    assert.match(BEHAVIOR, /useAuth\(\)/);
    assert.match(BEHAVIOR, /status === 'signed-out'/);
    assert.match(BEHAVIOR, /window\.location\.replace\('\/login\.html'\)/);
    assert.match(BEHAVIOR, /accountKey=\{user\.id\}/);
    assert.match(BEHAVIOR, /moduleName="exercises"/);
    assert.match(BEHAVIOR, /embedded=\{false\}/);
  });

  test('shared adapter waits for dependencies and cleans up the mounted handle', () => {
    assert.match(ADAPTER, /whenGlobalReady\(/);
    assert.match(ADAPTER, /window\.api\?\.base/);
    assert.match(ADAPTER, /window\.getSupabase/);
    assert.match(ADAPTER, /vocabModule\.mount\(container, \{ embedded \}\)/);
    assert.match(ADAPTER, /handle\?\.unmount\?\.\(\)/);
    assert.match(ADAPTER, /\[accountKey, embedded, moduleName\]/);
  });

  test('module aborts stale work and removes its delegated listener', () => {
    assert.match(MODULE, /const requests = new AbortController\(\)/);
    assert.match(MODULE, /signal:\s*requests\.signal/);
    assert.match(MODULE, /if \(disposed\) return;/);
    assert.match(MODULE, /err\?\.name === 'AbortError'/);
    assert.match(MODULE, /function handleClick\(e\)/);
    assert.match(MODULE, /removeEventListener\('click', handleClick\)/);
    assert.match(MODULE, /disposed = true;\s*requests\.abort\(\)/);
  });

  test('is no longer hard-navigation-only', () => {
    const list = HARD_NAV_GATE.match(/const LEGACY_MODULE_ROUTES = \[([\s\S]*?)\];/)?.[1] || '';
    assert.doesNotMatch(list, /['"]\/exercises['"]/);
  });
});

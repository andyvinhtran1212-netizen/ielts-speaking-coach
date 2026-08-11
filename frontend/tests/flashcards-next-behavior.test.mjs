/** Regression gate for `/flashcards` lifecycle-safe Next orchestration. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-flashcards)', 'flashcards', 'page.tsx');
const BEHAVIOR = read(
  'app', '(authed-flashcards)', 'flashcards', 'flashcards-behavior.tsx',
);
const ADAPTER = read('components', 'vocab-module-mount.tsx');
const MODULE = read('public', 'js', 'vocab-modules', 'flashcards.js');
const HARD_NAV_GATE = read('tests', 'legacy-module-routes-need-hard-nav.test.mjs');

describe('/flashcards — lifecycle-safe Next orchestration', () => {
  test('removes inline module injection, hydration sentinel and watchdog', () => {
    assert.doesNotMatch(PAGE, /const MOUNT|dangerouslySetInnerHTML|watchdogScript|HydratedSignal/);
    assert.match(PAGE, /<FlashcardsBehavior\s*\/>/);
  });

  test('uses shared auth, fails closed and keys the mount by account', () => {
    assert.match(BEHAVIOR, /useAuth\(\)/);
    assert.match(BEHAVIOR, /status === 'signed-out'/);
    assert.match(BEHAVIOR, /window\.location\.replace\('\/login\.html'\)/);
    assert.match(BEHAVIOR, /accountKey=\{user\.id\}/);
    assert.match(BEHAVIOR, /moduleName="flashcards"/);
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

  test('module aborts in-flight work and suppresses stale post-unmount mutations', () => {
    assert.match(MODULE, /const requests = new AbortController\(\)/);
    assert.match(MODULE, /signal: requests\.signal/);
    assert.match(MODULE, /disposed = true;\s*requests\.abort\(\)/);
    assert.match(MODULE, /if \(disposed\) return;/);
    assert.match(MODULE, /err\?\.name === 'AbortError'/);
  });

  test('is no longer hard-navigation-only', () => {
    const list = HARD_NAV_GATE.match(/const LEGACY_MODULE_ROUTES = \[([\s\S]*?)\];/)?.[1] || '';
    assert.doesNotMatch(list, /['"]\/flashcards['"]/);
  });
});

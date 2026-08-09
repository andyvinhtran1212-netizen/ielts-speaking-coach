/** Regression gate for `/reading/vocab` native React behavior. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-reading)', 'reading', 'vocab', 'page.tsx');
const SHELL = read('app', '(authed-reading)', 'reading', 'vocab', 'page-shell.tsx');
const BEHAVIOR = read(
  'app', '(authed-reading)', 'reading', 'vocab', 'reading-vocab-behavior.tsx',
);
const HARD_NAV_GATE = read('tests', 'legacy-module-routes-need-hard-nav.test.mjs');

describe('/reading/vocab — native React behavior', () => {
  test('removes legacy module injection, hydration sentinel and watchdog', () => {
    assert.doesNotMatch(PAGE, /LegacyModule|reading-vocab\.js|watchdogScript|HydratedSignal/);
    assert.doesNotMatch(PAGE, /<script|dangerouslySetInnerHTML|modulepreload/);
    assert.match(PAGE, /<ReadingVocabBehavior\s*\/>/);
    assert.match(SHELL, /\{children\}/);
  });

  test('uses shared auth, fails closed and keys requests by account', () => {
    assert.match(BEHAVIOR, /useAuth\(\)/);
    assert.match(BEHAVIOR, /status === 'signed-out'/);
    assert.match(BEHAVIOR, /window\.location\.replace\('\/login\.html'\)/);
    assert.match(BEHAVIOR, /status !== 'signed-in' \|\| !user\?\.id/);
    assert.match(BEHAVIOR, /accountKey=\{user\.id\} key=\{user\.id\}/);
    assert.match(BEHAVIOR, /\[accountKey, difficulty, tag\]/);
  });

  test('preserves the canonical filtered read with abort cleanup', () => {
    assert.match(BEHAVIOR, /query\.set\('difficulty', difficulty\)/);
    assert.match(BEHAVIOR, /query\.set\('tag', tag\)/);
    assert.match(BEHAVIOR, /query\.set\('limit', '50'\)/);
    assert.match(BEHAVIOR, /window\.api\.getWith<unknown>/);
    assert.match(BEHAVIOR, /`\/api\/reading\/vocab\?\$\{query\.toString\(\)\}`/);
    assert.match(BEHAVIOR, /new AbortController\(\)/);
    assert.match(BEHAVIOR, /signal: controller\.signal/);
    assert.match(BEHAVIOR, /controller\.abort\(\)/);
  });

  test('normalizes malformed payloads and renders authored data declaratively', () => {
    assert.match(BEHAVIOR, /if \(!Array\.isArray\(items\)\) return \[\]/);
    assert.match(BEHAVIOR, /if \(!slug\) return \[\]/);
    assert.match(BEHAVIOR, /new Set\(raw\.topic_tags\.map\(textValue\)\.filter\(Boolean\)\)/);
    assert.match(BEHAVIOR, /encodeURIComponent\(passage\.slug\)/);
    assert.doesNotMatch(BEHAVIOR, /innerHTML|dangerouslySetInnerHTML|__html|eval\(/);
  });

  test('keeps loading, empty, error and populated states distinct', () => {
    assert.match(BEHAVIOR, /state\.status === 'loading'/);
    assert.match(BEHAVIOR, /Chưa có bài đọc nào khớp bộ lọc/);
    assert.match(BEHAVIOR, /Không tải được thư viện\./);
    assert.match(BEHAVIOR, /state\.status === 'ready' && state\.passages\.length/);
  });

  test('preserves filters, first-load tag seeding and passage destinations', () => {
    assert.match(BEHAVIOR, /setAvailableTags\(\(current\) =>/);
    assert.match(BEHAVIOR, /if \(current\.length\) return current/);
    assert.match(BEHAVIOR, /id="filter-difficulty"/);
    assert.match(BEHAVIOR, /id="filter-tag"/);
    assert.match(BEHAVIOR, /\/pages\/reading-vocab-passage\.html\?slug=/);
  });

  test('is no longer hard-navigation-only', () => {
    const list = HARD_NAV_GATE.match(/const LEGACY_MODULE_ROUTES = \[([\s\S]*?)\];/)?.[1] || '';
    assert.doesNotMatch(list, /['"]\/reading\/vocab['"]/);
  });
});

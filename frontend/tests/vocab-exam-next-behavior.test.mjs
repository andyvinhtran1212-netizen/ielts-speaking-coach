/** Regression gate for `/vocabulary/exam` native React behavior. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-vocab-exam)', 'vocabulary', 'exam', 'page.tsx');
const SHELL = read('app', '(authed-vocab-exam)', 'vocabulary', 'exam', 'page-shell.tsx');
const BEHAVIOR = read(
  'app', '(authed-vocab-exam)', 'vocabulary', 'exam', 'vocab-exam-behavior.tsx',
);
const HARD_NAV_GATE = read('tests', 'legacy-module-routes-need-hard-nav.test.mjs');

describe('/vocabulary/exam — native React behavior', () => {
  test('does not inject the legacy controller or watchdog', () => {
    assert.doesNotMatch(PAGE, /vocab-exam\.js|watchdogScript|dangerouslySetInnerHTML/);
    assert.doesNotMatch(SHELL, /<script|dangerouslySetInnerHTML/);
    assert.doesNotMatch(BEHAVIOR, /vocab-exam\.js|<script|dangerouslySetInnerHTML/);
  });

  test('is no longer hard-navigation-only', () => {
    const list = HARD_NAV_GATE.match(/const LEGACY_MODULE_ROUTES = \[([\s\S]*?)\];/)?.[1] || '';
    assert.doesNotMatch(list, /['"]\/vocabulary\/exam['"]/);
  });

  test('uses the canonical public endpoint with abort cleanup', () => {
    assert.match(BEHAVIOR, /window\.api\.getWith<unknown>/);
    assert.match(BEHAVIOR, /'\/api\/vocabulary\/exam'/);
    assert.match(BEHAVIOR, /new AbortController\(\)/);
    assert.match(BEHAVIOR, /controller\.abort\(\)/);
    assert.doesNotMatch(BEHAVIOR, /useAuth|authorization|access_token/i);
  });

  test('normalizes malformed data and removes empty lists/families', () => {
    assert.match(BEHAVIOR, /if \(!Array\.isArray\(payload\)\) return \[\]/);
    assert.match(BEHAVIOR, /if \(!slug \|\| count <= 0\) return \[\]/);
    assert.match(BEHAVIOR, /if \(!lists\.length\) return \[\]/);
    assert.match(BEHAVIOR, /FAMILY_ICON\[family\] \|\| '📚'/);
  });

  test('renders metadata declaratively and URL-encodes stack slugs', () => {
    assert.match(BEHAVIOR, /encodeURIComponent\(list\.slug\)/);
    assert.match(BEHAVIOR, /list\.title/);
    assert.match(BEHAVIOR, /list\.description/);
    assert.doesNotMatch(BEHAVIOR, /\.innerHTML\s*=|__html|eval\(/);
  });

  test('keeps loading, empty and transport error states distinct', () => {
    assert.match(BEHAVIOR, /status: 'loading'/);
    assert.match(BEHAVIOR, /Đang tải…/);
    assert.match(BEHAVIOR, /Chưa có danh sách luyện thi nào/);
    assert.match(BEHAVIOR, /Không tải được danh sách luyện thi/);
  });

  test('keeps the canonical hub return and shared flashcard player', () => {
    assert.match(SHELL, /href="\/vocabulary\/hub"/);
    assert.match(BEHAVIOR, /\/pages\/flashcard-study\.html\?stack=examlist:/);
  });
});

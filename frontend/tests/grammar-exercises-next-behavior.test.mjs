/** Regression gate for `/grammar/exercises` native React behavior. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(public-content)', 'grammar', 'exercises', 'page.tsx');
const BEHAVIOR = read(
  'app', '(public-content)', 'grammar', 'exercises', 'grammar-exercises-behavior.tsx',
);
const LEGACY_PAGE = read('public', 'pages', 'grammar-exercises.html');
const LEGACY_BEHAVIOR = read('public', 'js', 'grammar-exercises.js');
const HARD_NAV_GATE = read('tests', 'legacy-module-routes-need-hard-nav.test.mjs');

describe('/grammar/exercises — native React behavior', () => {
  test('does not inject the legacy module or watchdog', () => {
    assert.doesNotMatch(PAGE, /watchdogScript|<script|dangerouslySetInnerHTML/);
    assert.doesNotMatch(BEHAVIOR, /grammar-exercises\.js|<script|dangerouslySetInnerHTML/);
  });

  test('is no longer hard-navigation-only', () => {
    const list = HARD_NAV_GATE.match(/const LEGACY_MODULE_ROUTES = \[([\s\S]*?)\];/)?.[1] || '';
    assert.doesNotMatch(list, /['"]\/grammar\/exercises['"]/);
  });

  test('uses an abortable canonical public read', () => {
    assert.match(BEHAVIOR, /whenGlobalReady/);
    assert.match(BEHAVIOR, /new AbortController\(\)/);
    assert.match(BEHAVIOR, /controller\.abort\(\)/);
    assert.match(BEHAVIOR, /window\.api\.getWith<GrammarExercisesPayload>/);
    assert.match(BEHAVIOR, /'\/api\/grammar\/exercises'/);
  });

  test('uses backend-enriched canonical categories and renders without raw HTML', () => {
    assert.match(BEHAVIOR, /bank\.category/);
    assert.match(BEHAVIOR, /bank\.level/);
    assert.doesNotMatch(BEHAVIOR, /function categoryOf|const CATEGORIES/,
      'client must not re-derive category truth from ambiguous bank codes');
    assert.match(BEHAVIOR, /encodeURIComponent\(bank\.id\)/);
    assert.doesNotMatch(BEHAVIOR, /\.innerHTML\s*=|__html/);
  });

  test('keeps loading, empty and error states distinct', () => {
    assert.match(BEHAVIOR, /Đang tải bài tập…/);
    assert.match(BEHAVIOR, /Chưa có bài tập nào được mở/);
    assert.match(BEHAVIOR, /Không tải được bài tập/);
  });
});

describe('/grammar/exercises — canonical entry points', () => {
  test('both Grammar landing variants target the canonical route', () => {
    const nextLanding = read('app', '(public-content)', 'grammar', 'page.tsx');
    const legacyLanding = read('public', 'grammar.html');
    for (const source of [nextLanding, legacyLanding]) {
      assert.match(source, /href=["']\/grammar\/exercises["']/);
      assert.doesNotMatch(source, /pages\/grammar-exercises\.html/);
    }
  });

  test('rollback leg mirrors the enriched directory instead of the retired grouped list', () => {
    for (const source of [PAGE, LEGACY_PAGE]) {
      assert.match(source, /Chọn đúng bài cần luyện/);
      assert.match(source, /Tìm theo chủ đề và trình độ/);
    }
    assert.match(LEGACY_PAGE, /id="ex-query"/);
    assert.match(LEGACY_PAGE, /id="ex-category"/);
    assert.match(LEGACY_PAGE, /id="ex-level"/);
    assert.match(LEGACY_PAGE, /supabase\.min\.js/);
    assert.match(LEGACY_PAGE, /initSupabase\(SUPABASE_URL, SUPABASE_ANON\)/);
    assert.match(LEGACY_BEHAVIOR, /bank\.category/);
    assert.match(LEGACY_BEHAVIOR, /bank\.level/);
    assert.match(LEGACY_BEHAVIOR, /href="\/quiz\?bank=/);
    assert.doesNotMatch(LEGACY_BEHAVIOR, /categoryOf|\/pages\/quiz\.html/);
  });
});

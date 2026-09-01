/** Regression gate for `/full-test` native React launcher behavior. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-full-test)', 'full-test', 'page.tsx');
const BEHAVIOR = read('app', '(authed-full-test)', 'full-test', 'full-test-behavior.tsx');
const HARD_NAV_GATE = read('tests', 'legacy-module-routes-need-hard-nav.test.mjs');

describe('/full-test — native React behavior', () => {
  test('does not inject the legacy module or watchdog', () => {
    assert.doesNotMatch(PAGE, /watchdogScript|<script|dangerouslySetInnerHTML/);
    assert.doesNotMatch(BEHAVIOR, /full-test\.js|<script|dangerouslySetInnerHTML/);
  });

  test('is no longer hard-navigation-only', () => {
    const list = HARD_NAV_GATE.match(/const LEGACY_MODULE_ROUTES = \[([\s\S]*?)\];/)?.[1] || '';
    assert.doesNotMatch(list, /['"]\/full-test['"]/);
  });

  test('uses shared auth, keyed state and the canonical abortable read', () => {
    assert.match(BEHAVIOR, /useAuth\(\)/);
    assert.match(BEHAVIOR, /status === 'signed-out'/);
    assert.match(BEHAVIOR, /examState\?\.key === requestKey/);
    assert.match(BEHAVIOR, /new AbortController\(\)/);
    assert.match(BEHAVIOR, /controller\.abort\(\)/);
    assert.match(BEHAVIOR, /window\.api\.getWith<MockExamListPayload>/);
    assert.match(BEHAVIOR, /'\/api\/mock-exams'/);
  });

  test('preserves start, resume, conflict and retake actions without raw HTML', () => {
    assert.match(BEHAVIOR, /blocked_by_sitting_id/);
    assert.match(BEHAVIOR, /my_sitting_id/);
    assert.match(BEHAVIOR, /exam_mode === 'retake'/);
    assert.match(BEHAVIOR, /encodeURIComponent\(exam\.code\)/);
    assert.match(BEHAVIOR, /exam\.review_sla_days \|\| 3/);
    assert.doesNotMatch(BEHAVIOR, /\.innerHTML\s*=|__html/);
  });

  test('keeps loading, empty and error states distinct', () => {
    assert.match(BEHAVIOR, /Đang chuẩn bị danh sách kỳ thi/);
    assert.match(BEHAVIOR, /Hiện chưa có kỳ thi nào được mở/);
    assert.match(BEHAVIOR, /Không tải được danh sách kỳ thi\. Vui lòng thử lại\./);
    assert.match(BEHAVIOR, /setReloadVersion\(\(value\) => value \+ 1\)/);
    assert.doesNotMatch(BEHAVIOR, /caught instanceof Error[\s\S]*caught\.message|messageOf\(|String\(caught\)/);
    assert.match(BEHAVIOR, /const ordered = \[\.\.\.exams\]\.sort/);
  });
});

describe('/full-test — canonical entry points', () => {
  test('both Home variants target the canonical route', () => {
    const nextHome = read('app', '(authed-home)', 'home', 'page-shell.tsx');
    const legacyHome = read('public', 'pages', 'home.html');
    for (const source of [nextHome, legacyHome]) {
      assert.match(source, /href=["']\/full-test["']/);
      assert.doesNotMatch(source, /\/pages\/full-test\.html/);
    }
  });
});

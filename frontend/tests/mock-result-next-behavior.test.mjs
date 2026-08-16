/** Regression gate for the `/mock/result` native React TRF behavior. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-mock-result)', 'mock', 'result', 'page.tsx');
const BEHAVIOR = read(
  'app', '(authed-mock-result)', 'mock', 'result', 'mock-result-behavior.tsx',
);
const HARD_NAV_GATE = read('tests', 'legacy-module-routes-need-hard-nav.test.mjs');

describe('/mock/result — native React behavior', () => {
  test('does not inject the legacy module or watchdog', () => {
    assert.doesNotMatch(PAGE, /watchdogScript|HydratedSignal|<script|dangerouslySetInnerHTML/);
    assert.doesNotMatch(BEHAVIOR, /mock-result\.js|<script|dangerouslySetInnerHTML/);
  });

  test('is no longer classified as hard-navigation-only', () => {
    const list = HARD_NAV_GATE.match(/const LEGACY_MODULE_ROUTES = \[([\s\S]*?)\];/)?.[1] || '';
    assert.doesNotMatch(list, /['"]\/mock\/result['"]/);
  });

  test('keys the canonical authenticated read by user + sitting and aborts stale work', () => {
    assert.match(BEHAVIOR, /useAuth\(\)/);
    assert.match(BEHAVIOR, /useSearchParams\(\)/);
    assert.match(BEHAVIOR, /`\$\{user\.id\}:\$\{sittingId\}`/);
    assert.match(BEHAVIOR, /resultState\?\.key === requestKey/);
    assert.match(BEHAVIOR, /new AbortController\(\)/);
    assert.match(BEHAVIOR, /controller\.abort\(\)/);
    assert.match(BEHAVIOR, /window\.api\.getWith<MockResultPayload>/);
    assert.match(BEHAVIOR, /`\/api\/mock-exams\/sittings\/\$\{encodeURIComponent\(sittingId\)\}\/result`/);
  });

  test('preserves missing-param, sealed/pending, loading and error states', () => {
    assert.match(BEHAVIOR, /Thiếu mã sitting\./);
    assert.match(BEHAVIOR, /statusOf\(caught\) === 403/);
    assert.match(BEHAVIOR, /Đang chờ giám khảo duyệt/);
    assert.match(BEHAVIOR, /Đang tải kết quả…/);
    assert.match(BEHAVIOR, /Không tải được kết quả:/);
  });

  test('preserves partial-retake bands and all truthful gap/retest branches', () => {
    assert.match(BEHAVIOR, /const scored = SKILLS\.filter/);
    assert.match(BEHAVIOR, /scored\.length \? scored : SKILLS/);
    assert.match(BEHAVIOR, /Giám khảo yêu cầu thi lại:/);
    assert.match(BEHAVIOR, /Không nhận được bài làm/);
    assert.match(BEHAVIOR, /Không có đáp án/);
    assert.match(BEHAVIOR, /dưới mức thấp nhất của bảng quy đổi band IELTS/);
    assert.match(BEHAVIOR, /Bài không đạt yêu cầu/);
    assert.match(BEHAVIOR, /Không có bài nộp/);
    assert.match(BEHAVIOR, /Chưa có nhận xét/);
  });

  test('keeps per-skill review actions and the mock-origin return contract', () => {
    assert.match(BEHAVIOR, /&from=mock&sitting=\$\{encodeURIComponent\(sittingId\)\}/);
    assert.match(BEHAVIOR, /\/pages\/listening-review\.html\?attempt_id=/);
    assert.match(BEHAVIOR, /\/reading\/review\?attempt_id=/);
    assert.match(BEHAVIOR, /\/pages\/writing-result\.html\?id=/);
    assert.match(BEHAVIOR, /\/speaking\/result\?sitting=/);
    assert.match(BEHAVIOR, /rel="noopener"/);
  });

  test('renders authored content declaratively and exposes overall to assistive tech', () => {
    assert.doesNotMatch(BEHAVIOR, /\.innerHTML\s*=|insertAdjacentHTML|__html/);
    assert.match(BEHAVIOR, /\{data\.examiner_comment_vi\}/);
    assert.match(BEHAVIOR, /\{textOf\(notes\[key\]\)\}/);
    assert.match(BEHAVIOR, /aria-label=\{`Overall \$\{fmtBand\(overall\)\}`\}/);
  });
});

describe('/mock/result — canonical entry points', () => {
  test('Home, runner and review callers target the canonical route', () => {
    const callers = [
      read('app', '(authed-home)', 'home', 'home-behavior.tsx'),
      read('public', 'js', 'home-mock-tiles.js'),
      read('public', 'js', 'mock-exam-runner.js'),
      read('public', 'js', 'reading-review.js'),
      read('public', 'js', 'listening-review.js'),
      read('public', 'js', 'speaking-result.js'),
    ];
    for (const source of callers) {
      assert.match(source, /\/mock\/result/);
      assert.doesNotMatch(source, /\/pages\/mock-result\.html/);
    }
  });
});

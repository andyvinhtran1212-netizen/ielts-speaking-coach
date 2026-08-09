/** Regression gate for `/vocabulary/practice` native React behavior. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-vocab-practice)', 'vocabulary', 'practice', 'page.tsx');
const BEHAVIOR = read(
  'app', '(authed-vocab-practice)', 'vocabulary', 'practice', 'vocab-practice-behavior.tsx',
);
const HARD_NAV_GATE = read('tests', 'legacy-module-routes-need-hard-nav.test.mjs');

describe('/vocabulary/practice — native React behavior', () => {
  test('does not inject the legacy module or watchdog', () => {
    assert.doesNotMatch(PAGE, /watchdogScript|<script|dangerouslySetInnerHTML/);
    assert.doesNotMatch(BEHAVIOR, /vocab-practice\.js|<script|dangerouslySetInnerHTML/);
  });

  test('is no longer hard-navigation-only', () => {
    const list = HARD_NAV_GATE.match(/const LEGACY_MODULE_ROUTES = \[([\s\S]*?)\];/)?.[1] || '';
    assert.doesNotMatch(list, /['"]\/vocabulary\/practice['"]/);
  });

  test('uses shared auth, keyed state and an abortable canonical request', () => {
    assert.match(BEHAVIOR, /useAuth\(\)/);
    assert.match(BEHAVIOR, /status === 'signed-out'/);
    assert.match(BEHAVIOR, /banksState\?\.key === requestKey/);
    assert.match(BEHAVIOR, /new AbortController\(\)/);
    assert.match(BEHAVIOR, /controller\.abort\(\)/);
    assert.match(BEHAVIOR, /window\.api\.getWith<VocabBank\[\]>/);
    assert.match(BEHAVIOR, /'\/api\/quiz\/banks\?skill_area=vocab'/);
  });

  test('renders authored bank metadata declaratively and URL-encodes ids', () => {
    assert.match(BEHAVIOR, /bank\.title \|\| bank\.code \|\| 'Bài luyện'/);
    assert.match(BEHAVIOR, /encodeURIComponent\(bank\.id\)/);
    assert.doesNotMatch(BEHAVIOR, /\.innerHTML\s*=|__html/);
  });

  test('keeps loading, empty, error and progress states distinct', () => {
    assert.match(BEHAVIOR, /Đang tải…/);
    assert.match(BEHAVIOR, /Chưa có bài luyện nào được mở/);
    assert.match(BEHAVIOR, /Không tải được danh sách bài luyện:/);
    assert.match(BEHAVIOR, /href="\/quiz\/progress\?skill_area=vocab"/);
  });
});

describe('/vocabulary/practice — canonical navigation', () => {
  test('hub, player and progress return to the canonical picker route', () => {
    const legacyHub = read('public', 'pages', 'vocabulary.html');
    const legacyPractice = read('public', 'pages', 'vocab-practice.html');
    const nextHub = read('app', '(authed-vocabulary-hub)', 'vocabulary', 'hub', 'page.tsx');
    const nextHubBehavior = read(
      'app', '(authed-vocabulary-hub)', 'vocabulary', 'hub', 'vocabulary-hub-behavior.tsx',
    );
    const quiz = read('public', 'pages', 'quiz.html');
    const legacyProgress = read('public', 'pages', 'quiz-progress.html');
    const nextProgress = read(
      'app', '(authed-quiz-progress)', 'quiz', 'progress', 'quiz-progress-behavior.tsx',
    );

    for (const source of [legacyHub, quiz, legacyProgress, nextProgress]) {
      assert.match(source, /\/vocabulary\/practice/);
      assert.doesNotMatch(source, /\/pages\/vocab-practice\.html/);
    }
    assert.match(nextHubBehavior, /href="\/vocabulary\/practice"/);
    assert.doesNotMatch(nextHub, /BODY\.replace|dangerouslySetInnerHTML/);
    assert.match(legacyPractice, /href="\/vocabulary\/hub"/);
    assert.doesNotMatch(legacyPractice, /href="\/pages\/vocabulary\.html"/);
    assert.match(PAGE, /href="\/vocabulary\/hub"/);
  });
});

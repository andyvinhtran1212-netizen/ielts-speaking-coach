/**
 * Regression gate for the first legacy-module debt removal batch.
 *
 * `/quiz/progress` used to be a Next shell that injected the legacy module.
 * That module only booted on hard load, so App Router soft navigation left the
 * screen stuck at "Đang tải…". The route now owns its behavior in React.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-quiz-progress)', 'quiz', 'progress', 'page.tsx');
const BEHAVIOR = read(
  'app', '(authed-quiz-progress)', 'quiz', 'progress', 'quiz-progress-behavior.tsx',
);
const HARD_NAV_GATE = read('tests', 'legacy-module-routes-need-hard-nav.test.mjs');

describe('/quiz/progress — native React behavior', () => {
  test('does not inject the legacy module or watchdog', () => {
    assert.doesNotMatch(PAGE, /import\s+.*watchdogScript|<script|dangerouslySetInnerHTML/);
    assert.doesNotMatch(BEHAVIOR, /import\s*\([^)]*quiz-progress\.js|<script|dangerouslySetInnerHTML/);
  });

  test('is no longer classified as a hard-navigation-only target', () => {
    const list = HARD_NAV_GATE.match(/const LEGACY_MODULE_ROUTES = \[([\s\S]*?)\];/)?.[1] || '';
    assert.doesNotMatch(list, /['"]\/quiz\/progress['"]/);
  });

  test('uses the shared auth state and aborts requests on route/account changes', () => {
    assert.match(BEHAVIOR, /useAuth\(\)/);
    assert.match(BEHAVIOR, /status === 'signed-out'/);
    assert.match(BEHAVIOR, /new AbortController\(\)/);
    assert.match(BEHAVIOR, /controller\.abort\(\)/);
    assert.match(BEHAVIOR, /progressState\?\.key === requestKey/);
    assert.match(BEHAVIOR, /\[requestKey, skill\]/);
  });

  test('scopes both canonical reads and keeps mistakes failure independent', () => {
    assert.match(BEHAVIOR, /`\/api\/quiz\/progress\$\{query\}`/);
    assert.match(BEHAVIOR, /`\/api\/quiz\/mistakes\$\{query\}`/);
    assert.match(BEHAVIOR, /setProgressState\(\{ key: requestKey, value: payload \}\)/);
    assert.match(BEHAVIOR, /setMistakesError/);
    assert.match(BEHAVIOR, /Mistakes là enrichment độc lập/);
  });

  test('renders authored prompt formatting without accepting raw HTML', () => {
    assert.match(BEHAVIOR, /function FormattedText/);
    assert.match(BEHAVIOR, /<strong key=/);
    assert.match(BEHAVIOR, /aria-label="chỗ trống"/);
    assert.match(BEHAVIOR, /function safeArticleUrl/);
    assert.doesNotMatch(BEHAVIOR, /\.innerHTML\s*=|__html/);
  });
});

describe('/quiz/progress — canonical entry points', () => {
  test('Next vocab practice links to the canonical route', () => {
    const practice = read(
      'app', '(authed-vocab-practice)', 'vocabulary', 'practice', 'vocab-practice-behavior.tsx',
    );
    assert.match(practice, /href="\/quiz\/progress\?skill_area=vocab"/);
    assert.doesNotMatch(practice, /pages\/quiz-progress\.html/);
  });

  test('legacy players consolidate navigation to the canonical route', () => {
    const quiz = read('public', 'pages', 'quiz.html');
    const practice = read('public', 'pages', 'vocab-practice.html');
    const landing = read('public', 'js', 'vocab-landing.js');
    for (const source of [quiz, practice, landing]) {
      assert.match(source, /\/quiz\/progress/);
      assert.doesNotMatch(source, /\/pages\/quiz-progress\.html/);
    }
  });
});

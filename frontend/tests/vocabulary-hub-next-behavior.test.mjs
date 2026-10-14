/** Regression gate for `/vocabulary/hub` native React behavior. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-vocabulary-hub)', 'vocabulary', 'hub', 'page.tsx');
const BEHAVIOR = read(
  'app', '(authed-vocabulary-hub)', 'vocabulary', 'hub', 'vocabulary-hub-behavior.tsx',
);
const MOUNT_ADAPTER = read('components', 'vocab-module-mount.tsx');
const HARD_NAV_GATE = read('tests', 'legacy-module-routes-need-hard-nav.test.mjs');

describe('/vocabulary/hub — native React ownership', () => {
  test('removes the compatibility shell, watchdog and duplicate chrome', () => {
    assert.doesNotMatch(PAGE, /vocab-landing\.js|watchdogScript|dangerouslySetInnerHTML|\bBODY\b/);
    assert.doesNotMatch(BEHAVIOR, /vocab-landing\.js|watchdogScript|dangerouslySetInnerHTML/);
    assert.equal((PAGE.match(/<aver-chrome\b/g) || []).length, 1);
  });

  test('is no longer hard-navigation-only', () => {
    const list = HARD_NAV_GATE.match(/const LEGACY_MODULE_ROUTES = \[([\s\S]*?)\];/)?.[1] || '';
    assert.doesNotMatch(list, /['"]\/vocabulary\/hub['"]/);
  });

  test('keys all private hub state by the current account and aborts reads', () => {
    const workspace = read('components', 'vocabulary-workspace.tsx');
    assert.match(BEHAVIOR, /<VocabularyAccount/);
    assert.match(workspace, /key=\{user.id\}/);
    assert.match(workspace, /controller.abort\(\)/);
    assert.match(BEHAVIOR, /controller.abort\(\)/);
  });

  test('keeps four real local navigation links present while users change views', () => {
    const workspace = read('components', 'vocabulary-workspace.tsx');
    for (const title of ['Học hôm nay', 'Bộ từ', 'Ôn tập', 'Tra cứu']) assert.ok(workspace.includes(title));
    assert.match(workspace, /aria-current/);
    assert.match(workspace, /vocabulary\/hub\?view=/);
    assert.doesNotMatch(BEHAVIOR, /href="#"|hidden=\{activeMode/);
    assert.match(BEHAVIOR, /useSearchParams\(\)/);
  });

  test('preserves legacy hash intent through the canonical URL view', () => {
    for (const mode of ['vocab-topics', 'flashcards', 'exercises']) assert.ok(BEHAVIOR.includes('#' + mode));
    assert.match(BEHAVIOR, /router.replace/);
  });

  test('shows saved vocabulary separately from demonstrated quiz outcomes', () => {
    assert.match(BEHAVIOR, /wallet_words/);
    assert.match(BEHAVIOR, /quiz_words_mastered/);
    assert.match(BEHAVIOR, /quiz_sessions/);
    assert.match(BEHAVIOR, /Từ đã lưu/);
    assert.doesNotMatch(BEHAVIOR, /Từ đã thuộc|words_learned/);
    assert.match(BEHAVIOR, /Promise.allSettled/);
    assert.match(BEHAVIOR, /statsError/);
  });

  test('retains owning legacy study flows with default-deny flags', () => {
    assert.match(BEHAVIOR, /flashcard_enabled === true/);
    assert.match(BEHAVIOR, /d1_enabled === true/);
    assert.match(BEHAVIOR, /vocab_curated_enabled === true/);
    assert.match(BEHAVIOR, /href="\/vocabulary\/learn"/);
    assert.match(BEHAVIOR, /href="\/flashcards"/);
    assert.match(BEHAVIOR, /href="\/d1-exercise"/);
    assert.match(BEHAVIOR, /quiz\/progress\?skill_area=vocab/);
    assert.doesNotMatch(BEHAVIOR, /dangerouslySetInnerHTML|\.innerHTML\s*=/);
    assert.match(MOUNT_ADAPTER, /handle\?\.unmount\?\.\(\)/);
  });

});

describe('/vocabulary/hub — canonical navigation', () => {
  test('all production entry points target the native hub', () => {
    const sources = [
      read('public', 'pages', 'vocab-exam.html'),
      read('app', '(authed-vocab-exam)', 'vocabulary', 'exam', 'page-shell.tsx'),
      read('public', 'js', 'vocab-modules', 'flashcards.js'),
      read('public', 'js', 'vocab-modules', 'exercises.js'),
      read('public', 'js', 'flashcard-study.js'),
      read('public', 'js', 'components', 'aver-chrome.js'),
    ];
    for (const source of sources) {
      assert.match(source, /vocabulary\/hub/);
      assert.doesNotMatch(source, /\/pages\/vocabulary\.html/);
    }
    assert.match(BEHAVIOR, /href="\/vocabulary\/practice"/);
    assert.match(BEHAVIOR, /href="\/vocabulary\/exam"/);
  });
});

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

  test('uses shared auth, keyed private state and aborts account-scoped reads', () => {
    assert.match(BEHAVIOR, /useAuth\(\)/);
    assert.match(BEHAVIOR, /status === 'signed-in' && user\?\.id/);
    assert.match(BEHAVIOR, /statsState\?\.key === requestKey/);
    assert.match(BEHAVIOR, /flagsState\?\.key === requestKey/);
    assert.match(BEHAVIOR, /new AbortController\(\)/);
    assert.match(BEHAVIOR, /controller\.abort\(\)/);
  });

  test('loads canonical stats and feature flags in parallel with honest states', () => {
    assert.match(BEHAVIOR, /Promise\.allSettled\(\[/);
    assert.match(BEHAVIOR, /'\/api\/student\/home-summary'/);
    assert.match(BEHAVIOR, /'\/auth\/me'/);
    assert.match(BEHAVIOR, /words_learned/);
    assert.match(BEHAVIOR, /quiz_words_missed/);
    assert.match(BEHAVIOR, /quiz_sessions/);
    assert.match(BEHAVIOR, /Không tải được thống kê từ vựng/);
    assert.match(BEHAVIOR, /const statsLoading = !stats && !statsFailed/);
  });

  test('keeps gated cards default-deny', () => {
    assert.match(BEHAVIOR, /flashcard_enabled === true/);
    assert.match(BEHAVIOR, /d1_enabled === true/);
    assert.match(BEHAVIOR, /flags\?\.flashcardEnabled/);
    assert.match(BEHAVIOR, /flags && \(flags\.d1Enabled \|\| flags\.flashcardEnabled\)/);
    assert.doesNotMatch(BEHAVIOR, /localStorage[^\n]*(?:flag|permission)|sessionStorage[^\n]*(?:flag|permission)/i);
  });

  test('preserves hash deep links, history entries and browser back/forward', () => {
    for (const mode of ['vocab-topics', 'flashcards', 'exercises']) {
      assert.match(BEHAVIOR, new RegExp(`['"]${mode}['"]`));
    }
    assert.match(BEHAVIOR, /history\.pushState\(null, '', `#\$\{mode\}`\)/);
    assert.match(BEHAVIOR, /addEventListener\('hashchange', syncMode\)/);
    assert.match(BEHAVIOR, /addEventListener\('popstate', syncMode\)/);
    assert.match(BEHAVIOR, /hidden=\{activeMode !== null\}/);
    assert.equal(
      (BEHAVIOR.match(/mode="(?:vocab-topics|flashcards|exercises)" href="#"/g) || []).length,
      3,
      'mode-card anchors must preserve the legacy # link fact; openMode writes the canonical hash',
    );
  });

  test('preserves visible whitespace between each stat value and unit', () => {
    assert.match(BEHAVIOR, /\{' '\}\s*<span className="unit">\{unit\}<\/span>/);
  });

  test('renders topic metadata declaratively and encodes every query value', () => {
    assert.match(BEHAVIOR, /'\/api\/vocabulary\/categories'/);
    assert.match(BEHAVIOR, /count > 0 && !!slug/);
    assert.match(BEHAVIOR, /encodeURIComponent\(slug\)/);
    assert.match(BEHAVIOR, /encodeURIComponent\(linkedTopicId\)/);
    assert.match(BEHAVIOR, /\/vocabulary\?cat=/);
    assert.match(BEHAVIOR, /\/flashcard-study\?stack=wiki:/);
    assert.match(BEHAVIOR, /\/quiz\/progress\?skill_area=vocab/);
    assert.doesNotMatch(BEHAVIOR, /\.innerHTML\s*=|__html/);
  });

  test('mounts retained domain modules through a lifecycle-safe adapter', () => {
    assert.match(BEHAVIOR, /<VocabModuleMount/);
    assert.match(MOUNT_ADAPTER, /`\/js\/vocab-modules\/\$\{moduleName\}\.js`/);
    assert.match(MOUNT_ADAPTER, /mount\(container, \{ embedded \}\)/);
    assert.match(MOUNT_ADAPTER, /handle\?\.unmount\?\.\(\)/);
    assert.match(BEHAVIOR, /key=\{`\$\{requestKey\}:flashcards`\}/);
    assert.match(BEHAVIOR, /key=\{`\$\{requestKey\}:exercises`\}/);
    assert.match(BEHAVIOR, /visited\.has\('flashcards'\)/);
    assert.match(BEHAVIOR, /visited\.has\('exercises'\)/);
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

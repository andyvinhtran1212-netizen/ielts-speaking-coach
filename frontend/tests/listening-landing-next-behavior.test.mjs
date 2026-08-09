/** Regression gate for `/listening` native React behavior. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-listening)', 'listening', 'page.tsx');
const SHELL = read('app', '(authed-listening)', 'listening', 'page-shell.tsx');
const BEHAVIOR = read(
  'app', '(authed-listening)', 'listening', 'listening-landing-behavior.tsx',
);
const HARD_NAV_GATE = read('tests', 'legacy-module-routes-need-hard-nav.test.mjs');

describe('/listening — native React behavior', () => {
  test('removes legacy injection and delegates overview state to React', () => {
    assert.doesNotMatch(PAGE, /LegacyModule|listening-landing\.js|watchdogScript|HydratedSignal/);
    assert.doesNotMatch(PAGE, /<script|dangerouslySetInnerHTML|modulepreload/);
    assert.match(PAGE, /<ListeningLandingBehavior\s*\/>/);
    assert.match(SHELL, /\{children\}/);
  });

  test('uses shared auth, fails closed and remounts state per account', () => {
    assert.match(BEHAVIOR, /useAuth\(\)/);
    assert.match(BEHAVIOR, /status === 'signed-out'/);
    assert.match(BEHAVIOR, /window\.location\.replace\('\/login\.html'\)/);
    assert.match(BEHAVIOR, /accountKey=\{user\.id\} key=\{user\.id\}/);
    assert.match(BEHAVIOR, /\[accountKey\]/);
  });

  test('fetches canonical overview and aborts stale account requests', () => {
    assert.match(BEHAVIOR, /whenGlobalReady\(/);
    assert.match(BEHAVIOR, /'\/api\/listening\/overview'/);
    assert.match(BEHAVIOR, /window\.api\.getWith<unknown>/);
    assert.match(BEHAVIOR, /signal: controller\.signal/);
    assert.match(BEHAVIOR, /disposed = true/);
    assert.match(BEHAVIOR, /controller\.abort\(\)/);
  });

  test('preserves strict exam/content counts and ordered coercible mode counts', () => {
    assert.match(BEHAVIOR, /typeof value === 'number' && Number\.isFinite\(value\) && value > 0/);
    assert.match(BEHAVIOR, /const number = Number\(value\)/);
    assert.match(
      BEHAVIOR,
      /\['dictation', 'Chép chính tả'\][\s\S]*\['gist', 'Nghe ý chính'\][\s\S]*\['true_false', 'Đúng \/ Sai'\][\s\S]*\['mcq', 'Trắc nghiệm'\]/,
    );
    assert.match(BEHAVIOR, /\.filter\(\(\[key\]\) => coerciblePositiveCount\(modes\[key\]\) > 0\)/);
    assert.doesNotMatch(BEHAVIOR, /\['mini_test'/);
  });

  test('keeps count-driven cards and exact destinations', () => {
    for (const href of [
      '/listening/tests',
      '/listening/mini-test',
      '/listening/skills',
      '/listening/practice',
      '/listening/browse',
      '/listening/analytics',
    ]) {
      assert.match(BEHAVIOR, new RegExp(`href=["']${href.replaceAll('/', '\\/')}["']`));
    }
    assert.match(BEHAVIOR, /typeof count === 'number'/);
    assert.match(BEHAVIOR, /\{count\} bài/);
    assert.match(BEHAVIOR, /ready\.content > 0 && ready\.modeLabels\.length > 0/);
    assert.match(BEHAVIOR, /ready\.modeLabels\.join\(' · '\)/);
  });

  test('keeps truthful loading, empty and API-fallback surfaces', () => {
    assert.match(BEHAVIOR, /state\.status === 'ready' && examCount === 0/);
    assert.match(BEHAVIOR, /Chưa có đề nào được xuất bản/);
    assert.match(BEHAVIOR, /unverified=\{state\.status === 'error'\}/);
    assert.match(BEHAVIOR, /Không tải được số lượng bài\. Danh sách bên dưới vẫn mở được\./);
    assert.match(BEHAVIOR, /state=\{\{ status: 'loading' \}\}/);
  });

  test('does not recreate bare content-mode dead ends or unsafe authored markup', () => {
    for (const href of [
      '/listening/dictation',
      '/listening/gist',
      '/listening/tf',
      '/listening/mcq',
    ]) {
      assert.doesNotMatch(BEHAVIOR, new RegExp(`href=["']${href.replaceAll('/', '\\/')}["']`));
    }
    assert.doesNotMatch(BEHAVIOR, /innerHTML|dangerouslySetInnerHTML|__html|eval\(/);
  });

  test('uses static SVG icons without a post-hydration lucide mutation', () => {
    assert.match(BEHAVIOR, /<svg/);
    assert.doesNotMatch(BEHAVIOR, /data-lucide|createIcons\(/);
  });

  test('is no longer hard-navigation-only', () => {
    const list = HARD_NAV_GATE.match(/const LEGACY_MODULE_ROUTES = \[([\s\S]*?)\];/)?.[1] || '';
    assert.doesNotMatch(list, /['"]\/listening['"]/);
  });
});

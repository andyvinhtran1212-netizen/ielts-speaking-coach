/** Regression gate for `/listening/browse` native React behavior. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-listening)', 'listening', 'browse', 'page.tsx');
const SHELL = read('app', '(authed-listening)', 'listening', 'browse', 'page-shell.tsx');
const BEHAVIOR = read(
  'app', '(authed-listening)', 'listening', 'browse', 'listening-browse-behavior.tsx',
);
const HARD_NAV_GATE = read('tests', 'legacy-module-routes-need-hard-nav.test.mjs');

describe('/listening/browse — native React behavior', () => {
  test('removes legacy injection and delegates filter/list state to React', () => {
    assert.doesNotMatch(PAGE, /LegacyModule|listening-browse\.js|watchdogScript|HydratedSignal/);
    assert.doesNotMatch(PAGE, /<script|dangerouslySetInnerHTML|modulepreload/);
    assert.match(PAGE, /<ListeningBrowseBehavior\s*\/>/);
    assert.match(SHELL, /\{children\}/);
  });

  test('uses shared auth, fails closed and scopes filters/results by account', () => {
    assert.match(BEHAVIOR, /useAuth\(\)/);
    assert.match(BEHAVIOR, /status === 'signed-out'/);
    assert.match(BEHAVIOR, /window\.location\.replace\('\/login\.html'\)/);
    assert.match(BEHAVIOR, /accountKey=\{user\.id\} key=\{user\.id\}/);
    assert.match(BEHAVIOR, /\[accountKey, filters\]/);
  });

  test('keeps all three controlled canonical filters', () => {
    for (const id of ['filter-accent', 'filter-cefr', 'filter-section']) {
      assert.match(BEHAVIOR, new RegExp(`id=["']${id}["']`));
    }
    assert.match(BEHAVIOR, /query\.set\('accent_tag', filters\.accent\)/);
    assert.match(BEHAVIOR, /query\.set\('cefr_level', filters\.cefr\)/);
    assert.match(BEHAVIOR, /query\.set\('ielts_section', filters\.section\)/);
    assert.match(BEHAVIOR, /setFilters\(\(current\) => \(\{ \.\.\.current, \[key\]: value \}\)\)/);
  });

  test('pages the content endpoint and aborts stale filter/account requests', () => {
    assert.match(BEHAVIOR, /`\/api\/listening\/content\?\$\{query\.toString\(\)\}`/);
    assert.match(BEHAVIOR, /query\.set\('limit', String\(PAGE_LIMIT\)\)/);
    assert.match(BEHAVIOR, /query\.set\('offset', String\(offset\)\)/);
    assert.match(BEHAVIOR, /window\.api\.getWith<unknown>/);
    assert.match(BEHAVIOR, /if \(pageItems\.length < PAGE_LIMIT\) return all/);
    assert.match(BEHAVIOR, /Danh sách vượt \$\{MAX_PAGES \* PAGE_LIMIT\} mục/);
    assert.match(BEHAVIOR, /fetchAllContent\(filters, controller\.signal\)/);
    assert.match(BEHAVIOR, /\{ signal \}/);
    assert.match(BEHAVIOR, /controller\.abort\(\)/);
  });

  test('offers only backend-reported modes in the legacy pedagogical order', () => {
    assert.match(
      BEHAVIOR,
      /\['dictation', 'Chép chính tả', '\/pages\/listening-dictation\.html'\][\s\S]*\['gist', 'Ý chính', '\/pages\/listening-gist\.html'\][\s\S]*\['true_false', 'Đúng\/Sai', '\/pages\/listening-tf\.html'\][\s\S]*\['mcq', 'Trắc nghiệm', '\/pages\/listening-mcq\.html'\]/,
    );
    assert.match(BEHAVIOR, /MODE_LINKS\.filter\(\(\[mode\]\) => item\.availableModes\?\.includes\(mode\)\)/);
    assert.match(BEHAVIOR, /\?content_id=\$\{encodeURIComponent\(item\.id\)\}/);
  });

  test('distinguishes lookup failure, genuine no-mode and list failure', () => {
    assert.match(BEHAVIOR, /raw\.available_modes === null/);
    assert.match(BEHAVIOR, /⚠ Không đọc được danh sách dạng luyện/);
    assert.match(BEHAVIOR, /Chưa có dạng luyện nào cho bài này/);
    assert.match(BEHAVIOR, /Không tải được danh sách\./);
    assert.match(BEHAVIOR, /Chưa có bài nghe nào khớp bộ lọc\./);
  });

  test('renders authored fields through React and preserves metadata pills', () => {
    assert.match(BEHAVIOR, /<h3>\{item\.title\}<\/h3>/);
    assert.match(BEHAVIOR, /<div className="desc">\{item\.description\}<\/div>/);
    assert.match(BEHAVIOR, /meta-pill is-brand/);
    assert.match(BEHAVIOR, /Section \{item\.section\}/);
    assert.match(BEHAVIOR, /\{item\.minutes\}p/);
    assert.doesNotMatch(BEHAVIOR, /innerHTML|dangerouslySetInnerHTML|__html|eval\(/);
  });

  test('is no longer hard-navigation-only', () => {
    const list = HARD_NAV_GATE.match(/const LEGACY_MODULE_ROUTES = \[([\s\S]*?)\];/)?.[1] || '';
    assert.doesNotMatch(list, /['"]\/listening\/browse['"]/);
  });
});

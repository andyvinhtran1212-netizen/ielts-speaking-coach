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
const LEGACY = read('public', 'js', 'listening-browse.js');
const PARITY_WORKFLOW = read('..', '.github', 'workflows', 'parity-gate.yml');

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
    assert.match(BEHAVIOR, /window\.location\.replace\('\/login'\)/);
    assert.match(BEHAVIOR, /status === 'signed-in' && user\?\.id \? user\.id : null/);
    assert.match(BEHAVIOR, /accountKey=\{accountKey\} key=\{accountKey \|\| status\}/);
    assert.match(BEHAVIOR, /if \(!accountKey\)/);
    assert.match(BEHAVIOR, /\[accountKey, filters, offset, retryKey\]/);
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
    assert.match(BEHAVIOR, /const PAGE_LIMIT = 24/);
    assert.match(BEHAVIOR, /`\/api\/listening\/content\?\$\{query\.toString\(\)\}`/);
    assert.match(BEHAVIOR, /query\.set\('limit', String\(PAGE_LIMIT\)\)/);
    assert.match(BEHAVIOR, /query\.set\('offset', String\(offset\)\)/);
    assert.match(BEHAVIOR, /window\.api\.getWith<unknown>/);
    assert.match(BEHAVIOR, /fetchContentPage\(filters, offset, controller\.signal\)/);
    assert.match(BEHAVIOR, /setOffset\(\(current\) => current \+ PAGE_LIMIT\)/);
    assert.match(BEHAVIOR, /Xem thêm \(\$\{shown\}\/\$\{state\.total\}\)/);
    assert.match(BEHAVIOR, /Các bài đã tải vẫn được giữ lại/);
    assert.match(BEHAVIOR, /setRetryKey\(\(current\) => current \+ 1\)/);
    assert.match(BEHAVIOR, /\{ signal \}/);
    assert.match(BEHAVIOR, /controller\.abort\(\)/);
  });

  test('offers only backend-reported modes in pedagogical order through current route owners', () => {
    assert.match(
      BEHAVIOR,
      /\['dictation', 'Chép chính tả', '\/listening\/dictation'\][\s\S]*\['gist', 'Ý chính', '\/listening\/gist'\][\s\S]*\['true_false', 'Đúng\/Sai', '\/listening\/tf'\][\s\S]*\['mcq', 'Trắc nghiệm', '\/listening\/mcq'\]/,
    );
    assert.match(BEHAVIOR, /MODE_LINKS\.filter\(\(\[mode\]\) => item\.availableModes\?\.includes\(mode\)\)/);
    assert.match(BEHAVIOR, /\?content_id=\$\{encodeURIComponent\(item\.id\)\}/);
  });

  test('distinguishes lookup failure, genuine no-mode and list failure', () => {
    assert.match(BEHAVIOR, /Array\.isArray\(raw\.available_modes\)[\s\S]*: null/);
    assert.match(BEHAVIOR, /⚠ Không đọc được danh sách dạng luyện/);
    assert.match(BEHAVIOR, /Chưa có dạng luyện nào cho bài này/);
    assert.match(BEHAVIOR, /Không tải được danh sách bài nghe\. Vui lòng thử lại\./);
    assert.match(BEHAVIOR, /Chưa có bài nghe nào khớp bộ lọc\./);
    assert.match(BEHAVIOR, /id="state-loading" role="status"/);
    assert.match(BEHAVIOR, /id="state-empty" role="status"/);
    assert.match(BEHAVIOR, /id="state-error" role="alert"/);
    assert.doesNotMatch(BEHAVIOR, /caught instanceof Error[\s\S]*caught\.message|String\(caught\)/);
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

  test('runs its browser-backed flow unconditionally in the parity gate', () => {
    assert.match(PARITY_WORKFLOW, /node tooling\/verify-listening-browse-flow\.mjs/);
  });

  test('keeps rollback behavior honest for malformed modes and backend errors', () => {
    assert.match(LEGACY, /!item \|\| !Array\.isArray\(item\.available_modes\)/);
    assert.match(LEGACY, /Không tải được danh sách bài nghe\. Vui lòng thử lại\./);
    assert.doesNotMatch(LEGACY, /e && e\.message/);
  });
});

/** Regression gate for `/reading/vocab` native React behavior. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-reading)', 'reading', 'vocab', 'page.tsx');
const SHELL = read('app', '(authed-reading)', 'reading', 'vocab', 'page-shell.tsx');
const BEHAVIOR = read(
  'app', '(authed-reading)', 'reading', 'vocab', 'reading-vocab-behavior.tsx',
);
const HARD_NAV_GATE = read('tests', 'legacy-module-routes-need-hard-nav.test.mjs');
const BROWSER_FLOW = read('tooling', 'verify-reading-vocab-flow.mjs');
const PARITY_WORKFLOW = readFileSync(join(ROOT, '..', '.github', 'workflows', 'parity-gate.yml'), 'utf8');

describe('/reading/vocab — native React behavior', () => {
  test('removes legacy module injection, hydration sentinel and watchdog', () => {
    assert.doesNotMatch(PAGE, /LegacyModule|reading-vocab\.js|watchdogScript|HydratedSignal/);
    assert.doesNotMatch(PAGE, /<script|dangerouslySetInnerHTML|modulepreload/);
    assert.match(PAGE, /<ReadingVocabBehavior\s*\/>/);
    assert.match(SHELL, /\{children\}/);
    assert.match(SHELL, /\{totalCount\}/);
    assert.match(BEHAVIOR, /<ReadingVocabShell totalCount=\{total \?\? '—'\}>/);
  });

  test('uses shared auth, fails closed and keys requests by account', () => {
    assert.match(BEHAVIOR, /useAuth\(\)/);
    assert.match(BEHAVIOR, /status === 'signed-out'/);
    assert.match(BEHAVIOR, /window\.location\.replace\('\/login'\)/);
    assert.match(BEHAVIOR, /status === 'signed-in' && user\?\.id \? user\.id : null/);
    assert.match(BEHAVIOR, /accountKey=\{accountKey\} key=\{accountKey \|\| status\}/);
    assert.match(BEHAVIOR, /if \(!accountKey\)/);
    assert.match(BEHAVIOR, /\[accountKey, difficulty, tag, offset, retryToken\]/);
  });

  test('preserves the canonical filtered read with abort cleanup', () => {
    assert.match(BEHAVIOR, /query\.set\('difficulty', difficulty\)/);
    assert.match(BEHAVIOR, /query\.set\('tag', tag\)/);
    assert.match(BEHAVIOR, /query\.set\('limit', String\(PAGE_SIZE\)\)/);
    assert.match(BEHAVIOR, /query\.set\('offset', String\(offset\)\)/);
    assert.match(BEHAVIOR, /window\.api\.getWith<unknown>/);
    assert.match(BEHAVIOR, /`\/api\/reading\/vocab\?\$\{query\.toString\(\)\}`/);
    assert.match(BEHAVIOR, /new AbortController\(\)/);
    assert.match(BEHAVIOR, /signal: controller\.signal/);
    assert.match(BEHAVIOR, /controller\.abort\(\)/);
    assert.match(BEHAVIOR, /normalizeTotal\(payload, offset \+ passages\.length\)/);
    assert.match(BEHAVIOR, /total > shown[\s\S]*đang hiển thị/);
    assert.match(BEHAVIOR, /Xem thêm \(\$\{shown\}\/\$\{total\}\)/);
    assert.match(BEHAVIOR, /setOffset\(\(current\) => current \+ PAGE_SIZE\)/);
    assert.match(BEHAVIOR, /Chưa tải được trang tiếp theo/);
  });

  test('normalizes malformed payloads and renders authored data declaratively', () => {
    assert.match(BEHAVIOR, /if \(!Array\.isArray\(items\)\) return \[\]/);
    assert.match(BEHAVIOR, /if \(!slug\) return \[\]/);
    assert.match(BEHAVIOR, /new Set\(raw\.topic_tags\.map\(textValue\)\.filter\(Boolean\)\)/);
    assert.match(BEHAVIOR, /encodeURIComponent\(passage\.slug\)/);
    assert.doesNotMatch(BEHAVIOR, /innerHTML|dangerouslySetInnerHTML|__html|eval\(/);
  });

  test('keeps loading, empty, error and populated states distinct', () => {
    assert.match(BEHAVIOR, /state\.status === 'loading'/);
    assert.match(BEHAVIOR, /Chưa có bài đọc nào khớp bộ lọc/);
    assert.match(BEHAVIOR, /Không tải được thư viện\./);
    assert.match(BEHAVIOR, /state\.status === 'ready' && state\.passages\.length/);
    assert.doesNotMatch(BEHAVIOR, /caught\.message|errorMessage\(/);
  });

  test('preserves filters, first-load tag seeding and passage destinations', () => {
    assert.match(BEHAVIOR, /setAvailableTags\(\(current\) =>/);
    assert.match(BEHAVIOR, /\.\.\.current, \.\.\.passages\.flatMap/,
      'tag options phải tích lũy từ các trang đã tải');
    assert.match(BEHAVIOR, /id="filter-difficulty"/);
    assert.match(BEHAVIOR, /id="filter-tag"/);
    assert.match(BEHAVIOR, /id="rv-result-count"[^>]*aria-live="polite"/);
    assert.match(BEHAVIOR, /id="clear-filters"/);
    assert.match(BEHAVIOR, /hidden=\{!hasFilters\}/);
    assert.match(BEHAVIOR, /setDifficulty\(''\)[\s\S]*setTag\(''\)/);
    assert.match(BEHAVIOR, /\/reading\/vocab\/\$\{encodeURIComponent\(passage\.slug\)\}/);
    assert.doesNotMatch(BEHAVIOR, /\/pages\/reading-vocab-passage\.html\?slug=/);
  });

  test('preserves the redesigned card hierarchy and accessible action cues', () => {
    assert.match(BEHAVIOR, /className="rv-grid rv-grid--articles"/);
    assert.match(BEHAVIOR, /className="rv-card__top"/);
    assert.match(BEHAVIOR, /className="rv-card__footer"/);
    assert.match(BEHAVIOR, /className="rv-card__cta"/);
    assert.match(BEHAVIOR, /aria-label=\{`Đọc bài \$\{passage\.title\}`\}/);
    assert.match(BEHAVIOR, /DIFFICULTY_LABELS\[passage\.difficulty\]/);
  });

  test('runs a browser-backed malformed/race/reset contract in blocking G1', () => {
    assert.match(BROWSER_FLOW, /payload lỗi hình dạng render empty state/);
    assert.match(BROWSER_FLOW, /response filter cũ không ghi đè response mới/);
    assert.match(BROWSER_FLOW, /Xóa lọc reset cả hai select/);
    assert.match(BROWSER_FLOW, /page\.route\('\*\*\/\*'/);
    assert.match(PARITY_WORKFLOW, /node tooling\/verify-reading-vocab-flow\.mjs/);
  });

  test('is no longer hard-navigation-only', () => {
    const list = HARD_NAV_GATE.match(/const LEGACY_MODULE_ROUTES = \[([\s\S]*?)\];/)?.[1] || '';
    assert.doesNotMatch(list, /['"]\/reading\/vocab['"]/);
  });
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

const ROOT = join(import.meta.dirname, '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-admin-vocab)', 'admin', 'vocab', 'curated', 'page.tsx');
const CLIENT = read('app', '(authed-admin-vocab)', 'admin', 'vocab', 'curated', 'admin-vocab-editorial.tsx');
const HUB = read('app', '(authed-admin-vocab)', 'admin', 'vocab', 'page.tsx');
const CHROME = read('public', 'js', 'components', 'aver-admin-chrome.js');
const CSS = read('public', 'css', 'admin-vocab-next.css');

describe('native curated editorial workspace', () => {
  test('is protected by canonical admin gate and reachable from both IA anchors', () => {
    assert.match(PAGE, /<AdminAccessGate>/);
    assert.match(PAGE, /subsection="curated"/);
    assert.match(HUB, /href: '\/admin\/vocab\/curated'/);
    assert.match(CHROME, /slug: 'curated'[^\n]*href: '\/admin\/vocab\/curated'/);
  });

  test('reads canonical catalog/detail and reads back after every mutation family', () => {
    assert.match(CLIENT, /\/admin\/vocabulary\/editorial\/units\?/);
    assert.match(CLIENT, /\/admin\/vocabulary\/editorial\/units\/\$\{encodeURIComponent\(unitId\)\}/);
    for (const path of ['/validate', '/reviews', '/publish', '/rollback']) assert.ok(CLIENT.includes(path), path);
    assert.match(CLIENT, /await refreshCanonical\(/);
    assert.match(CLIENT, /Mutation đã trả về nhưng canonical readback thất bại/);
    assert.match(CLIENT, /if \(!await loadDetail\(/);
  });

  test('pages the bounded server catalog instead of hiding units after the first 100', () => {
    assert.match(CLIENT, /const CATALOG_PAGE_SIZE = 100/);
    assert.match(CLIENT, /offset: nextOffset, limit: CATALOG_PAGE_SIZE/);
    assert.match(CLIENT, /setOffset\(offset \+ CATALOG_PAGE_SIZE\)/);
    assert.match(CLIENT, /offset \+ units\.length >= total/);
    assert.match(CSS, /\.avv-editorial-pager\s*\{/);
  });

  test('keeps review gates textual and hides private answers behind disclosure', () => {
    assert.match(CLIENT, /Chờ duyệt/);
    assert.match(CLIENT, /Cần sửa/);
    assert.match(CLIENT, /<details><summary>Đáp án riêng & giải thích<\/summary>/);
    assert.match(CLIENT, /ba cửa bắt buộc ba reviewer khác nhau/);
  });

  test('has bounded master-detail and mobile layout rules', () => {
    assert.match(CSS, /\.avv-editorial-layout\s*\{[^}]*grid-template-columns/);
    assert.match(CSS, /@media \(max-width: 780px\)[\s\S]*\.avv-editorial-layout\s*\{[^}]*grid-template-columns:\s*1fr/);
    assert.match(CSS, /\.avv-editorial-list\s*\{[^}]*max-height:/);
  });
});

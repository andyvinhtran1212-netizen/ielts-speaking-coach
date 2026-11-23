/** Regression pins for the Grammar Wiki Phase 0 foundation repairs. */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.join(HERE, '..');
const read = (...parts) => readFileSync(path.join(FRONTEND, ...parts), 'utf8');

const HOME = read('app', '(public-content)', 'grammar', 'page.tsx');
const SHELL = read('app', '(public-content)', 'grammar', '[category]', '[slug]', 'page-shell.tsx');
const READING = read('components', 'library', 'reading-layout.tsx');
const CHROME = read('public', 'js', 'components', 'aver-chrome.js');

describe('Grammar Wiki Phase 0 foundations', () => {
  test('canonical home copy does not freeze a stale group count', () => {
    // G06-T14 (b): the hero no longer carries a count; the index heading
    // counts groups and articles from the groups API (grammar-index.tsx).
    assert.ok(!/\d+ nhóm/.test(HOME), 'group count must come from data or remain count-free');
    const INDEX = read('app', '(public-content)', 'grammar', 'grammar-index.tsx');
    assert.match(INDEX, /\{index\.length\} nhóm · \{articleCount\} bài/);
    assert.match(INDEX, /index\.length > 0 \?/, 'no count while the index is empty or failed');
  });

  // G06-T14 (a): trang bài dùng khuôn bài đọc chung (LIBRARY-0061 T007), mục lục
  // lấy từ `toc` của bài; khuôn tự lo cột trái trên máy tính và khối mở/đóng trên điện thoại.
  test('article shell exposes TOC navigation on desktop and mobile', () => {
    assert.match(SHELL, /<ReadingLayout[\s\S]*?toc=\{toc\}/);
    assert.match(SHELL, /articleToc\(article\.toc\)/);
    assert.match(READING, /<aside className=\{styles\.tocColumn\}>/);
    assert.match(READING, /<details className=\{styles\.tocNarrow\}/);
  });

  test('TOC active state is synchronized across both render targets', () => {
    assert.equal((READING.match(/<TocList toc=\{toc\} active=\{active\} \/>/g) || []).length, 2,
      'cột rộng và khối hẹp dùng chung một trạng thái "đang đọc"');
    assert.match(READING, /aria-current=\{current \? 'location' : undefined\}/);
  });

  test('mobile primary nav uses a vertical disclosure without clipping auto-scroll', () => {
    assert.match(CHROME, /\.nav-links\s*\{[^}]*display:\s*none;[^}]*flex-direction:\s*column/s);
    assert.match(CHROME, /\.nav-links\.is-open\s*\{\s*display:\s*flex/);
    assert.match(CHROME, /min-height:\s*44px/);
    assert.match(CHROME, /setAttribute\('aria-current', 'page'\)/);
    assert.doesNotMatch(CHROME, /overflow-x:\s*auto|nav\.scrollLeft/);
  });
});

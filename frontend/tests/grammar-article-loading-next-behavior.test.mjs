import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOADING = readFileSync(path.join(
  FRONTEND, 'app', '(public-content)', 'grammar', '[category]', '[slug]', 'loading.tsx',
), 'utf8');

test('Grammar article streams a stable, accessible reading skeleton', () => {
  assert.match(LOADING, /<aver-chrome active="grammar"/);
  assert.match(LOADING, /aria-busy="true"/);
  assert.match(LOADING, /role="status">Đang tải bài Grammar/);
  // G06-T14 (a): khung tải theo khuôn bài đọc mới — cột mục lục + cột chữ, ẩn với trình đọc màn hình.
  assert.match(LOADING, /className=\{`av2-root /);
  assert.match(LOADING, /className=\{styles\.skeleton\} aria-hidden="true"/);
  assert.match(LOADING, /styles\.skelToc/);
  assert.doesNotMatch(LOADING, /return null/);
});

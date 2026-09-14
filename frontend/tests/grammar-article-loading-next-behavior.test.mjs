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
  assert.match(LOADING, /className="gw-subnav/);
  assert.match(LOADING, /aria-busy="true"/);
  assert.match(LOADING, /role="status">Đang tải bài Grammar/);
  assert.match(LOADING, /maxWidth: 'var\(--av-width-read\)'/);
  assert.match(LOADING, /hidden lg:block w-56 shrink-0/);
  assert.doesNotMatch(LOADING, /return null/);
});

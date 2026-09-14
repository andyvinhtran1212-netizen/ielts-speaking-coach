import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

const FRONTEND = join(import.meta.dirname, '..');
const HUB_SHELLS = [
  ['app', '(authed-reading)', 'reading', 'vocab', 'page-shell.tsx'],
  ['app', '(authed-reading)', 'reading', 'test', 'page-shell.tsx'],
  ['app', '(authed-reading)', 'reading', 'skill', 'page-shell.tsx'],
  ['app', '(authed-reading)', 'reading', 'mini-test', 'page-shell.tsx'],
  ['app', '(authed-listening)', 'listening', 'practice', 'page-shell.tsx'],
  ['app', '(authed-listening)', 'listening', 'browse', 'page-shell.tsx'],
  ['app', '(authed-listening)', 'listening', 'analytics', 'page-shell.tsx'],
  ['app', '(authed-listening)', 'listening', 'skills', 'page-shell.tsx'],
];

describe('Reading and Listening hub navigation', () => {
  test('ordinary internal destinations use Next Link', () => {
    for (const parts of HUB_SHELLS) {
      const source = readFileSync(join(FRONTEND, ...parts), 'utf8');
      assert.match(source, /import Link from 'next\/link'/, parts.join('/'));
      assert.doesNotMatch(source, /<a[^>]*href="\//, parts.join('/'));
    }
  });

  test('current Reading tab remains non-navigable', () => {
    for (const parts of HUB_SHELLS.slice(0, 4)) {
      const source = readFileSync(join(FRONTEND, ...parts), 'utf8');
      assert.match(source, /className="rv-libnav__link is-active" aria-current="page"/);
    }
  });
});

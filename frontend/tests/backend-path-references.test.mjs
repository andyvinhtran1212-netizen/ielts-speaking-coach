// Every backend path a frontend test names must exist (Q27, lesson of #2413 R1).
//
// Contract tests read backend source text (readFileSync(join(..., 'backend', ...))).
// When a backend file moves, a test that builds the old path from segments is
// missed by a plain grep and fails only at run time with ENOENT. This test finds
// both spellings in every test file, quoted 'backend/...' literals (optionally
// behind ../) and calls whose arguments include 'backend' followed by literal
// path segments, and requires each named path to exist in the repository.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, '..', '..');
const SOURCE = /\.(?:[cm]?js|tsx?)$/;

// Paths a test creates on purpose inside a temporary directory, not repo files.
const SYNTHETIC = new Map([
  ['pre-push-hook.test.mjs', new Set(['backend/venv', 'backend/venv/bin', 'backend/.gitkeep'])],
  ['vercel-ignore-build.test.mjs', new Set(['backend/migrations/400_x.sql', 'backend/a.py'])],
]);

const LITERAL = /['"`]((?:\.\.\/)*backend\/[A-Za-z0-9_./-]+)['"`]/g;
const SEGMENTS = /\(([^()]*?)['"]backend['"]((?:\s*,\s*['"][^'"`]+['"])+)\s*[,)]/g;

function testFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules') return [];
    return statSync(path).isDirectory() ? testFiles(path) : SOURCE.test(name) ? [path] : [];
  });
}

export function backendReferences(source) {
  const found = [];
  for (const match of source.matchAll(LITERAL)) {
    const path = match[1].replace(/^(?:\.\.\/)+/, '');
    if (!path.includes('*') && !path.endsWith('/')) found.push(path);
  }
  for (const match of source.matchAll(SEGMENTS)) {
    const parts = [...match[2].matchAll(/['"]([^'"`]+)['"]/g)].map((part) => part[1]);
    found.push(['backend', ...parts].join('/'));
  }
  return found;
}

test('the scanner sees literal and segment-built backend paths', () => {
  assert.deepEqual(
    backendReferences(`
      readFileSync(join(here, '..', '..', 'backend', 'routers', 'listening.py'), 'utf8');
      const be = read('..', 'backend', 'services', 'x.py');
      fs.readFileSync(new URL('../../backend/main.py', import.meta.url));
      const glob = 'backend/routers/**';
    `),
    ['backend/main.py', 'backend/routers/listening.py', 'backend/services/x.py'],
  );
});

test('every backend path named by a frontend test exists', () => {
  const missing = [];
  let checked = 0;
  for (const file of testFiles(here)) {
    if (file === fileURLToPath(import.meta.url)) continue;
    const synthetic = SYNTHETIC.get(relative(here, file)) ?? new Set();
    for (const path of backendReferences(readFileSync(file, 'utf8'))) {
      checked += 1;
      if (!synthetic.has(path) && !existsSync(join(REPO, path))) missing.push(`${relative(here, file)}: ${path}`);
    }
  }
  assert.ok(checked > 50, `scanner found only ${checked} backend references`);
  assert.deepEqual(missing, [], `backend paths that no longer exist:\n${missing.join('\n')}`);
});

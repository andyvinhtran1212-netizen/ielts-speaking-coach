// Every backend path a frontend test or tooling script names must exist
// (Q27, lesson of #2413 R1; tooling added in Q34 after CR-2417-R1).
//
// Contract tests read backend source text (readFileSync(join(..., 'backend', ...))).
// When a backend file moves, a test that builds the old path from segments is
// missed by a plain grep and fails only at run time with ENOENT. This test finds
// both spellings in every file under frontend/tests and frontend/tooling, quoted 'backend/...' literals (optionally
// behind ../) and calls whose arguments include 'backend' followed by literal
// path segments, and requires each named path to exist in the repository.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(here, '..');
const REPO = join(FRONTEND, '..');
// frontend/tooling holds the verify-*.mjs flows and write-flows helpers; #2413
// had to update five of them when listening.py moved.
const ROOTS = [here, join(FRONTEND, 'tooling')];
const SOURCE = /\.(?:[cm]?js|tsx?)$/;

// Paths a test creates on purpose inside a temporary directory, not repo files.
const SYNTHETIC = new Map([
  ['tests/pre-push-hook.test.mjs', new Set(['backend/venv', 'backend/venv/bin', 'backend/.gitkeep'])],
  ['tests/vercel-ignore-build.test.mjs', new Set(['backend/migrations/400_x.sql', 'backend/a.py'])],
]);

const LITERAL = /['"`]((?:\.\.\/)*backend\/[A-Za-z0-9_./-]+)['"`]/g;
const SEGMENTS = /\(([^()]*?)['"]backend['"]((?:\s*,\s*['"][^'"`]+['"])+)\s*[,)]/g;

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules') return [];
    return statSync(path).isDirectory() ? sourceFiles(path) : SOURCE.test(name) ? [path] : [];
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

test('every backend path named by a frontend test or tooling script exists', () => {
  const missing = [];
  const checked = new Map(ROOTS.map((root) => [root, 0]));
  for (const root of ROOTS) {
    for (const file of sourceFiles(root)) {
      if (file === fileURLToPath(import.meta.url)) continue;
      const name = relative(FRONTEND, file);
      const synthetic = SYNTHETIC.get(name) ?? new Set();
      for (const path of backendReferences(readFileSync(file, 'utf8'))) {
        checked.set(root, checked.get(root) + 1);
        if (!synthetic.has(path) && !existsSync(join(REPO, path))) missing.push(`${name}: ${path}`);
      }
    }
  }
  // Floors guard against the scanner silently matching nothing in either root.
  assert.ok(checked.get(here) > 50, `scanner found only ${checked.get(here)} references in tests`);
  assert.ok(checked.get(ROOTS[1]) > 0, 'scanner found no references in tooling');
  assert.deepEqual(missing, [], `backend paths that no longer exist:\n${missing.join('\n')}`);
});

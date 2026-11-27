// --av2-focus is the whole outline shorthand ("3px solid var(--av2-ink)").
// Putting it inside another shorthand ("outline: 2px solid var(--av2-focus)")
// makes the declaration invalid, so the browser drops the focus ring.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';

const ROOT = new URL('..', import.meta.url).pathname;
const DIRS = ['app', 'components', 'styles'];

function cssFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...cssFiles(path));
    else if (name.endsWith('.css')) out.push(path);
  }
  return out;
}

test('var(--av2-focus) is only ever the whole outline value', () => {
  const offenders = [];
  for (const file of DIRS.flatMap((d) => cssFiles(join(ROOT, d)))) {
    // Comments are documentation, not declarations.
    const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
    source.split('\n').forEach((line, i) => {
      for (const decl of line.split(';')) {
        if (!decl.includes('var(--av2-focus)')) continue;
        if (/^\s*(?:[^{]*\{\s*)?outline\s*:\s*var\(--av2-focus\)\s*(?:!important\s*)?\}?\s*$/.test(decl)) continue;
        offenders.push(`${relative(ROOT, file)}:${i + 1}: ${decl.trim()}`);
      }
    });
  }
  assert.deepEqual(offenders, []);
});

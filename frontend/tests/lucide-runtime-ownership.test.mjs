import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (...segments) => readFileSync(path.join(FRONTEND, ...segments), 'utf8');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(?:ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function executableSource(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

test('AuthedShell makes the heavy Lucide DOM runtime explicit opt-in', () => {
  const shell = read('components', 'authed-shell.tsx');
  assert.match(shell, /lucideRuntime = false/);
  assert.match(shell, /lucideRuntime && <Script src="\/vendor\/lucide\.min\.js"/);
});

test('only the two remaining executable consumers opt in to the Lucide global', () => {
  const consumers = walk(path.join(FRONTEND, 'app'))
    .filter((file) => /window\.lucide|\.lucide\.createIcons/.test(executableSource(readFileSync(file, 'utf8'))))
    .map((file) => path.relative(path.join(FRONTEND, 'app'), file));
  assert.deepEqual(consumers, ['(authed-writing)/writing/dashboard/writing-behavior.tsx']);

  const optedIn = walk(path.join(FRONTEND, 'app'))
    .filter((file) => /<AuthedShell[\s\S]*?\blucideRuntime\b/.test(readFileSync(file, 'utf8')))
    .map((file) => path.relative(path.join(FRONTEND, 'app'), file))
    .sort();
  assert.deepEqual(optedIn, ['(authed-practice)/layout.tsx', '(authed-writing)/layout.tsx']);
  assert.match(read('public', 'js', 'practice.js'), /window\.lucide/,
    'practice remains the second explicit legacy consumer');
});

test('the public landing is native SVG and does not opt back into the UMD bundle', () => {
  assert.doesNotMatch(read('app', '(marketing)', 'layout.tsx'), /lucide\.min\.js/);
  assert.doesNotMatch(read('app', '(marketing)', 'page.tsx'), /data-lucide/);
  for (const icon of ['mic', 'pencil-line', 'book-marked', 'headphones', 'library', 'book-open']) {
    assert.match(read('app', '(marketing)', 'page.tsx'), new RegExp(`lucide-\\$\\{name\\}|name="${icon}"`));
  }
});


import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (...segments) => readFileSync(path.join(FRONTEND, ...segments), 'utf8');

test('root owns the sanctioned fonts through next/font variables', () => {
  const root = read('app', 'layout.tsx');
  assert.match(root, /from 'next\/font\/google'/);
  assert.match(root, /Plus_Jakarta_Sans/);
  assert.match(root, /JetBrains_Mono/);
  assert.match(root, /Lora/);
  assert.match(root, /className=\{`\$\{plusJakarta\.variable\}/);
  assert.match(root, /preload: false,[\s\S]*variable: '--font-lora'/,
    'long-form serif must not preload on every product route');
});

test('Next layouts no longer make runtime requests to Google Fonts', () => {
  for (const file of [
    ['components', 'authed-shell.tsx'],
    ['app', '(marketing)', 'layout.tsx'],
    ['app', '(public-auth)', 'layout.tsx'],
    ['app', '(public-content)', 'layout.tsx'],
  ]) {
    const source = read(...file);
    assert.doesNotMatch(source, /fonts\.(?:googleapis|gstatic)\.com/, file.join('/'));
  }
});

test('legacy documents retain a real fallback when next/font variables are absent', () => {
  const tokens = read('public', 'css', 'aver-design', 'tokens.css');
  assert.match(tokens, /var\(--font-plus-jakarta,\s*'Plus Jakarta Sans'\)/);
  assert.match(tokens, /var\(--font-jetbrains-mono,\s*'JetBrains Mono'\)/);
  assert.match(tokens, /var\(--font-lora,\s*'Lora'\)/);
});

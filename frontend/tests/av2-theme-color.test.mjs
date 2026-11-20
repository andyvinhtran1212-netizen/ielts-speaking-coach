// UIBASE-0056 G03-T18 part 2 (FR-026): the two theme-color values repeated in
// components/ui/theme-color.ts must equal --av2-paper of the light and dark
// blocks of styles/av2/tokens.css (a meta tag cannot read a CSS variable).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

function paperIn(css, selector) {
  const at = css.indexOf(selector);
  assert.ok(at >= 0, `${selector} block in tokens.css`);
  const block = css.slice(at, css.indexOf('}', at));
  const m = block.match(/--av2-paper:\s*(#[0-9A-Fa-f]{6})/);
  assert.ok(m, `--av2-paper in ${selector}`);
  return m[1].toUpperCase();
}

test('theme-color values equal --av2-paper of each mode', () => {
  const tokens = read('styles/av2/tokens.css');
  const ts = read('components/ui/theme-color.ts');
  const m = ts.match(/AV2_THEME_COLOR = Object\.freeze\(\{ light: '(#[0-9A-F]{6})', dark: '(#[0-9A-F]{6})' \}/);
  assert.ok(m, 'AV2_THEME_COLOR literal');
  assert.equal(m[1], paperIn(tokens, ':root[data-theme="light"]'));
  assert.equal(m[2], paperIn(tokens, ':root[data-theme="dark"]'));
});

test('the v2 anti-flash script is byte-identical to AuthedShell (no third av-theme value)', () => {
  const pick = (code, name) => code.match(new RegExp(`const ${name} = \`([\\s\\S]*?)\`\\.trim\\(\\);`))?.[1];
  const shell = pick(read('components/authed-shell.tsx'), 'ANTI_FLASH');
  const v2 = pick(read('components/ui/theme-script.tsx'), 'THEME_SCRIPT');
  assert.ok(shell && v2);
  assert.equal(v2, shell);
});

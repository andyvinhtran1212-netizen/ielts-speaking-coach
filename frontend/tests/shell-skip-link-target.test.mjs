// The "Bỏ qua tới nội dung" skip link of each av2 shell is a 44px target once
// focused (it was 42px: the padding alone). Source check because jsdom has no layout.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shells = ['focus-shell', 'learner-shell', 'public-shell'];

for (const shell of shells) {
  test(`${shell}: .skip has a 44px minimum height`, () => {
    const css = readFileSync(new URL(`../components/ui/shell/${shell}.module.css`, import.meta.url), 'utf8');
    const rule = css.match(/\.skip\s*\{([^}]*)\}/)?.[1] || '';
    assert.match(rule, /min-height:\s*var\(--av2-control-md\)/);
    assert.match(rule, /display:\s*inline-flex/);
  });
}

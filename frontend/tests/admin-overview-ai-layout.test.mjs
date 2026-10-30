import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Static CI guard. Browser measurements of the populated Next /admin page
// are recorded separately; jsdom cannot measure flex/table overflow.
const css = readFileSync(new URL('../public/css/admin-overview.css', import.meta.url), 'utf8');
const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)];

function declarationsFor(selector) {
  return rules
    .filter(([, selectors]) => selectors.split(',').some((value) => value.trim() === selector))
    .map(([, , declarations]) => declarations)
    .join('\n');
}

for (const selector of ['.ai-section', '.ai-panel', '.ai-window-panels', '.ai-table-wrap']) {
  test(`${selector} contains table intrinsic width within the overview`, () => {
    const declarations = declarationsFor(selector);
    assert.match(declarations, /(?:^|[;\s])min-width:\s*0\s*;/);
    assert.match(declarations, /(?:^|[;\s])max-width:\s*100%\s*;/);
  });
}

test('AI tables retain their own horizontal touch scroll container', () => {
  const declarations = declarationsFor('.ai-table-wrap');
  assert.match(declarations, /(?:^|[;\s])overflow-x:\s*auto\s*;/);
  assert.match(declarations, /(?:^|[;\s])-webkit-overflow-scrolling:\s*touch\s*;/);
});

test('offscreen AI table labels are positioned inside the scroll container', () => {
  // Without a positioned ancestor, the absolute .ai-visually-hidden labels
  // escape overflow-x:auto and widen the document even with a 1px clip.
  assert.match(declarationsFor('.ai-table-wrap'), /(?:^|[;\s])position:\s*relative\s*;/);
});

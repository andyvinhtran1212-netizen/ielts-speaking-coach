// T-GUARD (PC-J113 / FR-018): pin the two rules that keep the 40-question
// Listening palette from setting the testing shell's width.
//
// Before #1564 the shell's implicit grid column was `auto`, so the palette's
// min-content width (4 groups × 10 squares + controls) became the column width:
// the question pane measured 1522px at a 1440px viewport and the page, which is
// `overflow: hidden`, clipped content and the Submit button without a scrollbar.
// The fix is `.listening-next-shell.is-testing { grid-template-columns:
// minmax(0, 1fr) }` plus `.listening-next-palette { min-width: 0 }`.
//
// This test reads the effective cascade of every stylesheet the player layout
// loads, in layout order, so an override in any of them (or a media query at a
// desktop or mobile width) fails here. The browser geometry check is
// tooling/verify-listening-player-overflow-flow.mjs and the reading-native
// FR-018 Playwright specs.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const LAYOUT = readFileSync(new URL('../app/(authed-listening-player)/layout.tsx', import.meta.url), 'utf8');
const STYLESHEETS = [...LAYOUT.matchAll(/'\/css\/([\w.-]+\.css)'/g)].map(match => match[1]);
const css = STYLESHEETS.map(name => readFileSync(new URL(`../public/css/${name}`, import.meta.url), 'utf8'));

function stylesAtWidth(width) {
  const parser = new JSDOM(css.map(text => `<style>${text}</style>`).join(''));
  function applicable(rules) {
    return [...rules].flatMap(rule => {
      if (!rule.media) return rule.cssRules ? [] : [rule.cssText];
      const query = rule.media.mediaText;
      if (/prefers-|print|orientation/.test(query)) return [];
      const max = query.match(/max-width:\s*(\d+)px/);
      const min = query.match(/min-width:\s*(\d+)px/);
      return (!max || width <= Number(max[1])) && (!min || width >= Number(min[1]))
        ? applicable(rule.cssRules) : [];
    });
  }
  const selected = [...parser.window.document.styleSheets]
    .flatMap(sheet => applicable(sheet.cssRules)).join('\n');
  parser.window.close();
  return selected;
}

describe('Listening testing shell: the palette cannot widen the grid column', () => {
  test('the player layout still loads listening-test-next.css', () => {
    assert.ok(STYLESHEETS.includes('listening-test-next.css'), `layout stylesheets: ${STYLESHEETS.join(', ')}`);
  });

  for (const width of [1440, 1024, 780, 390]) {
    for (const preview of [false, true]) {
      test(`effective cascade at ${width}px${preview ? ' (admin preview)' : ''}`, () => {
        const dom = new JSDOM(`<style>${stylesAtWidth(width)}</style><body class="exam-chrome listening-exam-chrome listening-next-player-page listening-next-testing"><main class="listening-next-shell is-testing${preview ? ' is-preview' : ''}"><article class="ielts-test-paper" id="listening-paper"></article><footer class="listening-next-palette" role="navigation" aria-label="Question palette"><div class="listening-next-palette-groups"></div></footer></main></body>`);
        try {
          const { document, getComputedStyle } = dom.window;
          const shell = getComputedStyle(document.querySelector('.listening-next-shell'));
          const palette = getComputedStyle(document.querySelector('.listening-next-palette'));
          assert.equal(shell.display, 'grid');
          assert.equal(shell.gridTemplateColumns, 'minmax(0, 1fr)', 'an auto column takes the palette min-content width (1522px at 1440px before #1564)');
          assert.equal(shell.minWidth, '0');
          assert.equal(shell.overflow, 'hidden', 'the shell clips; containment must come from the column, not a scrollbar');
          assert.equal(palette.minWidth, '0', 'a grid item with min-width:auto refuses to shrink below its min-content width');
        } finally {
          dom.window.close();
        }
      });
    }
  }
});

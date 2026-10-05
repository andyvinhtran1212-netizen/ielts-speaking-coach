import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const css = ['ielts-test-paper.css', 'listening-test-next.css']
  .map(name => readFileSync(new URL(`../public/css/${name}`, import.meta.url), 'utf8'));

// JSDOM checks the real cascade declarations, not table geometry. The native
// source-bound browser sweep verifies intrinsic widths and trusted focus/scroll.
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

describe('Listening completion tables keep intrinsic width inside their local scrollport', () => {
  for (const width of [1180, 780, 390]) {
    test(`effective cascade at ${width}px constrains the grid item and preserves table/control geometry`, () => {
      const dom = new JSDOM(`<style>${stylesAtWidth(width)}</style><main class="listening-next-shell is-testing"><article class="ielts-test-paper"><section class="ielts-section"><section class="ielts-question-block" data-template-kind="table_completion"><div class="ielts-table-container"><table class="ielts-table"><thead><tr><th>Item</th><th>Details</th></tr></thead><tbody><tr><td>Original plain text</td><td><input class="ielts-gap-input" data-q-num="10" aria-label="Answer 10"></td></tr></tbody></table></div></section></section></article></main>`);
      try {
        const { document, getComputedStyle } = dom.window;
        const section = getComputedStyle(document.querySelector('.ielts-section'));
        const block = getComputedStyle(document.querySelector('.ielts-question-block'));
        const scrollport = getComputedStyle(document.querySelector('.ielts-table-container'));
        const table = getComputedStyle(document.querySelector('table'));
        const input = getComputedStyle(document.querySelector('input'));
        assert.equal(section.display, 'grid');
        assert.equal(block.minWidth, '0', 'grid auto-minimum must not grow the scrollport to the table min-content width');
        assert.notEqual(block.overflowX, 'hidden', 'authored content must remain reachable');
        assert.equal(scrollport.maxWidth, '100%');
        assert.equal(scrollport.overflowX, 'auto');
        assert.equal(scrollport.getPropertyValue('overscroll-behavior-inline'), 'contain');
        assert.equal(table.width, '100%');
        assert.equal(table.borderCollapse, 'collapse');
        assert.notEqual(table.tableLayout, 'fixed', 'do not squeeze authored table columns');
        assert.equal(input.minWidth, width <= 480 ? '118px' : '150px');
        assert.equal(document.querySelector('td').textContent, 'Original plain text');
        assert.equal(document.querySelectorAll('input').length, 1);
      } finally { dom.window.close(); }
    });
  }
});

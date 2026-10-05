import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const css = ['reading-exam-mockup.css', 'reading-review.css', 'reading-review-next.css']
  .map(name => readFileSync(new URL(`../public/css/${name}`, import.meta.url), 'utf8'));

function stylesAtWidth(width) {
  const parser = new JSDOM(css.map(text => `<style>${text}</style>`).join(''));
  function matching(rules) {
    return [...rules].flatMap(rule => {
      if (!rule.media) return rule.cssRules ? [] : [rule.cssText];
      const query = rule.media.mediaText;
      if (/prefers-|print|orientation/.test(query)) return [];
      const max = query.match(/max-width:\s*(\d+)px/);
      const min = query.match(/min-width:\s*(\d+)px/);
      return (!max || width <= Number(max[1])) && (!min || width >= Number(min[1]))
        ? matching(rule.cssRules) : [];
    });
  }
  const selected = [...parser.window.document.styleSheets]
    .flatMap(sheet => matching(sheet.cssRules)).join('\n');
  parser.window.close();
  return selected;
}

describe('Reading review palette preserves separate passage targets', () => {
  for (const width of [375, 390, 1180, 1280]) {
    test(`effective review cascade at ${width}px keeps fixed button tracks inside each group`, () => {
      let number = 0;
      const groups = [13, 13, 14].map(count => `<div class="exam-palette__group"><span class="exam-palette__group-label">Passage</span><div class="exam-palette__group-btns">${Array.from({ length: count }, () => `<button class="rr-nav-q">${++number}</button>`).join('')}</div></div>`).join('');
      const dom = new JSDOM(`<style>${stylesAtWidth(width)}</style><body class="exam-chrome"><footer class="exam-palette"><div class="exam-palette__grid">${groups}</div></footer></body>`);
      try {
        const { document, getComputedStyle } = dom.window;
        const grid = getComputedStyle(document.querySelector('.exam-palette__grid'));
        assert.equal(grid.display, 'flex');
        assert.equal(grid.overflowX, 'auto');
        for (const group of document.querySelectorAll('.exam-palette__group')) {
          const style = getComputedStyle(group);
          assert.equal(style.flexShrink, '0', 'passage groups must not shrink beneath their fixed button tracks');
          assert.equal(style.flexGrow, '0');
          assert.equal(style.flexBasis, 'auto');
          assert.equal(style.flexDirection, 'column');
          assert.equal(getComputedStyle(group.querySelector('.exam-palette__group-btns')).gridAutoColumns, '44px');
        }
        assert.deepEqual([...document.querySelectorAll('.rr-nav-q')].map(button => Number(button.textContent)), Array.from({ length: 40 }, (_, i) => i + 1));
      } finally { dom.window.close(); }
    });
  }
});

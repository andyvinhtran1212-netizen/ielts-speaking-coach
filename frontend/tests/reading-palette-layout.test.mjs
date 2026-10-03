import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const css = ['reading-exam-mockup.css', 'reading-exam.css', 'reading-exam-next.css']
  .map(name => readFileSync(fileURLToPath(new URL(`../public/css/${name}`, import.meta.url)), 'utf8'));

// Apply the real stylesheet cascade at each viewport. JSDOM does not evaluate
// media queries, so select only their matching width branches before computing
// layout declarations. Actual hit testing is covered by the native browser sweep.
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
  const selected = [...parser.window.document.styleSheets].flatMap(sheet => applicable(sheet.cssRules)).join('\n');
  parser.window.close();
  return selected;
}

describe('native Reading palette keeps part groups separate inside its scrollport', () => {
  for (const width of [1180, 1280, 390, 375]) {
    test(`effective cascade at ${width}px preserves nonshrinking groups and button targets`, () => {
      let qNum = 0;
      const groups = [13, 13, 14].map(count => `<div class="exam-palette__group"><span class="exam-palette__group-label">Part</span><div class="exam-palette__group-btns">${Array.from({ length: count }, () => `<button class="exam-palette__q" data-q="${++qNum}">${qNum}</button>`).join('')}</div></div>`).join('');
      const dom = new JSDOM(`<style>${stylesAtWidth(width)}</style><div class="exam-chrome reading-next-player-page"><footer class="exam-palette"><div class="exam-palette__grid">${groups}</div><div class="exam-palette__actions"></div></footer></div>`);
      try {
        const { document, getComputedStyle } = dom.window;
        const grid = getComputedStyle(document.querySelector('.exam-palette__grid'));
        assert.equal(grid.display, 'flex');
        assert.equal(grid.flexWrap, 'nowrap');
        assert.equal(grid.overflowX, 'auto');
        assert.equal(grid.minWidth, '0');
        for (const group of document.querySelectorAll('.exam-palette__group')) {
          const style = getComputedStyle(group);
          assert.equal(style.flexShrink, '0', 'fixed button tracks must not overflow a shrunken part group');
          assert.equal(style.flexGrow, '0');
          assert.equal(style.flexBasis, 'auto');
          assert.equal(style.flexDirection, 'column');
          const buttons = getComputedStyle(group.querySelector('.exam-palette__group-btns'));
          assert.equal(buttons.gridAutoColumns, width <= 760 ? '44px' : '30px');
        }
        for (const button of document.querySelectorAll('.exam-palette__q')) {
          const style = getComputedStyle(button);
          assert.equal(style.width, width <= 760 ? '44px' : '30px');
          assert.equal(style.height, width <= 760 ? '44px' : '30px');
        }
        assert.deepEqual([...document.querySelectorAll('.exam-palette__q')].map(button => Number(button.dataset.q)), Array.from({ length: 40 }, (_, i) => i + 1));
      } finally { dom.window.close(); }
    });
  }
});

describe('native Reading existing exam themes keep text and surfaces paired', () => {
  for (const theme of ['dark', 'yellow-on-blue']) {
    test(`${theme} uses exam surface and foreground tokens for questions, banks and answer controls`, () => {
      const dom = new JSDOM(`<style>${stylesAtWidth(390)}</style><body class="exam-chrome reading-next-player-page" data-exam-theme="${theme}"><section class="exam-questions"><div class="exam-questions__part-heading"><strong>2</strong></div><div class="exam-gap-box"><span class="exam-summary__gnum">20</span></div><div class="exam-diagram-container"></div><strong class="exam-headings-box__roman">i</strong><strong class="exam-features-box__roman">A</strong><strong class="exam-endings-box__roman">B</strong><strong class="exam-word-bank-box__roman">C</strong><span class="exam-q__option-prefix">A</span><select class="exam-q__select"><option>A</option></select><input class="exam-q__gap exam-q__gap--inline"><button class="reading-next-flow-flag" aria-pressed="false">Flag</button><button class="reading-next-flow-flag" aria-pressed="true">Flag</button></section></body>`);
      try {
        const { document, getComputedStyle } = dom.window;
        assert.equal(getComputedStyle(document.body).getPropertyValue('--exam-surface-page').trim(), 'var(--exam-surface-sunken)');
        assert.equal(getComputedStyle(document.body).getPropertyValue('--exam-border-default').trim(), 'var(--exam-border-strong)');
        for (const element of document.querySelectorAll('.exam-gap-box,.exam-diagram-container')) {
          assert.equal(getComputedStyle(element).background, 'var(--exam-surface-sunken)');
        }
        for (const element of document.querySelectorAll('strong,.exam-summary__gnum,select,.exam-q__option-prefix,input')) {
          assert.equal(getComputedStyle(element).color, 'var(--exam-text-primary)');
        }
        assert.equal(getComputedStyle(document.querySelector('input')).borderBottomColor, 'var(--exam-text-primary)');
        assert.equal(getComputedStyle(document.querySelector('button[aria-pressed="false"]')).color, 'var(--exam-text-muted)');
        assert.equal(getComputedStyle(document.querySelector('button[aria-pressed="true"]')).color, 'var(--av-warning)');
        // JSDOM caches a previously computed normal-state style across focus.
        // Read a fresh focused control; the native browser checks transitions.
        const input = document.createElement('input');
        input.className = 'exam-q__gap exam-q__gap--inline';
        document.querySelector('section').append(input);
        input.focus();
        assert.equal(getComputedStyle(input).outlineColor, 'var(--ielts-current-ring)');
      } finally { dom.window.close(); }
    });
  }
});

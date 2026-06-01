/**
 * frontend/tests/reading-translation-vi.test.mjs
 *
 * Display Passage Translation (translation_vi) — the full Vietnamese translation
 * carried in a reading passage's MD frontmatter is surfaced behind a "Xem bản
 * dịch tiếng Việt" toggle on BOTH page types (vocab-reading + skill-practice),
 * rendered inside the passage <article> so it scrolls with the passage pane.
 *
 * A. Toggle + collapsible VI block render (both page types), XSS-safe.
 * B. Graceful absence — no translation_vi → nothing rendered.
 * C. Token-driven, theme-aware styles in the shared reading-vocab.css.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

let css, vocabJs, skillJs;
before(() => {
  css     = read('frontend/css/reading-vocab.css');
  vocabJs = read('frontend/js/reading-vocab-passage.js');
  skillJs = read('frontend/js/reading-skill-exercise.js');
});

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('A — translation toggle + VI block (both page types)', () => {
  for (const [name, getJs] of [['vocab', () => vocabJs], ['skill', () => skillJs]]) {
    test(`${name}: reads passage.translation_vi and renders a toggle`, () => {
      const js = getJs();
      assert.match(js, /renderTranslation\(body, p\.translation_vi\)/);
      assert.match(js, /rv-translation__toggle/);
      assert.match(js, /rv-translation__body/);
      assert.match(js, /Xem bản dịch tiếng Việt/);
    });

    test(`${name}: collapsible — toggle flips hidden + aria-expanded`, () => {
      const js = getJs();
      assert.match(js, /panel\.hidden = !willOpen/);
      assert.match(js, /setAttribute\('aria-expanded'/);
      // appended into the passage <article> (body.parentNode), not the questions pane
      assert.match(js, /body\.parentNode\.appendChild\(wrap\)/);
    });

    test(`${name}: XSS-safe — prose via textContent, never innerHTML`, () => {
      const js = getJs();
      const fn = js.slice(js.indexOf('function renderTranslation'));
      const body = fn.slice(0, fn.indexOf('\n  }\n'));
      assert.match(body, /pEl\.textContent = t/);
      assert.ok(!/\.innerHTML\s*=/.test(body), 'renderTranslation must not use innerHTML');
    });
  }
});

describe('B — graceful absence', () => {
  for (const [name, getJs] of [['vocab', () => vocabJs], ['skill', () => skillJs]]) {
    test(`${name}: empty/missing translation_vi renders nothing`, () => {
      const js = getJs();
      // early-return guard before any DOM is built
      assert.match(js, /var text = \(translationVi \|\| ''\)\.trim\(\);\s*\n\s*if \(!text/);
    });
  }
});

describe('C — token-driven, theme-aware styles', () => {
  test('toggle + body styles exist and use design tokens', () => {
    const c = stripComments(css);
    assert.match(c, /\.rv-translation__toggle\s*\{[\s\S]{0,400}var\(--av-/);
    assert.match(c, /\.rv-translation__body\s*\{[\s\S]{0,400}var\(--av-/);
  });

  test('no undefined --av-space tokens (scale skips 5/7/9/…)', () => {
    const block = stripComments(css).match(/\.rv-translation[\s\S]*?(?=\n\.rv-questions)/);
    assert.ok(block, 'translation block present');
    assert.ok(!/--av-space-(5|7|9|10|11|13|14|15)\b/.test(block[0]),
      'translation styles must not reference undefined spacing tokens');
  });
});

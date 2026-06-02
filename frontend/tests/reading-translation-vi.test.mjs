/**
 * frontend/tests/reading-translation-vi.test.mjs
 *
 * Display Passage Translation (translation_vi) — the full Vietnamese translation
 * carried in a reading passage's MD frontmatter is surfaced on BOTH page types
 * (vocab-reading + skill-practice).
 *
 * reading-l1l2-grammar-toggle UPDATE: the standalone "Xem bản dịch" collapsible
 * panel was subsumed into the shared 3-toggle pane swapper (Gốc / Dịch /
 * Grammar) — the translation is now the "Bài dịch" pane of that bar. This file
 * keeps the translation_vi contract (both pages surface it; XSS-safe; graceful
 * absence; token-driven styles); the full toggle BEHAVIOUR is covered in
 * reading-l1l2-grammar-toggle.test.mjs.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

let css, vocabJs, skillJs, panesJs;
before(() => {
  css     = read('frontend/css/reading-vocab.css');
  vocabJs = read('frontend/js/reading-vocab-passage.js');
  skillJs = read('frontend/js/reading-skill-exercise.js');
  panesJs = read('frontend/js/components/reading-passage-panes.js');
});

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('A — translation_vi surfaced via the shared pane toggle (both page types)', () => {
  for (const [name, getJs] of [['vocab', () => vocabJs], ['skill', () => skillJs]]) {
    test(`${name}: passes passage.translation_vi into ReadingPanes.mount`, () => {
      const js = getJs();
      assert.match(js, /window\.ReadingPanes\.mount\(\{/);
      assert.match(js, /translationVi:\s*p\.translation_vi/);
    });
  }
  test('the shared module builds a "Bài dịch" pane', () => {
    assert.match(panesJs, /Bài dịch/);
    assert.match(panesJs, /rv-pane--vi/);
  });
});

describe('A — XSS-safe (translation prose via textContent, never innerHTML)', () => {
  test('the VI pane builder uses textContent for prose', () => {
    const fn = panesJs.slice(panesJs.indexOf('function _viPane'));
    const body = fn.slice(0, fn.indexOf('\n  }\n'));
    assert.match(body, /p\.textContent = t/);
    assert.ok(!/\.innerHTML\s*=/.test(body), '_viPane must not use innerHTML');
  });
});

describe('B — graceful absence', () => {
  test('no translation AND no grammar → the toggle bar is not mounted', () => {
    // mount() early-returns null when neither extra exists.
    assert.match(panesJs, /if \(!hasVi && !hasGrammar\) return null/);
  });
});

describe('C — token-driven, theme-aware styles', () => {
  test('VI pane styles exist and use design tokens', () => {
    const c = stripComments(css);
    assert.match(c, /\.rv-pane--vi\s*\{[\s\S]{0,400}var\(--av-/);
  });
  test('no undefined --av-space tokens (scale skips 5/7/9/…)', () => {
    const block = stripComments(css).match(/\.rv-panes[\s\S]*?(?=\n\.rv-questions)/);
    assert.ok(block, 'pane block present');
    assert.ok(!/--av-space-(5|7|9|10|11|13|14|15)\b/.test(block[0]),
      'pane styles must not reference undefined spacing tokens');
  });
});

/**
 * frontend/tests/reading-content-rich-layout.test.mjs
 *
 * A. Rich glossary — the shared GlossaryPopover renders IPA + part-of-speech
 *    (từ loại) + Vietnamese definition + example + synonyms when present
 *    (rainbow format), gracefully skipping absent fields (tea format). XSS-safe
 *    (textContent only).
 * B. 2-pane independent scroll — .rv-passage-layout (shared by vocab-reading +
 *    skill-practice) gives the passage <article> and the .rv-questions aside
 *    their own scrollbars on desktop, stacking to one normal-scroll column on
 *    mobile. The reading-progress bar tracks the passage pane.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

let popJs, css, vocabJs, skillJs;
before(() => {
  popJs   = read('frontend/js/components/glossary-popover.js');
  css     = read('frontend/css/reading-vocab.css');
  vocabJs = read('frontend/js/reading-vocab-passage.js');
  skillJs = read('frontend/js/reading-skill-exercise.js');
});


describe('A — rich glossary (shared GlossaryPopover, both page types)', () => {
  test('renders IPA + pos + synonyms (rich rainbow fields)', () => {
    assert.match(popJs, /entry\.ipa/);
    assert.match(popJs, /entry\.pos/);
    assert.match(popJs, /entry\.synonyms/);
    assert.match(popJs, /glossary-popover__ipa/);
    assert.match(popJs, /glossary-popover__pos/);
    assert.match(popJs, /glossary-popover__syn/);
  });

  test('rich fields are conditional → graceful for the simpler (tea) format', () => {
    assert.match(popJs, /if \(entry\.ipa \|\| entry\.pos\)/);   // meta row only when present
    assert.match(popJs, /if \(syns\)/);                          // synonyms only when present
    // definition + example were already conditional/present; still there.
    assert.match(popJs, /entry\.definition/);
    assert.match(popJs, /if \(entry\.example\)/);
  });

  test('XSS-safe — fields set via textContent, never innerHTML', () => {
    assert.ok(!/\.innerHTML\s*=/.test(popJs), 'GlossaryPopover must not use innerHTML');
    assert.match(popJs, /ipaEl\.textContent/);
    assert.match(popJs, /posEl\.textContent/);
    assert.match(popJs, /synEl\.textContent/);
  });

  test('synonyms accepts an array or a comma string', () => {
    assert.match(popJs, /Array\.isArray\(syns\)/);
  });

  test('glossary field styles are token-driven', () => {
    assert.match(css, /\.glossary-popover__ipa\s*\{[\s\S]{0,120}var\(--av-font-mono\)/);
    assert.match(css, /\.glossary-popover__pos\s*\{[\s\S]{0,120}var\(--av-/);
    assert.match(css, /\.glossary-popover__syn\s*\{/);
  });
});


describe('B — 2-pane independent scroll (shared layout)', () => {
  test('desktop: passage article + questions aside each scroll independently', () => {
    assert.match(css, /\.rv-passage-layout\s*\{[\s\S]{0,700}height:\s*calc\(100dvh/);
    assert.match(css, /\.rv-passage-layout > article,[\s\S]{0,120}overflow-y:\s*auto/);
    // the old sticky aside is replaced by independent scroll
    assert.ok(!/\.rv-questions\s*\{[\s\S]{0,80}position:\s*sticky/.test(css),
      'rv-questions should no longer be position:sticky (independent scroll instead)');
  });

  test('mobile: stacks to one column with normal page scroll', () => {
    assert.match(css, /@media \(max-width: 860px\)[\s\S]{0,400}\.rv-passage-layout \{[\s\S]{0,120}height:\s*auto/);
    assert.match(css, /@media \(max-width: 860px\)[\s\S]{0,500}overflow-y:\s*visible/);
  });

  test('progress bar tracks the passage pane (both page types)', () => {
    for (const js of [vocabJs, skillJs]) {
      assert.match(js, /querySelector\('\.rv-passage-layout > article'\)/);
      // capture-phase document listener catches the pane's (non-bubbling) scroll
      assert.match(js, /document\.addEventListener\('scroll', updateProgress, \{ passive: true, capture: true \}\)/);
    }
  });

  test('both page types use the same shared layout (.rv-passage-layout)', () => {
    assert.match(read('frontend/pages/reading-vocab-passage.html'), /class="rv-passage-layout"/);
    assert.match(read('frontend/pages/reading-skill-exercise.html'), /class="rv-passage-layout"/);
  });
});

/**
 * frontend/tests/preview-modal-closure.test.mjs — Sprint 6.11b.
 *
 * Run with: node --test frontend/tests/preview-modal-closure.test.mjs
 *
 * Closes the Sprint 6.11a documented seam — the JS-rendered preview
 * modal in _renderPreviewModal() inside js/my-vocabulary.js. Sprint
 * 6.11a left it on legacy dark styling because it lived entirely
 * inside a JS template literal with ~15 nested inline styles. Sprint
 * 6.11b migrates the template literals to class hooks (mv-preview-*)
 * and adds the matching rules to my-vocabulary.css so the modal
 * themes both light + dark.
 *
 * The DOM structure + close button id (#fc-preview-close) + event
 * wiring are byte-identical so the open/close handlers still work.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');


let js;
let css;

before(() => {
  js  = readFileSync(path.join(REPO_ROOT, 'frontend/js/my-vocabulary.js'),  'utf8');
  css = readFileSync(path.join(REPO_ROOT, 'frontend/css/my-vocabulary.css'), 'utf8');
});


describe('_renderPreviewModal / class hooks emitted instead of inline styles', () => {
  // The function should now emit class names — verify the canonical
  // set is present and no inline `style="…"` literals remain inside
  // the template-literal body.
  test('function exists', () => {
    assert.match(js, /function\s+_renderPreviewModal/);
  });

  test('modal element uses .mv-preview-modal class', () => {
    assert.match(js, /modal\.className\s*=\s*['"]mv-preview-modal['"]/);
  });

  test('emits .mv-preview-modal__panel + .mv-preview-modal__close', () => {
    assert.match(js, /class=["']mv-preview-modal__panel["']/);
    assert.match(js, /class=["']mv-preview-modal__close["']/);
  });

  test('emits front + back face class hooks', () => {
    assert.match(js, /class=["']mv-preview-face mv-preview-face--front["']/);
    assert.match(js, /class=["']mv-preview-face mv-preview-face--back["']/);
    assert.match(js, /class=["']mv-preview-face__label["']/);
    assert.match(js, /class=["']mv-preview-face__headword["']/);
  });

  test('emits IPA / def-vi / def-en / example / context / no-back class hooks', () => {
    assert.match(js, /class=["']mv-preview-ipa["']/);
    assert.match(js, /class=["']mv-preview-def-vi["']/);
    assert.match(js, /class=["']mv-preview-def-en["']/);
    assert.match(js, /class=["']mv-preview-example["']/);
    assert.match(js, /class=["']mv-preview-context["']/);
    assert.match(js, /class=["']mv-preview-no-back["']/);
  });

  test('no inline style="…" attrs remain inside _renderPreviewModal', () => {
    // Isolate the function body; modal.style.cssText assignment was
    // also removed in favour of the .mv-preview-modal class.
    const fnMatch = js.match(/function\s+_renderPreviewModal[\s\S]*?\n  \}\s*\n/);
    assert.ok(fnMatch, '_renderPreviewModal function body not found');
    const body = fnMatch[0];
    assert.ok(
      !/style=["']/.test(body),
      '_renderPreviewModal still emits inline style="…" attrs',
    );
    assert.ok(
      !/modal\.style\.cssText/.test(body),
      '_renderPreviewModal still uses modal.style.cssText',
    );
  });

  test('no hardcoded hex / rgba color literals in _renderPreviewModal', () => {
    const fnMatch = js.match(/function\s+_renderPreviewModal[\s\S]*?\n  \}\s*\n/);
    assert.ok(fnMatch);
    const body = fnMatch[0];
    assert.ok(!/#[0-9a-fA-F]{3,6}/.test(body), 'hex literals leaked');
    assert.ok(!/rgba\(\s*\d/.test(body), 'rgba literals leaked');
  });

  test('close-button id preserved (#fc-preview-close — event wiring still binds)', () => {
    assert.match(js, /id=["']fc-preview-close["']/);
    assert.match(js, /querySelector\(['"]#fc-preview-close['"]\)/);
  });
});


describe('my-vocabulary.css / preview-modal rules defined', () => {
  const required = [
    '.mv-preview-modal',
    '.mv-preview-modal__panel',
    '.mv-preview-modal__close',
    '.mv-preview-face',
    '.mv-preview-face--front',
    '.mv-preview-face--back',
    '.mv-preview-face__label',
    '.mv-preview-face__headword',
    '.mv-preview-ipa',
    '.mv-preview-def-vi',
    '.mv-preview-def-en',
    '.mv-preview-example',
    '.mv-preview-context',
    '.mv-preview-no-back',
  ];
  for (const sel of required) {
    test(`${sel} rule exists`, () => {
      assert.match(
        css,
        new RegExp(sel.replace(/[.\-]/g, m => '\\' + m)),
        `Missing CSS rule for ${sel}`,
      );
    });
  }

  test('all preview-modal rules use --av-* tokens (no hardcoded literals)', () => {
    // Slice the .mv-preview-modal block by finding the section
    // between its first selector and the ds.css override block at
    // the bottom of the file.
    const previewBlock = css.match(/\/\* ── Preview-flashcard modal[\s\S]*?\/\* ── Sprint 6\.5\.1/);
    assert.ok(previewBlock, 'Preview-modal CSS block not found');
    const block = previewBlock[0];
    const bad = block.match(/^\s*(?:color|background|border)\s*:[^;]*(?:#[0-9a-fA-F]{3,6}|rgba\(\s*255|rgba\(\s*0\s*,\s*0\s*,\s*0)/gm) || [];
    // The block legitimately uses var(--av-…) — strip those before the check.
    const filtered = bad.filter(line => !/var\(--av-/.test(line));
    assert.deepEqual(filtered, [], `Hardcoded literals in preview-modal CSS: ${filtered.join(' | ')}`);
  });
});

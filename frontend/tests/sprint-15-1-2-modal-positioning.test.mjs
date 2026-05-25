/**
 * frontend/tests/sprint-15-1-2-modal-positioning.test.mjs — Sprint 15.1.2 hotfix
 *
 * The Sprint 15.1 phoneme drill-down modal rendered bottom-left with no backdrop
 * in dogfood, even though its hand-rolled position:fixed overlay CSS was correct
 * in source — an environment-specific failure (stacking / containing-block /
 * stale CSS) that source-scan tests cannot catch (the F4 browser-test gap).
 *
 * Fix: render via the native <dialog> + showModal(), which lives in the browser
 * top layer (viewport-centered regardless of ancestors, native ::backdrop /
 * focus-trap / ESC). These sentinels pin that structural fix. NOTE: no
 * source-scan can confirm "centered on screen" — that still needs F4.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const front = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const DRILL = front('js', 'pronunciation-drilldown.js');
const DS_CSS = front('css', 'ds.css');


describe('Sprint 15.1.2 — native <dialog> modal (top-layer positioning)', () => {

  test('opens a native <dialog> via showModal()', () => {
    assert.match(DRILL, /createElement\(\s*['"]dialog['"]\s*\)/);
    assert.match(DRILL, /\.showModal\s*\(/);
  });

  test('the broken hand-rolled .ds-modal-backdrop overlay is gone (JS + CSS)', () => {
    // The bottom-left bug came from a custom position:fixed overlay div.
    assert.doesNotMatch(DRILL, /ds-modal-backdrop/,
      'must not recreate the custom backdrop div — use the native dialog ::backdrop');
    assert.doesNotMatch(DS_CSS, /\.ds-modal-backdrop\s*\{/,
      'the .ds-modal-backdrop rule must be removed');
  });

  test('dim comes from the native ::backdrop with a theme token', () => {
    assert.match(DS_CSS, /\.ds-modal::backdrop\s*\{[^}]*var\(--av-surface-overlay\)/);
  });

  test('.ds-modal sets no position (UA centers the modal dialog in the top layer)', () => {
    const block = DS_CSS.match(/\.ds-modal\s*\{[^}]*\}/);
    assert.ok(block, '.ds-modal rule not found');
    assert.doesNotMatch(block[0], /position\s*:/,
      'do not set position on the dialog — let showModal() center it');
  });

  test('closes on outside-click (backdrop region) and on the close button', () => {
    assert.match(DRILL, /getBoundingClientRect\(\)/);   // outside-click hit-test
    assert.match(DRILL, /data-pron-close/);
    assert.match(DRILL, /dlg\.close\(\)/);
  });

  test('cleanup + focus return wired on the native close event (ESC included)', () => {
    assert.match(DRILL, /addEventListener\(\s*['"]close['"]/);
    assert.match(DRILL, /_lastTrigger[\s\S]{0,80}\.focus\(\)/);
  });

  test('graceful fallback when showModal is unavailable', () => {
    assert.match(DRILL, /typeof dlg\.showModal === ['"]function['"]/);
  });

});

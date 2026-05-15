/**
 * frontend/tests/pending-vocab.test.mjs
 *
 * Sprint 10.4 — pin the capture confirmation panel contract.
 *
 * Pattern matches vocab-module-loader.test.mjs and
 * my-vocab-optimistic-mastery.test.mjs — sentinel-style string
 * assertions against the module source so a regression that drops
 * the optimistic fade, the empty-list early-return, or the
 * bulk-confirm flow fails here loudly.
 *
 * Surfaces under test:
 *   1. Module exports mount(container, opts) and the result.html
 *      inline script invokes it after the result data loads.
 *   2. Empty pending list → panel stays hidden (no empty-state UI).
 *   3. Each card has Keep + Drop buttons; "Giữ tất cả" lives in the
 *      panel header.
 *   4. Keep/Drop use optimistic fade before the POST.
 *   5. Network failure path restores the card and shows flashToast.
 *   6. Vietnamese copy strings present (Giữ, Bỏ, Giữ tất cả, the
 *      24h auto-commit notice).
 *   7. result.html wires the dynamic import to the pending-vocab
 *      mount target.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = join(__dirname, '..', 'js', 'pending-vocab.js');
const RESULT_HTML_PATH = join(__dirname, '..', 'pages', 'result.html');
const CSS_PATH = join(__dirname, '..', 'css', 'result.css');

const MODULE_SRC = readFileSync(MODULE_PATH, 'utf8');
const RESULT_HTML = readFileSync(RESULT_HTML_PATH, 'utf8');
const RESULT_CSS = readFileSync(CSS_PATH, 'utf8');


describe('Sprint 10.4 — pending vocab module surface', () => {

  it('exports mount(container, opts)', () => {
    assert.ok(
      /export\s+async\s+function\s+mount\s*\(\s*container\s*,\s*opts/.test(MODULE_SRC),
      'pending-vocab.js must export async mount(container, opts).',
    );
  });

  it('empty pending list short-circuits — no empty-state UI', () => {
    // Andy spec § 8: "If pending list empty: skip section entirely
    // (don't render empty state)". Pin via the array-length guard.
    assert.ok(
      MODULE_SRC.includes('items.length === 0'),
      'mount() must short-circuit on items.length === 0.',
    );
  });

  it('renders Keep + Drop + Keep-all controls', () => {
    assert.ok(
      MODULE_SRC.includes('data-action="keep"') &&
      MODULE_SRC.includes('data-action="drop"') &&
      MODULE_SRC.includes('data-action="keep-all"'),
      'Per-card keep/drop AND batch keep-all actions must be wired.',
    );
  });

  it('Vietnamese copy strings present (no English bleed)', () => {
    assert.ok(MODULE_SRC.includes('Từ vựng mới ghi nhận'),
      'Section title "Từ vựng mới ghi nhận" must appear.');
    assert.ok(MODULE_SRC.includes('Giữ tất cả'),
      'Batch button label "Giữ tất cả" must appear.');
    assert.ok(MODULE_SRC.includes('>Giữ<'),
      'Per-card "Giữ" label must appear.');
    assert.ok(MODULE_SRC.includes('>Bỏ<'),
      'Per-card "Bỏ" label must appear.');
    assert.ok(MODULE_SRC.includes('Tự động lưu sau 24h'),
      'Auto-commit notice text must appear.');
  });

  it('optimistic update: fade card before awaiting POST', () => {
    // Pattern: fadeCard(card) is called BEFORE `await apiJson` so the
    // UI flips synchronously. Pin via textual order in keepItem.
    const keepBlock = _extractFunctionBody('async function keepItem');
    const fadeIdx = keepBlock.indexOf('fadeCard(card)');
    const awaitIdx = keepBlock.indexOf('await apiJson');
    assert.ok(fadeIdx !== -1, 'keepItem must fade the card.');
    assert.ok(awaitIdx !== -1, 'keepItem must POST confirm.');
    assert.ok(
      fadeIdx < awaitIdx,
      'Optimistic fade must run BEFORE awaiting the POST.',
    );
  });

  it('rollback path restores card and shows flashToast on failure', () => {
    const keepBlock = _extractFunctionBody('async function keepItem');
    assert.ok(
      keepBlock.includes('restoreCard(card)'),
      'keepItem catch branch must restore the faded card.',
    );
    assert.ok(
      /flashToast\(/.test(keepBlock) && keepBlock.includes("'error'"),
      'keepItem catch branch must show an error toast.',
    );
    // Symmetry: drop path follows the same pattern.
    const dropBlock = _extractFunctionBody('async function dropItem');
    assert.ok(
      dropBlock.includes('restoreCard(card)') && /flashToast\(/.test(dropBlock),
      'dropItem must also rollback + toast on failure.',
    );
  });

  it('bulk-confirm posts the visible IDs in one batch', () => {
    const block = _extractFunctionBody('async function keepAll');
    assert.ok(
      block.includes("/pending/bulk-confirm"),
      'keepAll must POST to /pending/bulk-confirm.',
    );
    assert.ok(
      block.includes('ids: ids'),
      'keepAll must send the IDs payload.',
    );
    // All cards fade together before the await.
    assert.ok(
      block.indexOf('cards.forEach(fadeCard)') < block.indexOf('await apiJson'),
      'keepAll must fade all cards before awaiting the bulk POST.',
    );
  });
});


describe('Sprint 10.4 — result.html integration', () => {

  it('result.html ships the pending-vocab-mount container', () => {
    assert.ok(
      RESULT_HTML.includes('id="pending-vocab-mount"'),
      'result.html must expose the mount target div.',
    );
    assert.ok(
      /id="pending-vocab-mount"[^>]*\bclass="[^"]*\bhidden\b/.test(RESULT_HTML),
      'Mount target must start hidden — module unhides on non-empty fetch.',
    );
  });

  it('result.html dynamically imports pending-vocab.js after load', () => {
    assert.ok(
      RESULT_HTML.includes("import('../js/pending-vocab.js')"),
      'result.html inline script must dynamic-import the module.',
    );
    assert.ok(
      RESULT_HTML.includes('mod.mount('),
      'The import .then(...) must invoke mount().',
    );
  });

  it('result.css ships the .pending-panel styling', () => {
    assert.ok(
      RESULT_CSS.includes('.pending-panel'),
      'result.css must style .pending-panel.',
    );
    assert.ok(
      RESULT_CSS.includes('.pending-card--leaving'),
      'result.css must define the fade-out transition class.',
    );
  });
});


// ── Helpers ──────────────────────────────────────────────────────────

function _extractFunctionBody(declarationPrefix) {
  // Find the function body by matching the first { after the
  // declaration and walking braces. Works for `async function foo`
  // and `function foo`.
  const start = MODULE_SRC.indexOf(declarationPrefix);
  if (start === -1) throw new Error(`Not found: ${declarationPrefix}`);
  let depth = 0;
  let inFn = false;
  for (let i = start; i < MODULE_SRC.length; i++) {
    const c = MODULE_SRC[i];
    if (c === '{') { depth++; inFn = true; }
    else if (c === '}') {
      depth--;
      if (inFn && depth === 0) return MODULE_SRC.slice(start, i + 1);
    }
  }
  throw new Error(`No closing brace for ${declarationPrefix}`);
}

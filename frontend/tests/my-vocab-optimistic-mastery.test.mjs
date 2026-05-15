/**
 * frontend/tests/my-vocab-optimistic-mastery.test.mjs
 *
 * Sprint 10.2.1-hotfix — pin the optimistic mastery-toggle contract.
 *
 * Pre-10.2.1 flow (slow):
 *   1. button click  → 2. await PATCH /{id}  → 3. await GET /stats
 *   → 4. renderList. ~800ms perceived lag on prod.
 *
 * Post-10.2.1 flow (instant):
 *   1. button click  → 2. flip item.mastery_status optimistically
 *   → 3. _shiftStatCounter in-place  → 4. renderList synchronously
 *   → 5. PATCH in the background  → 6. (rare) reconcile on mismatch
 *   → 7. (failure) rollback + flashToast.
 *
 * The sentinel below asserts the new source shape so a regression
 * that re-introduces `await loadStats()` on the toggle path or drops
 * the rollback branch fails loudly here. Pattern matches the existing
 * `vocab-module-loader.test.mjs` sentinel style (string assertions on
 * the module source) — no jsdom, no module loader.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MY_VOCAB_PATH = join(__dirname, '..', 'js', 'vocab-modules', 'my-vocab.js');
const SOURCE = readFileSync(MY_VOCAB_PATH, 'utf8');

describe('Sprint 10.2.1-hotfix — optimistic mastery toggle', () => {

  it('toggleMastery flips item.mastery_status before awaiting the PATCH', () => {
    // The optimistic flip must happen synchronously before the await.
    // We can't actually run the function in this test environment,
    // but we can pin the textual ordering: the optimistic assignment
    // appears in the source BEFORE the await apiFetch call inside
    // toggleMastery.
    const toggleBlock = _extractFunctionBody('toggleMastery');
    const optimisticIdx = toggleBlock.indexOf('item.mastery_status = optimisticStatus');
    const awaitIdx = toggleBlock.indexOf('await apiFetch');
    assert.notEqual(optimisticIdx, -1, 'optimistic assignment must exist');
    assert.notEqual(awaitIdx, -1, 'PATCH await must exist');
    assert.ok(
      optimisticIdx < awaitIdx,
      'optimistic flip must happen BEFORE awaiting the PATCH ' +
      `(optimistic at ${optimisticIdx}, await at ${awaitIdx})`,
    );
  });

  it('toggleMastery does NOT call loadStats() on the success path', () => {
    // Pre-10.2.1 the handler awaited a GET /stats after each PATCH.
    // The new flow updates the counter locally via _shiftStatCounter,
    // so loadStats() must not appear inside toggleMastery.
    const toggleBlock = _extractFunctionBody('toggleMastery');
    assert.ok(
      !toggleBlock.includes('loadStats('),
      'toggleMastery must not GET /stats — optimistic counter only.',
    );
  });

  it('toggleMastery sends {mastered} payload (Sprint 10.2 contract)', () => {
    const toggleBlock = _extractFunctionBody('toggleMastery');
    assert.ok(
      toggleBlock.includes("JSON.stringify({ mastered })"),
      'PATCH body must serialize the boolean toggle as {mastered}.',
    );
    assert.ok(
      !toggleBlock.includes('mastery_status: newStatus'),
      'Legacy Sprint 6.x payload {mastery_status: ...} must not return.',
    );
  });

  it('toggleMastery has a rollback branch with flashToast on failure', () => {
    // The catch block must restore the previous status AND surface a
    // visible error so the user knows the click didn't stick.
    const toggleBlock = _extractFunctionBody('toggleMastery');
    assert.ok(
      toggleBlock.includes('catch'),
      'toggleMastery must have a catch block for rollback.',
    );
    assert.ok(
      toggleBlock.includes('item.mastery_status = prevStatus'),
      'Catch branch must roll back the optimistic flip.',
    );
    assert.ok(
      toggleBlock.includes("flashToast(") && toggleBlock.includes("'error'"),
      'Rollback path must surface an error toast.',
    );
  });

  it('toggleMastery reconciles when server-derived differs from optimistic', () => {
    // Server stays authoritative as a tie-breaker. If derive_mastery
    // tweaks the rule, the response value wins and the UI corrects
    // itself without a full refetch.
    const toggleBlock = _extractFunctionBody('toggleMastery');
    assert.ok(
      /resp\.mastery_status !== optimisticStatus/.test(toggleBlock),
      'Success path must compare server-derived status to optimistic.',
    );
  });

  it('_shiftStatCounter helper exists and updates DOM counters in place', () => {
    // Pin the counter-update path. The helper is what replaces the
    // GET /stats round-trip on every click; if a refactor inlines or
    // drops it, this test fails before the perf regression hits prod.
    assert.ok(
      SOURCE.includes('function _shiftStatCounter('),
      '_shiftStatCounter helper must exist as the optimistic counter path.',
    );
    assert.ok(
      SOURCE.includes('[data-stat="mastered"]') &&
      SOURCE.includes('[data-stat="learning"]'),
      'Counter helper must read/write the canonical stat selectors.',
    );
  });
});

// ── Helpers ──────────────────────────────────────────────────────────

function _extractFunctionBody(name) {
  // Naive brace-matching extractor. Sufficient because the
  // toggleMastery function lives in a single-level closure and the
  // module body is a long IIFE — the start tag is unique. Returns
  // everything from the function declaration to the matching close
  // brace at depth 0.
  const startMarker = `async function ${name}(`;
  const start = SOURCE.indexOf(startMarker);
  if (start === -1) {
    throw new Error(`Could not find function ${name} in my-vocab.js`);
  }
  let depth = 0;
  let inFn = false;
  for (let i = start; i < SOURCE.length; i++) {
    const c = SOURCE[i];
    if (c === '{') {
      depth++;
      inFn = true;
    } else if (c === '}') {
      depth--;
      if (inFn && depth === 0) {
        return SOURCE.slice(start, i + 1);
      }
    }
  }
  throw new Error(`Could not find matching close brace for ${name}`);
}

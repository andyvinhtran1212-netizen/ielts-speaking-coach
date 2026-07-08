/**
 * frontend/tests/admin-polish.test.mjs
 *
 * Item 1 — dashboard visual polish: valid spacing tokens (no skipped-step
 *   --av-space-* that resolve to nothing → broken padding), consistent card
 *   radius, and the "Cần chú ý" block wrapper that hugs its title to its cards.
 * Item 2 — reading preview discoverability: preview is reachable from passage
 *   rows in ANY view via the backend-resolved parent_test_id (404-safe — never
 *   the passage slug); delete stays L3-tab-only.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

let dashHtml, listJs, readingRouter;
before(() => {
  // dashboard-consolidation — the ops Dashboard merged into the unified Tổng quan.
  dashHtml      = read('frontend/pages/admin/index.html');
  listJs        = read('frontend/js/admin-reading.js');
  readingRouter = read('backend/routers/admin_reading.py');
});


describe('Item 1 — dashboard spacing/border polish', () => {
  test('no skipped-step --av-space tokens (those resolve to nothing → broken padding)', () => {
    assert.ok(
      !/var\(--av-space-(5|7|9|10|11|13|14|15)\)/.test(dashHtml),
      'dashboard must not use --av-space-5/7/9/… — the scale skips them, so the value is undefined',
    );
  });

  test('shell + cards + panels use real spacing tokens', () => {
    assert.match(dashHtml, /\.overview-shell[\s\S]{0,160}gap:\s*var\(--av-space-6\)/);
    assert.match(dashHtml, /\.db-card\s*\{[\s\S]{0,200}padding:\s*var\(--av-space-6\)/);
    assert.match(dashHtml, /\.db-trends\s*\{[\s\S]{0,200}padding:\s*var\(--av-space-6\)/);
  });

  test('all dashboard cards share one radius (consistent borders)', () => {
    // KPI tiles, trends panel, and attention cards all radius-lg.
    assert.match(dashHtml, /\.db-card\s*\{[\s\S]{0,200}border-radius:\s*var\(--av-radius-lg\)/);
    assert.match(dashHtml, /\.db-trends\s*\{[\s\S]{0,200}border-radius:\s*var\(--av-radius-lg\)/);
    assert.match(dashHtml, /\.db-attn-card\s*\{[\s\S]{0,260}border-radius:\s*var\(--av-radius-lg\)/);
  });

  test('"Cần chú ý" block wrapper hugs the title to its cards', () => {
    assert.match(dashHtml, /\.db-block\s*\{[\s\S]{0,160}gap:\s*var\(--av-space-3\)/);
    assert.match(dashHtml, /<div class="db-block">[\s\S]{0,200}db-section-title[\s\S]{0,200}db-attention/);
  });

  test('banner still uses the canonical --av-error (no --av-color-error regression)', () => {
    const live = dashHtml.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/--av-color-error/.test(live));
  });
});


describe('Item 2 — L3 grouped as test rows (consistent + 404-safe)', () => {
  // l3-action-consistency superseded the parent_test_id approach: the backend
  // now groups L3 into ONE normalised test row per test (slug === test_id) in
  // every view, so the frontend gives L3 the same preview+edit+delete as L1/L2,
  // gated on it.library, with no passage-vs-test ambiguity.
  test('backend groups L3 into a normalised test row (slug ← test_id); excludes raw L3 passages', () => {
    assert.match(readingRouter, /def _normalise_l3_test_row/);
    assert.match(readingRouter, /"slug":\s*r\.get\("test_id"\)/);          // slug ← test_id
    assert.match(readingRouter, /\.neq\(\s*"library",\s*"l3_test"\s*\)/);  // "Tất cả" drops raw l3 passages
    assert.match(readingRouter, /_l3_test_rows\(status\)/);                // splice in the test rows
  });

  test('frontend previews L3 by its test_id (it.slug), gated on it.library', () => {
    assert.match(listJs, /it\.library === 'l3_test' && it\.slug/);
    assert.match(listJs, /preview\.html\?test_id=[\s\S]{0,60}encodeURIComponent\(it\.slug\)/);
    // the obsolete tab-gating + parent_test_id mechanism is gone
    assert.ok(!/it\.parent_test_id/.test(listJs), 'parent_test_id no longer used');
    assert.ok(!/STATE\.libraryFilter\s*===\s*['"]l3_test['"]/.test(listJs), 'isTestTab gating removed');
  });

  test('delete gated on library — no footgun (no passage rows to mis-delete a test from)', () => {
    assert.match(listJs, /if\s*\(\s*it\.library === 'l3_test' && it\.slug\s*\)[\s\S]{0,900}data-action="delete-test"/);
  });

  test('#363 404-safety holds: L3 slug IS the test_id (backend), never a passage slug', () => {
    // slug is sourced from reading_tests.test_id in the normaliser, so the
    // preview/edit/delete key (it.slug) can never be a passage slug.
    assert.match(readingRouter, /def _normalise_l3_test_row[\s\S]{0,700}"slug":\s*r\.get\("test_id"\)/);
  });
});

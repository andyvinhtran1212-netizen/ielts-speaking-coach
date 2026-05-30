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
  dashHtml      = read('frontend/pages/admin/dashboard/index.html');
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
    assert.match(dashHtml, /\.db-shell[\s\S]{0,120}gap:\s*var\(--av-space-6\)/);
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


describe('Item 2 — reading preview discoverable from any view (404-safe)', () => {
  test('backend enriches L3 passage rows with the parent test TEXT id', () => {
    // resolve UUID FK → reading_tests.test_id (TEXT), and DROP the raw UUID so
    // the frontend can never mistake it for a usable test_id.
    assert.match(readingRouter, /reading_tests[\s\S]{0,160}\.in_\(\s*["']id["']\s*,\s*test_uuids\s*\)/);
    assert.match(readingRouter, /r\["parent_test_id"\]\s*=\s*parent/);
    assert.match(readingRouter, /r\.pop\(\s*["']test_id["']/);   // raw UUID dropped
  });

  test('frontend resolves the preview test_id 404-safely (slug on test tab, else parent_test_id)', () => {
    assert.match(listJs, /previewTid\s*=\s*isTestTab\s*\?\s*it\.slug\s*:\s*it\.parent_test_id/);
    assert.match(listJs, /preview\.html\?test_id=['"]\s*\+\s*encodeURIComponent\(previewTid\)/);
    // preview renders whenever a resolved id exists (i.e. on L3 passage rows too)
    assert.match(listJs, /if\s*\(\s*previewTid\s*\)/);
  });

  test('delete stays gated to the L3 Test tab (footgun guard)', () => {
    assert.match(listJs, /if\s*\(\s*isTestTab\s*&&\s*it\.slug\s*\)[\s\S]{0,200}data-action="delete-test"/);
  });

  test('never passes a passage slug as the preview test_id (the #363 404 bug)', () => {
    // the only encodeURIComponent feeding the preview href is previewTid.
    assert.ok(!/preview\.html\?test_id=['"]\s*\+\s*encodeURIComponent\(it\.slug\)/.test(listJs));
  });
});

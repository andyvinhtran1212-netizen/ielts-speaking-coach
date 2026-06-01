/**
 * frontend/tests/reading-admin-preview-fix.test.mjs
 *
 * Sentinels for two coupled admin-reading fixes:
 *   Item 1 — preview 404: the library preview/delete buttons must render only
 *            for genuine reading_tests rows (where slug === test_id), gated on
 *            the active filter — NOT on the per-row library, which also matches
 *            L3 *passage* rows (library='l3_test', slug=<passage-slug>) in the
 *            unfiltered view and previously passed the passage slug as test_id
 *            → 404.
 *   Item 2 — the diagram/flow image manager is folded INTO the per-test preview
 *            (was a standalone "type a test_id" panel on /admin/reading/content).
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

let listJs, previewJs, previewHtml, contentHtml;
before(() => {
  listJs      = read('frontend/js/admin-reading.js');
  previewJs   = read('frontend/js/admin-reading-preview.js');
  previewHtml = read('frontend/pages/admin/reading/preview.html');
  contentHtml = read('frontend/pages/admin/reading/content.html');
});


describe('Item 1 — preview link never passes a passage slug as test_id', () => {
  test('L3 actions gated on it.library (now safe: L3 is a test row everywhere)', () => {
    // l3-action-consistency: the backend groups L3 into ONE test row per test
    // (slug === test_id) in EVERY view, so there are NO L3 passage rows to
    // confuse — gating on it.library is now correct + unambiguous.
    assert.match(
      listJs,
      /it\.library === 'l3_test' && it\.slug[\s\S]{0,800}data-action="delete-test"/,
    );
    // The old tab-gating + parent_test_id mechanism is gone from the action site.
    assert.ok(!/STATE\.libraryFilter\s*===\s*['"]l3_test['"]/.test(listJs),
      'isTestTab tab-gating removed (L3 is a test row in every view)');
    assert.ok(!/it\.parent_test_id/.test(listJs),
      'parent_test_id no longer needed (no L3 passage rows to resolve)');
  });

  test('preview link uses the test_id (it.slug) — never a passage slug (#363)', () => {
    // L3 rows carry slug === test_id (backend grouping), so previewing by
    // it.slug is 404-safe. The whole L3 action block keys on it.slug.
    assert.match(
      listJs,
      /it\.library === 'l3_test' && it\.slug[\s\S]{0,300}preview\.html\?test_id=[\s\S]{0,60}encodeURIComponent\(it\.slug\)/,
    );
  });

  test('preview JS reads the admin test endpoint (works on drafts) by test_id', () => {
    assert.match(previewJs, /\/admin\/reading\/content\/tests\/['"]\s*\+\s*encodeURIComponent\(testId\)/);
    // not the student endpoint (which strips keys + 404s on drafts)
    assert.ok(!/\/api\/reading\/test\//.test(previewJs));
  });
});


describe('Item 2 — diagram/flow image manager folded into the preview', () => {
  test('preview renders inline upload/delete controls per diagram/flow Q (keyed by q.id)', () => {
    assert.match(previewJs, /renderDiagramControls/);
    assert.match(previewJs, /DIAGRAM_TYPES\s*=\s*\{[\s\S]{0,120}diagram_label_completion[\s\S]{0,80}flow_chart_completion/);
    assert.match(previewJs, /data-q-id="['"]\s*\+\s*escapeHtml\(q\.id\)/);
  });

  test('preview calls the existing 20.14f-α upload + delete endpoints', () => {
    assert.match(previewJs, /window\.api\.upload\([\s\S]{0,80}\/upload-diagram-image['"]/);
    assert.match(previewJs, /window\.api\[['"]delete['"]\]\([\s\S]{0,80}\/diagram-image['"]/);
  });

  test('preview re-fetches the test after upload/delete (signed preview refreshes)', () => {
    assert.match(previewJs, /function\s+loadTest\s*\(/);
    assert.match(previewJs, /loadTest\(\s*CURRENT_TEST_ID\s*\)/);
  });

  test('preview.html links admin-reading.css (reuses .ar-diagram-* styles)', () => {
    assert.match(previewHtml, /css\/admin-reading\.css/);
  });

  test('standalone "type a test_id" diagram manager removed from content.html + list JS', () => {
    assert.doesNotMatch(contentHtml, /id="ar-diagram-test-id"/);
    assert.ok(!/function\s+loadDiagrams\s*\(/.test(listJs), 'standalone loadDiagrams() removed');
    assert.ok(!/ar-diagram-test-id/.test(listJs), 'standalone diagram wiring removed');
  });
});

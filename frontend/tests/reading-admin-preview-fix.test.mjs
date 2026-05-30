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


describe('Item 1 — preview link no longer passes a passage slug as test_id', () => {
  test('test actions gated on the active filter (STATE.libraryFilter), not it.library', () => {
    assert.match(
      listJs,
      /STATE\.libraryFilter\s*===\s*['"]l3_test['"][\s\S]{0,500}data-action="delete-test"/,
    );
    // The old per-row guard must be gone from the action-gating site.
    assert.ok(
      !/if\s*\(\s*it\.library\s*===\s*['"]l3_test['"]\s*&&\s*it\.slug\s*\)/.test(listJs),
      'must not gate row actions on it.library (matches L3 passage rows too)',
    );
  });

  test('preview link uses a 404-safe resolved test_id (never the passage slug)', () => {
    // admin-polish: the preview test_id is `previewTid` = it.slug on the L3 tab
    // (rows ARE tests, slug === test_id), else it.parent_test_id (the backend-
    // resolved parent TEXT id for L3 passage rows). Never the passage slug.
    assert.match(listJs, /preview\.html\?test_id=['"]\s*\+\s*encodeURIComponent\(previewTid\)/);
    assert.match(listJs, /previewTid\s*=\s*isTestTab\s*\?\s*it\.slug\s*:\s*it\.parent_test_id/);
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

/**
 * frontend/tests/l3-action-consistency.test.mjs
 *
 * l3-action-consistency — L3 Full Tests are as findable/manageable as L1/L2.
 *
 * Root cause (confirmed): on "Tất cả" the list endpoint returned raw L3
 * PASSAGE rows (3/test, preview-only by the footgun guard); genuine test rows
 * with Sửa/Xoá lived only on the "L3 Full Test" tab. Fix (Option A — grouping):
 * the backend groups L3 into ONE normalised test row per test (slug = test_id)
 * in EVERY view, so the frontend gives L3 the same preview + edit + delete as
 * L1/L2, gated on it.library — unambiguous and 404-safe (the L3 key is always
 * the test_id, never a passage slug; #363).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

const listJs = read('frontend/js/admin-reading.js');
const router = read('backend/routers/admin_reading.py');


describe('backend — "Tất cả" groups L3 into test rows', () => {
  test('normaliser maps a reading_tests row to slug = test_id', () => {
    assert.match(router, /def _normalise_l3_test_row/);
    assert.match(router, /"slug":\s*r\.get\("test_id"\)/);
    assert.match(router, /"library":\s*"l3_test"/);
  });

  test('no-filter view excludes raw L3 passages and splices in the test rows', () => {
    assert.match(router, /\.neq\(\s*"library",\s*"l3_test"\s*\)/);
    assert.match(router, /_l3_test_rows\(status\)/);
    // merged + sorted by recency so L1/L2/L3 interleave by updated_at
    assert.match(router, /merged\.sort\([\s\S]{0,80}updated_at/);
  });

  test('the L3 tab still lists reading_tests (one row per test)', () => {
    assert.match(router, /if library == "l3_test":[\s\S]{0,200}table\("reading_tests"\)/);
  });
});


describe('frontend — L3 gets the same 3 actions as L1/L2, gated on library', () => {
  test('L3 row → preview + Sửa + Xoá, gated on it.library (not the active tab)', () => {
    const block = listJs.slice(
      listJs.indexOf("it.library === 'l3_test' && it.slug"),
      listJs.indexOf("it.library === 'l1_vocab'"),
    );
    assert.ok(block, 'L3 action block precedes the L1/L2 block');
    assert.match(block, /preview\.html\?test_id=/);     // preview
    assert.match(block, /data-action="edit-test"/);     // Sửa
    assert.match(block, /data-action="delete-test"/);   // Xoá
  });

  test('L3 actions all key on it.slug (= test_id) — 404-safe (#363)', () => {
    const block = listJs.slice(
      listJs.indexOf("it.library === 'l3_test' && it.slug"),
      listJs.indexOf("it.library === 'l1_vocab'"),
    );
    // preview test_id, edit data-test-id, delete data-test-id all use it.slug
    const slugUses = (block.match(/encodeURIComponent\(it\.slug\)|escapeHtml\(it\.slug\)/g) || []).length;
    assert.ok(slugUses >= 3, `expected ≥3 it.slug uses in the L3 block, got ${slugUses}`);
    // no passage-slug / parent_test_id / tab-gating leftovers
    assert.ok(!/it\.parent_test_id/.test(listJs));
    assert.ok(!/STATE\.libraryFilter\s*===\s*['"]l3_test['"]/.test(listJs));
  });

  test('L1/L2 actions unchanged (preview-by-slug + edit-passage + delete-passage)', () => {
    assert.match(listJs, /data-action="edit-passage"/);
    assert.match(listJs, /data-action="delete-passage"/);
    assert.match(listJs, /reading-vocab-passage' : 'reading-skill-exercise'/);
  });
});

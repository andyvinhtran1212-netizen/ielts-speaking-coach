/**
 * frontend/tests/admin-reading-l1-l2-actions.test.mjs
 *
 * admin-reading-l1-l2-actions — the admin reading content library gains
 * preview / edit / delete actions for standalone L1 Vocab + L2 Skill passages
 * (previously L3-test-only).
 *
 * Invariant under test: L1/L2 actions are STRICTLY slug-based (preview → the
 * student page by slug; delete → the slug endpoint), never the L3 test_id
 * path. This preserves the #363 404-safety separation (L3 = test_id, L1/L2 =
 * slug, never crossed).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

const js = read('frontend/js/admin-reading.js');
const router = read('backend/routers/admin_reading.py');


describe('A — L1/L2 row actions (frontend renderList)', () => {
  test('L1/L2 rows get actions gated on library + slug (not the L3 test path)', () => {
    assert.match(
      js,
      /\(it\.library === 'l1_vocab' \|\| it\.library === 'l2_skill'\) && it\.slug/,
    );
  });

  test('preview opens the STUDENT page by slug (L1 → vocab, L2 → skill)', () => {
    assert.match(js, /it\.library === 'l1_vocab'[\s\S]{0,80}'reading-vocab-passage'\s*:\s*'reading-skill-exercise'/);
    assert.match(js, /href="\/pages\/' \+ passagePage \+ '\.html\?slug='/);
    // never a test_id link for the L1/L2 branch
    assert.match(js, /passagePage[\s\S]{0,200}\?slug=/);
  });

  test('edit + delete buttons carry the slug (not a test_id)', () => {
    assert.match(js, /data-action="edit-passage" data-slug="/);
    assert.match(js, /data-action="delete-passage" data-slug="/);
  });
});


describe('B — handlers (dispatch + edit + delete)', () => {
  test('handleListClick dispatches on data-action to the right handler', () => {
    assert.match(js, /closest\('button\[data-action\]'\)/);
    assert.match(js, /action === 'delete-test'[\s\S]{0,80}handleDeleteTest/);
    assert.match(js, /action === 'edit-passage'[\s\S]{0,80}handleEditPassage/);
    assert.match(js, /action === 'delete-passage'[\s\S]{0,80}handleDeletePassage/);
  });

  test('edit = re-import: reveals the import panel + names the slug (no inline editor)', () => {
    const fn = js.slice(js.indexOf('function handleEditPassage'));
    assert.match(fn, /scrollIntoView/);
    assert.match(fn, /tải lên lại file \.md/);
    // it must NOT call any passage UPDATE endpoint directly (editing = re-upload)
    assert.ok(!/api(\[['"]put['"]\]|\.put)/.test(fn.slice(0, fn.indexOf('function handleDeletePassage'))),
      'edit must route through the import flow, not a direct PUT');
  });

  test('delete confirms, then DELETEs the slug endpoint', () => {
    const fn = js.slice(js.indexOf('function handleDeletePassage'));
    assert.match(fn, /window\.confirm/);
    assert.match(
      fn,
      /window\.api\[['"]delete['"]\]\([\s\S]{0,80}'\/admin\/reading\/content\/passages\/' \+ encodeURIComponent\(slug\)/,
    );
    // recoverable-by-reimport messaging in the confirm
    assert.match(fn, /import lại file \.md/);
  });

  test('delete handles 404 / 409 (L3-slug) / 401-403 distinctly', () => {
    const fn = js.slice(js.indexOf('function handleDeletePassage'));
    assert.match(fn, /status === 404/);
    assert.match(fn, /status === 409[\s\S]{0,120}L3 Full Test/);
    assert.match(fn, /status === 401 \|\| status === 403/);
  });
});


describe('C — L3 actions unchanged (no regression)', () => {
  test('L3 delete still gated to the test tab + test_id endpoint', () => {
    assert.match(js, /isTestTab && it\.slug[\s\S]{0,800}data-action="delete-test"/);
    assert.match(
      js,
      /window\.api\[['"]delete['"]\]\([\s\S]{0,80}'\/admin\/reading\/content\/tests\/' \+ encodeURIComponent\(testId\)/,
    );
  });
});


describe('D — backend passage delete endpoint', () => {
  test('DELETE /passages/{slug} exists and requires admin', () => {
    assert.match(router, /@router\.delete\("\/passages\/\{slug\}"\)/);
    assert.match(router, /admin_delete_reading_passage[\s\S]{0,1200}await require_admin/);
  });

  test('hard delete only for L1/L2; L3 slug → 409 (keeps #363 separation)', () => {
    assert.match(
      router,
      /admin_delete_reading_passage[\s\S]{0,2000}library"\) not in \("l1_vocab", "l2_skill"\)[\s\S]{0,200}409/,
    );
    // hard delete on the resolved PK, returning action: deleted
    assert.match(
      router,
      /admin_delete_reading_passage[\s\S]{0,2400}\.delete\(\)[\s\S]{0,500}"action":\s*"deleted"/,
    );
  });

  test('404 when the slug is unknown', () => {
    assert.match(router, /admin_delete_reading_passage[\s\S]{0,1600}if not res\.data:[\s\S]{0,80}404/);
  });
});

/**
 * frontend/tests/l3-edit-delete-block-images.test.mjs
 *
 * l3-edit-delete-block-images:
 *   A. L3 edit — L3 rows gain a "Sửa" (edit) action = re-import by test_id
 *      (delete already existed, attempt-safe, 20.15 D2). Dispatched via the
 *      #373 data-action dispatcher; L1/L2 actions untouched.
 *   B. Block-level image (admin) — the diagram/flow image belongs to the
 *      question BLOCK (a run of consecutive same-type Qs). The admin preview
 *      shows ONE upload control per run, on the lead question; non-lead
 *      members show a "shared image" note instead of a redundant control.
 *   C. Student render (regression pin) — already renders the image ONCE per
 *      run (first-Q-owns), with the ASCII mono-block fallback. Unchanged.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

const listJs    = read('frontend/js/admin-reading.js');
const previewJs  = read('frontend/js/admin-reading-preview.js');
const examJs     = read('frontend/js/reading-exam.js');
const router     = read('backend/routers/admin_reading.py');


describe('A — L3 edit action (re-import by test_id)', () => {
  test('L3 row renders an edit-test button carrying the test_id', () => {
    // l3-action-consistency: L3 is a test row in every view, gated on
    // it.library (slug === test_id). edit-test carries it.slug (= test_id).
    assert.match(listJs, /it\.library === 'l3_test' && it\.slug[\s\S]{0,800}data-action="edit-test" data-test-id="' \+ escapeHtml\(it\.slug\)/);
  });

  test('dispatcher routes edit-test → handleEditTest (L1/L2 + delete intact)', () => {
    assert.match(listJs, /action === 'edit-test'\)\s*return handleEditTest/);
    // no regression to the existing routes
    assert.match(listJs, /action === 'delete-test'\)\s*return handleDeleteTest/);
    assert.match(listJs, /action === 'edit-passage'\)\s*return handleEditPassage/);
    assert.match(listJs, /action === 'delete-passage'\) return handleDeletePassage/);
  });

  test('edit = re-import: reveals import panel + promises image preservation', () => {
    const fn = listJs.slice(listJs.indexOf('function handleEditTest'));
    assert.match(fn, /scrollIntoView/);
    assert.match(fn, /tải lên lại file \.md/);
    assert.match(fn, /giữ nguyên ảnh sơ đồ/);   // images survive the re-import
    // editing routes through import, never a direct PUT
    assert.ok(!/api(\[['"]put['"]\]|\.put)/.test(fn.slice(0, 400)),
      'L3 edit must route through re-import, not a direct PUT');
  });
});


describe('B — block-level image upload UX (admin preview)', () => {
  test('one control per run: renderDiagramBlock gates the control to the lead', () => {
    assert.match(previewJs, /function renderDiagramBlock\(q, role\)/);
    // lead → image preview + the upload control; non-lead → shared note only
    assert.match(previewJs, /role\.lead[\s\S]{0,160}renderImagePreview\(q\) \+ renderDiagramControls\(q\)/);
    assert.match(previewJs, /Dùng chung ảnh sơ đồ với Q/);
  });

  test('runs detected like the student renderer (consecutive same-type)', () => {
    assert.match(previewJs, /function renderQuestionsForPassage\(qs\)/);
    assert.match(previewJs, /qs\[i - 1\]\.question_type === q\.question_type/);
    // the per-passage render goes through the run-aware function, not a bare map
    assert.match(previewJs, /renderQuestionsForPassage\(qs\)/);
    assert.ok(!/qs\.map\(renderQuestion\)/.test(previewJs),
      'questions must render via the run-aware renderer, not a per-Q map');
  });

  test('renderQuestion no longer unconditionally calls the per-Q control', () => {
    // It now takes a diagramRole and delegates to renderDiagramBlock.
    assert.match(previewJs, /function renderQuestion\(q, diagramRole\)/);
    assert.match(previewJs, /renderDiagramBlock\(q, diagramRole\)/);
  });
});


describe('C — student render unchanged (image once per run, first-Q-owns)', () => {
  test('detects runs + renders the image once via run[0].payload.image_url', () => {
    assert.match(examJs, /_consecutiveTypeRuns/);
    assert.match(examJs, /run\[0\]\.payload\.image_url/);
    assert.match(examJs, /_renderDiagramImageBlock\(run\)/);
  });

  test('ASCII mono-block fallback remains when no image', () => {
    assert.match(examJs, /exam-gap-box--mono/);
  });
});


describe('D — backend preserves uploaded images across re-import', () => {
  test('L3 question replace snapshots + restores image metadata by q_num', () => {
    assert.match(router, /_snapshot_question_images\(passage_id\)/);
    assert.match(router, /_restore_question_images\(q_rows, preserved\)/);
    // helpers preserve only the image_* template keys
    assert.match(router, /_IMAGE_TEMPLATE_KEYS\s*=\s*\(/);
    assert.match(router, /"image_storage_path",[\s\S]{0,120}"image_uploaded_by"/);
  });
});

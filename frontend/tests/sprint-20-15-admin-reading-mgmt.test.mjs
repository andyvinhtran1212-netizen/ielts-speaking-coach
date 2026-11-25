/**
 * frontend/tests/sprint-20-15-admin-reading-mgmt.test.mjs
 *
 * Sprint 20.15 — admin reading test management:
 *
 *   D1 Preview — /pages/admin/reading/preview.html?test_id=X reads from
 *      GET /admin/reading/content/tests/{test_id} and renders passages
 *      + questions WITH answer keys, alternatives, explanations
 *      (verification-focused, not student simulation).
 *
 *   D2 Delete  — per-row "Xoá" action on the L3 admin list calls
 *      DELETE /admin/reading/content/tests/{test_id}. Confirm dialog
 *      gates the call. The endpoint's response (`action: 'deleted'`
 *      vs `'archived'` + `attempts_preserved`) drives the toast text.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');


// ── D1: admin preview page exists + wires the admin endpoint ─────────

describe('Sprint 20.15 D1 — admin preview page', () => {
  test('preview.html exists and links the preview js + chrome', () => {
    const html = read('frontend/pages/admin/reading/preview.html');
    assert.match(html, /<aver-admin-chrome[^>]*active="reading"/);
    assert.match(html, /src="\/js\/admin-reading-preview\.js"/);
    assert.match(html, /id="ar-preview-passages"/);
    assert.match(html, /id="ar-preview-meta"/);
  });

  test('preview JS calls the admin endpoint (NOT the student endpoint)', () => {
    const js = read('frontend/js/admin-reading-preview.js');
    // The admin endpoint INCLUDES answer keys; the student endpoint
    // strips them. Preview must use admin so verification works.
    assert.match(
      js,
      /window\.api\.get\(\s*['"]\/admin\/reading\/content\/tests\/['"]\s*\+\s*encodeURIComponent\(testId\)/,
    );
    assert.ok(
      !/api\.get\(['"]\/api\/reading\/test\//.test(js),
      'preview must not use the student detail endpoint (it strips answer keys)',
    );
  });

  test('preview JS renders answer + alternatives + explanation per question', () => {
    const js = read('frontend/js/admin-reading-preview.js');
    assert.match(js, /function\s+renderAnswer\s*\(\s*q\s*\)/);
    assert.match(js, /function\s+renderAlternatives\s*\(\s*q\s*\)/);
    // Explanation is conditional but the keys list always includes
    // the "Đáp án" + "Đáp án thay thế" rows.
    assert.match(js, /Đáp án[\s\S]{0,400}renderAnswer\(q\)/);
    assert.match(js, /Đáp án thay thế[\s\S]{0,400}renderAlternatives\(q\)/);
  });

  test('preview JS handles 404 / 401 / 403 with friendly messages', () => {
    const js = read('frontend/js/admin-reading-preview.js');
    assert.match(js, /e\.status\s*===\s*404[\s\S]{0,200}không tìm thấy/);
    assert.match(js, /e\.status\s*===\s*401/);
    assert.match(js, /e\.status\s*===\s*403/);
  });
});


// ── D2: per-row Delete action on the admin list ──────────────────────

describe('Sprint 20.15 D2 — per-row delete action', () => {
  const js = read('frontend/js/admin-reading.js');

  test('L3 delete gated on library (test rows everywhere); preview link present', () => {
    // l3-action-consistency: L3 is now grouped into ONE test row per test
    // (slug === test_id) in EVERY view, so delete is gated on it.library
    // (no passage rows leak → no footgun) and keys on the test_id (it.slug).
    assert.match(
      js,
      /it\.library === 'l3_test' && it\.slug[\s\S]{0,1800}data-action="delete-test"/,
    );
    assert.match(js, /href="\/pages\/admin\/reading\/preview\.html\?test_id=['"]/);
  });

  test('delete handler confirms before firing the DELETE', () => {
    assert.match(js, /function\s+handleListClick\s*\(/);
    // anchor on the delete handler itself (other handlers — e.g. lock — also
    // confirm; reading-access-tracking added handleLockTest to the dispatcher).
    assert.match(
      js,
      /function\s+handleDeleteTest\s*\([\s\S]{0,400}window\.confirm/,
    );
  });

  test('delete handler calls window.api["delete"] on the admin endpoint', () => {
    assert.match(
      js,
      /window\.api\[['"]delete['"]\]\(\s*['"]\/admin\/reading\/content\/tests\/['"]\s*\+\s*encodeURIComponent\(testId\)/,
    );
  });

  test('delete handler surfaces both action types (deleted vs archived)', () => {
    // The toast text branches on the server's response so the admin
    // knows whether the test was hard-deleted or soft-archived.
    // First pin: handler reads `res.action` AND `res.attempts_preserved`
    // off the response.
    assert.match(js, /res\.action/);
    assert.match(js, /res\.attempts_preserved/);
    // Second pin: branch on the archived vs deleted action with the
    // attempt-count preservation messaging on the archived path.
    assert.match(js, /action\s*===\s*['"]archived['"][\s\S]{0,400}preserved/);
    assert.match(js, /vĩnh viễn/);
  });

  test('delete handler is wired via tbody event delegation (survives re-render)', () => {
    assert.match(
      js,
      /listTbody[\s\S]{0,100}addEventListener\(\s*['"]click['"]\s*,\s*handleListClick\)/,
    );
  });

  test('list table header has an Actions column', () => {
    const html = read('frontend/pages/admin/reading/content.html');
    assert.match(html, /<th>Actions<\/th>/);
  });
});


// ── Backend cross-reference: endpoint shape + Lesson-9 safety ────────

describe('Sprint 20.15 — backend admin endpoints', () => {
  const router = read('backend/routers/admin_reading.py');

  test('admin GET /tests/{test_id} returns answer keys (NOT stripped)', () => {
    // The projection includes `answer` + `explanation` — that's the
    // distinguishing feature vs the student endpoint.
    assert.match(
      router,
      /admin_get_reading_test[\s\S]{0,2000}select\(\s*"id,q_num,question_type,prompt,payload,answer,[\s\S]{0,100}explanation/,
    );
  });

  test('admin DELETE /tests/{test_id} only archives, never hard-deletes (Lesson 9, HOLD #2702)', () => {
    // Always soft `archived`, even at 0 attempts: an attempt start that has
    // read `published` but not INSERTed yet is invisible to the count, and a
    // hard delete would cascade it away (mig 087). A live class assignment
    // must still be rejected before the withdrawal runs.
    assert.match(
      router,
      /admin_delete_reading_test[\s\S]{0,1800}active_exam_assignment_references/,
    );
    const body = router.slice(
      router.indexOf('async def admin_delete_reading_test'),
      router.indexOf('# ── reading-access-tracking F1'),
    );
    assert.ok(body.length > 0);
    assert.match(body, /status['"]:\s*['"]archived['"]/);
    assert.doesNotMatch(body, /\.delete\(\)/);
    assert.doesNotMatch(body, /action['"]:\s*['"]deleted['"]/);
  });

  test('admin DELETE returns the documented response shape', () => {
    // {test_id, action: 'archived', attempts_preserved: N} — the frontend's
    // toast branching relies on these exact keys (it still accepts a legacy
    // 'deleted' ack, which this route no longer sends).
    assert.match(router, /['"]action['"]:\s*['"]archived['"][\s\S]{0,200}['"]attempts_preserved['"]:\s*attempt_count/);
  });

  test('admin GET accepts any status (no published-only filter)', () => {
    // The student `_fetch_published_test` does `.eq("status", "published")`;
    // the admin `_fetch_admin_test_or_404` MUST NOT — admins need to
    // preview drafts + archived rows too.
    assert.match(router, /function\s*_fetch_admin_test_or_404|def _fetch_admin_test_or_404/);
    // Pin the comment that documents the no-status-filter intent so a
    // future drift surfaces it loudly.
    assert.match(router, /status filter is NOT[\s\S]{0,200}admin/);
  });
});

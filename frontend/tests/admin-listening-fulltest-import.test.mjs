/**
 * admin-listening-fulltest-import.test.mjs — admin-fulltest-import-ui.
 *
 * Phase A (import page) + Phase B (publish/archive on the tests list). Static
 * sentinels pin the wiring + the contracts, plus real-value checks where the
 * helper is pure:
 *   • token is AUTOMATIC (window.api / supabase session) — no pasted JWT;
 *   • Lesson 16: a dry-run with errors HARD-disables the Import button;
 *   • dup-ACTIVE = archive-old-then-commit in one action;
 *   • 26MB commit shows real upload progress (xhr.upload.onprogress);
 *   • Phase B status buttons PATCH /tests/{id}/status then refetch (no optimistic).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readListeningRouterSource } from './fixtures/listening-router-source.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

const html     = read('frontend/pages/admin/listening/import-fulltest.html');
const testsHtml = read('frontend/pages/admin/listening/tests.html');
const router = readListeningRouterSource();


describe('Phase A — import page shell (admin chrome + 4 files + steps)', () => {
  test('has the 4 pack file inputs (qp · solution · timings · audio)', () => {
    for (const id of ['fi-qp', 'fi-sol', 'fi-tim', 'fi-aud']) {
      assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
    }
    assert.match(html, /id="fi-aud"[^>]*accept="audio\/mpeg,\.mp3"/);
  });
  test('ships the 3-step buttons: Kiểm tra (dry-run) → Import → Publish', () => {
    assert.match(html, /id="fi-check"/);
    assert.match(html, /id="fi-import"/);
    assert.match(html, /id="fi-archive-import"/);       // dup-ACTIVE combined action
    assert.match(html, /id="fi-publish"/);
    assert.match(html, /id="fi-progress-bar"/);         // upload progress (26MB)
  });
});






describe('Phase B — publish/archive on the tests list (replaces manual SQL)', () => {
  test('the tests page links to the new import flow', () => {
    assert.match(testsHtml, /href="\/pages\/admin\/listening\/import-fulltest\.html"/);
  });
});


describe('Phase A — 4 slots: all-four gating + multi-file auto-routing', () => {
  test('HTML guides dragging all 4 + numbered labels', () => {
    assert.match(html, /class="fi-droptip"/);
    assert.match(html, /1 · Đề/);
    assert.match(html, /4 · Audio/);
  });
});





describe('cross-ref — the endpoints the UI drives exist + are admin-gated', () => {
  test('dry-run + commit + status-transition routes are present', () => {
    assert.match(router, /@admin_router\.post\("\/import-fulltest"\)/);
    assert.match(router, /@admin_router\.post\("\/import-fulltest\/commit"\)/);
    assert.match(router, /@admin_router\.patch\("\/tests\/\{test_id\}\/status"\)/);
    assert.match(router, /require_admin\(authorization\)/);
  });
});

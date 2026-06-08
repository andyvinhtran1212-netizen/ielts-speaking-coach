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
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

const html     = read('frontend/pages/admin/listening/import-fulltest.html');
const js       = read('frontend/js/admin-listening-fulltest-import.js');
const testsHtml = read('frontend/pages/admin/listening/tests.html');
const listJs   = read('frontend/js/admin-listening-tests-list.js');
const router   = read('backend/routers/listening.py');


describe('Phase A — import page shell (admin chrome + 4 files + steps)', () => {
  test('reuses admin chrome + api.js + loads the module', () => {
    assert.match(html, /<aver-admin-chrome active="listening"/);
    assert.match(html, /src="\/js\/api\.js"/);
    assert.match(html, /src="\/js\/admin-listening-fulltest-import\.js"/);
  });
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


describe('Phase A — token is AUTOMATIC (no pasted JWT)', () => {
  test('dry-run goes through window.api.upload (Bearer attached by api.js)', () => {
    assert.match(js, /window\.api\.upload\('\/admin\/listening\/import-fulltest', fd\)/);
  });
  test('commit XHR reuses the supabase SESSION token — never a hand-typed one', () => {
    assert.match(js, /getSupabase\(\)\.auth\.getSession\(\)/);
    assert.match(js, /setRequestHeader\('Authorization', 'Bearer ' \+ token\)/);
    assert.match(js, /window\.api\.base \+ '\/admin\/listening\/import-fulltest\/commit'/);
  });
});


describe('Phase A — Lesson 16: dry-run errors HARD-block commit', () => {
  test('Import enabled only when ok && audio && not-duplicate; canBase gates on p.ok', () => {
    const fn = js.slice(js.indexOf('function refreshImportBtns'), js.indexOf('// ── STEP 2'));
    assert.match(fn, /var canBase = !!p\.ok && !STATE\.busy/);            // ok required
    assert.match(fn, /importBtn\.disabled = !\(canBase && hasAudio && !dup\)/);
    assert.match(fn, /archiveBtn\.disabled = !\(canBase && hasAudio && dup\)/);
  });
  test('a failed dry-run renders the per-error list (escaped) and no green ok', () => {
    const fn = js.slice(js.indexOf('function renderResult'), js.indexOf('function refreshImportBtns'));
    assert.match(fn, /fi-banner--err/);
    assert.match(fn, /p\.errors\.map/);
    assert.match(fn, /escapeHtml\(e\)/);          // XSS-safe error render
  });
});


describe('Phase A — dup-ACTIVE handled in one action (archive old → commit)', () => {
  test('onArchiveImport finds the live bundle by test_id, archives it, then commits', () => {
    const fn = js.slice(js.indexOf('async function onArchiveImport'), js.indexOf('function renderDone'));
    assert.match(fn, /\/admin\/listening\/tests\?status=all/);                 // look up by test_id
    assert.match(fn, /t\.status !== 'archived'/);                              // the ACTIVE one
    assert.match(fn, /\/status',\s*\{ status: 'archived' \}/);                 // PATCH archive
    assert.match(fn, /await doCommit\(\)/);                                     // then import
  });
});


describe('Phase A — 26MB upload shows real progress', () => {
  test('the commit XHR reports upload progress into the bar', () => {
    assert.match(js, /xhr\.upload\.onprogress/);
    assert.match(js, /function setProgress/);
    const sp = js.slice(js.indexOf('function setProgress'));
    assert.match(sp, /\$\('fi-progress-bar'\)\.style\.width = pct \+ '%'/);
  });
  test('publish posts the status transition for the freshly imported test', () => {
    const fn = js.slice(js.indexOf('async function onPublish'));
    assert.match(fn, /\/admin\/listening\/tests\/'\s*\+\s*encodeURIComponent\(STATE\.newTest\.id\)\s*\+\s*'\/status'/);
    assert.match(fn, /\{ status: 'published' \}/);
  });
});


describe('Phase B — publish/archive on the tests list (replaces manual SQL)', () => {
  test('statusActions returns the right buttons per status (real value)', () => {
    const m = listJs.match(/function statusActions\(t\) \{[\s\S]*?\n\}/);
    assert.ok(m, 'statusActions present');
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const fn = new Function('escapeHtml', m[0] + '\nreturn statusActions;')(esc);
    const labels = (t) => (fn(t).match(/>([^<]+)<\/button>/g) || []).map((x) => x.replace(/[><]|\/button/g, '').trim());
    assert.deepEqual(labels({ id: 'a', status: 'draft' }),     ['Publish', 'Archive']);
    assert.deepEqual(labels({ id: 'a', status: 'published' }), ['Archive']);
    assert.deepEqual(labels({ id: 'a', status: 'archived' }),  ['Khôi phục']);
    assert.match(fn({ id: 'x"y', status: 'draft' }), /data-id="x&quot;y"/);   // XSS-safe id
  });
  test('changeStatus PATCHes /tests/{id}/status then REFETCHES (no optimistic state)', () => {
    const fn = listJs.slice(listJs.indexOf('async function changeStatus'));
    assert.match(fn, /window\.api\.patch\(`\/admin\/listening\/tests\/\$\{encodeURIComponent\(id\)\}\/status`, \{ status \}\)/);
    assert.match(fn, /fetchTests\(\)/);                       // canonical refetch
    assert.match(fn, /confirm\(/);                            // archive is confirmed
  });
  test('the rows wire a delegated click handler for the status buttons', () => {
    assert.match(listJs, /\.tl-status-btn/);
    assert.match(listJs, /closest\('\.tl-status-btn'\)/);
    assert.match(listJs, /changeStatus\(b\.dataset\.id, b\.dataset\.status\)/);
  });
  test('the tests page links to the new import flow', () => {
    assert.match(testsHtml, /href="\/pages\/admin\/listening\/import-fulltest\.html"/);
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

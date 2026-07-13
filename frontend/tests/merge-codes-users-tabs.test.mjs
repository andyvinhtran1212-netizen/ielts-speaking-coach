/**
 * merge-codes-users-tabs.test.mjs — PR-2: access-codes page merged into the
 * users page as a 2-tab IA. Pins: the tab shell, the access-code module
 * relocated VERBATIM (all 5 hazards present), and the user-tab merged
 * code columns + per-user "Gỡ khỏi mã" + 2-criteria sort.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...r) => readFileSync(join(__dirname, '..', ...r), 'utf8');
const HTML = read('pages', 'admin', 'users', 'index.html');
const JS = read('js', 'admin-users.js');


describe('merge-codes — 2-tab shell', () => {
  test('two tabs (Người dùng / Mã kích hoạt) + two panels', () => {
    assert.match(HTML, /data-merge-tab="users"/);
    assert.match(HTML, /data-merge-tab="codes"/);
    assert.match(HTML, /id="tab-users"[^>]*class="merge-tab"/);
    assert.match(HTML, /id="tab-codes"[^>]*class="merge-tab"[^>]*hidden/);
  });
  test('tab toggle script + ?tab=codes deep-link (for PR-3 redirect)', () => {
    assert.match(HTML, /data-merge-tab/);
    assert.match(HTML, /get\('tab'\)\s*===\s*'codes'/);
  });
  test('loads the relocated access-code module', () => {
    assert.match(HTML, /src="\/js\/admin-access-codes\.js"/);
  });
});


describe('merge-codes — access-code module relocated VERBATIM (5 hazards intact)', () => {
  // The module's own JS (admin-access-codes.js) is unchanged; here we assert its
  // markup landed in the users page so its logic still finds its ids.
  test('code table + toolbar present', () => {
    assert.match(HTML, /id="codes-tbody"/);
    assert.match(HTML, /id="btn-create"/);
    assert.match(HTML, /id="filter-status"/);
    assert.match(HTML, /data-sort="created_at"/);   // sortable code headers
  });
  test('create + edit-perms modals present', () => {
    assert.match(HTML, /id="modal-backdrop"/);
    assert.match(HTML, /id="editperms-backdrop"/);
  });
  test('scope-warning preserved (edit perms = ALL users of the code)', () => {
    assert.match(HTML, /id="ep-notice"/);
    assert.match(HTML, /TẤT CẢ người dùng của mã/);
  });
  test('single shared #status-banner (no duplicate id)', () => {
    assert.equal((HTML.match(/id="status-banner"/g) || []).length, 1);
  });
});


describe('merge-codes — user tab merged code columns (READ-ONLY)', () => {
  test('header gained Mã / Loại / Quyền / Trạng-thái + Lớp', () => {
    assert.match(HTML, /<th>Mã<\/th>/);
    assert.match(HTML, /data-sort="code_type"/);
    assert.match(HTML, /data-sort="code_status"/);
    assert.match(HTML, /<th>Quyền<\/th>/);
  });
  test('row renders code/type/permissions/status from code_summary', () => {
    assert.match(JS, /u\.code_summary/);
    assert.match(JS, /cs\.permissions/);
    assert.match(JS, /has_active_code/);
    assert.match(JS, /không có mã active/);   // inactive marker
  });
  test('NO code-wide mutation on the user tab (no edit-perms/revoke/refill calls)', () => {
    assert.doesNotMatch(JS, /\/refill|PATCH.*access-codes|revoke/i);
  });
  test('"Gỡ khỏi mã" hits DELETE /access-codes/{id}/users/{uid} + refetches', () => {
    assert.match(JS, /data-removecode=/);
    assert.match(JS, /\/admin\/access-codes\/'[\s\S]*?\/users\/'/);
    assert.match(JS, /function removeFromCode[\s\S]*?loadList\(\)/);   // canonical refetch
  });
  test('2-criteria sort (user + code) wired on sortable headers', () => {
    assert.match(JS, /function compareUsers/);
    assert.match(JS, /case 'code_type'/);
    assert.match(JS, /case 'code_status'/);
    assert.match(JS, /th\.usr-sortable\[data-sort\]/);
  });
});


describe('merge-codes PR-3 — single entry (redirect + nav)', () => {
  // ADR-002 (Phase 1): redirects live in next.config.ts now.
  const NEXT_CONFIG = read('next.config.ts');
  const vercel = {
    redirects: Array.from(NEXT_CONFIG.matchAll(
      /\{ source: '([^']+)', destination: '([^']+)', permanent: true \}/g,
    )).map(([, source, destination]) => ({ source, destination, permanent: true })),
  };
  const chrome = read('js', 'components', 'aver-admin-chrome.js');

  test('/admin/access-codes redirects to the users page codes tab', () => {
    const r = (vercel.redirects || []).find((x) => x.source === '/admin/access-codes');
    assert.ok(r, 'missing /admin/access-codes redirect');
    assert.match(r.destination, /\/pages\/admin\/users\/index\.html\?tab=codes/);
    assert.equal(r.permanent, true);
  });
  test('the old access-codes page path also redirects to the codes tab', () => {
    const r = (vercel.redirects || []).find((x) => x.source === '/pages/admin/access-codes/index.html');
    assert.ok(r);
    assert.match(r.destination, /users\/index\.html\?tab=codes/);
  });
  test('nav no longer carries a standalone access-codes entry', () => {
    assert.doesNotMatch(chrome, /href:\s*'\/pages\/admin\/access-codes\/index\.html'/);
    // the users entry remains the single door into both tabs
    assert.match(chrome, /href:\s*'\/pages\/admin\/users\/index\.html'/);
  });
});

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

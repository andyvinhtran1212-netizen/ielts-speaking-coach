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

import {
  buildLegacyRetirementRedirects,
  LEGACY_RETIREMENT_PATHS,
} from '../tooling/legacy-url-redirects.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...r) => readFileSync(join(__dirname, '..', ...r), 'utf8');
const HTML = read('pages', 'admin', 'users', 'index.html');
// LEGACYJS-0075 W3a: admin-users.js and admin-access-codes.js are deleted; the
// Users tab is the Next panel and the sort lives in the model.
const JS = read('app', '(authed-admin-users)', 'admin', 'users', 'admin-users-panel.tsx');
const MODEL = read('lib', 'admin-users-model.mjs');


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
  // Retired page markup (fixture, ADR-005); the live codes tab is the Next
  // panel, pinned in admin-users-next-behavior.test.mjs.
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
    assert.match(JS, /const summary = user\.code_summary;/);
    assert.match(JS, /summary\.permissions/);
    assert.match(JS, /summary\.has_active_code/);
    assert.match(JS, /Không có mã active/);   // inactive marker
  });
  test('NO code-wide mutation on the user tab (no edit-perms/revoke/refill calls)', () => {
    assert.doesNotMatch(JS, /\/refill/);
    assert.doesNotMatch(JS, /patch[^\n]*access-codes/i);
    assert.doesNotMatch(JS, /delete\(`\/admin\/access-codes\/\$\{[^}]+\}`\)/);   // code-wide revoke
  });
  test('"Gỡ khỏi mã" hits DELETE /access-codes/{id}/users/{uid} + refetches', () => {
    assert.match(JS, />Gỡ khỏi mã<\/button>/);
    assert.match(JS, /window\.api\.delete\(`\/admin\/access-codes\/\$\{encodeURIComponent\(primary\.id\)\}\/users\/\$\{encodeURIComponent\(user\.id\)\}`\)/);
    assert.match(JS, /await action\(\);[\s\S]+await loadUsers\(true\)/);   // canonical refetch
  });
  test('2-criteria sort (user + code) wired on sortable headers', () => {
    assert.match(MODEL, /export function selectUsers/);
    assert.match(MODEL, /field === 'code_type'/);
    assert.match(MODEL, /field === 'code_status'/);
    assert.match(JS, /<SortButton field="code_type"/);
    assert.match(JS, /<SortButton field="code_status"/);
  });
});


describe('merge-codes PR-3 — single entry (redirect + nav)', () => {
  // ADR-002 (Phase 1): redirects live in next.config.ts now.
  const NEXT_CONFIG = read('next.config.ts');
  const vercel = {
    redirects: [
      ...buildLegacyRetirementRedirects(LEGACY_RETIREMENT_PATHS),
      ...Array.from(NEXT_CONFIG.matchAll(
      /\{ source: '([^']+)', destination: '([^']+)', permanent: (true|false) \}/g,
      )).map(([, source, destination, permanent]) => ({ source, destination, permanent: permanent === 'true' })),
    ],
  };
  const chrome = read('js', 'components', 'aver-admin-chrome.js');

  test('/admin/access-codes redirects to the users page codes tab', () => {
    const r = (vercel.redirects || []).find((x) => x.source === '/admin/access-codes');
    assert.ok(r, 'missing /admin/access-codes redirect');
    assert.equal(r.destination, '/admin/users?tab=codes');
    assert.equal(r.permanent, true, 'retired alias must remain canonical and cache-stable');
  });
  test('the old access-codes page path also redirects to the codes tab', () => {
    const r = (vercel.redirects || []).find((x) => x.source === '/pages/admin/access-codes/index.html');
    assert.ok(r);
    assert.equal(r.destination, '/admin/users?tab=codes');
    assert.equal(r.permanent, true);
  });
  test('nav no longer carries a standalone access-codes entry', () => {
    assert.doesNotMatch(chrome, /href:\s*'\/pages\/admin\/access-codes\/index\.html'/);
    // the native users entry remains the single door into both tabs
    assert.match(chrome, /href:\s*'\/admin\/users'/);
  });
});

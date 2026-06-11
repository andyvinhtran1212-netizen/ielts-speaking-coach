/**
 * frontend/tests/admin-access-codes.test.mjs — Sprint 12.2.
 *
 * Pin the access-codes admin surface carved out of admin.html into the
 * new IA at /pages/admin/access-codes/index.html. Sentinel-string match
 * against static source — catches:
 *
 *   - Page no longer embeds <aver-admin-chrome active="access-codes">
 *   - Filter bar missing one of the 3 filters
 *   - Create modal missing a required field
 *   - Cohort dropdown row missing or wired incorrectly
 *   - JS controller missing the canonical client-side guard for
 *     direct + cohort_id
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...rel) => readFileSync(join(__dirname, '..', ...rel), 'utf8');

const HTML = read('pages', 'admin', 'access-codes', 'index.html');
const JS   = read('js', 'admin-access-codes.js');


describe('Sprint 12.2 — access-codes page chrome embed', () => {
  it('uses <aver-admin-chrome active="access-codes">', () => {
    assert.match(HTML, /<aver-admin-chrome\s+active="access-codes"/);
  });
  it('loads aver-admin-chrome.js as a module', () => {
    assert.match(HTML, /<script\s+type="module"\s+src="\/js\/components\/aver-admin-chrome\.js"/);
  });
  it('loads admin-access-codes.js as the page controller', () => {
    assert.match(HTML, /<script\s+type="module"\s+src="\/js\/admin-access-codes\.js"/);
  });
});


describe('Sprint 12.2 — access-codes filter bar (3 filters)', () => {
  it('has Loại mã filter with mass/direct/staff', () => {
    assert.match(HTML, /id="filter-type"/);
    assert.match(HTML, /<option\s+value="mass">Đại trà<\/option>/);
    assert.match(HTML, /<option\s+value="direct">Trực tiếp<\/option>/);
    assert.match(HTML, /<option\s+value="staff">Nhân viên<\/option>/);
  });
  it('has Trạng thái filter (active/revoked)', () => {
    assert.match(HTML, /id="filter-status"/);
    assert.match(HTML, /<option\s+value="active">/);
    assert.match(HTML, /<option\s+value="revoked">/);
  });
  it('has Lớp filter (cohort dropdown)', () => {
    assert.match(HTML, /id="filter-cohort"/);
  });
});


describe('Sprint 12.2 — access-codes table headers (semantic, sortable-aware)', () => {
  // Sprint 18.3.1.3 cleanup: Sprint 17.1 made some headers sortable
  // (e.g. `<th class="ac-sortable" data-sort="status">Trạng thái ↕</th>`), so an
  // exact `<th>label</th>` match no longer holds. Assert the label appears inside
  // a <th> regardless of attrs / sort indicator.
  const expected = [
    'Mã', 'Loại', 'Lớp', 'Trạng thái', 'Giới hạn', 'Hết hạn', 'Ghi chú',
  ];
  for (const h of expected) {
    it(`table header "${h}" present`, () => {
      const label = h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      assert.match(HTML, new RegExp('<th[^>]*>\\s*' + label), `Missing header "${h}"`);
    });
  }
});


describe('Sprint 12.2 — create modal form fields', () => {
  it('count input', () => {
    assert.match(HTML, /id="m-count"\s+type="number"/);
  });
  it('type radio group with 3 options', () => {
    assert.match(HTML, /name="m-type"\s+value="mass"/);
    assert.match(HTML, /name="m-type"\s+value="direct"/);
    assert.match(HTML, /name="m-type"\s+value="staff"/);
  });
  it('cohort row exists (toggled by type)', () => {
    assert.match(HTML, /id="m-cohort-row"\s+hidden/);
    assert.match(HTML, /id="m-cohort"/);
  });
  it('permissions checklist with at least 6 options', () => {
    assert.match(HTML, /id="m-perms"/);
    const matches = HTML.match(/<input type="checkbox" value="[^"]+"/g) || [];
    assert.ok(matches.length >= 6, `Expected ≥6 permission checkboxes, got ${matches.length}`);
  });
  it('session_limit, expires_at, notes fields', () => {
    assert.match(HTML, /id="m-limit"/);
    assert.match(HTML, /id="m-expires"\s+type="date"/);
    assert.match(HTML, /<textarea\s+id="m-notes"/);
  });
  it('Tạo + Hủy buttons', () => {
    assert.match(HTML, /id="btn-submit"/);
    assert.match(HTML, /id="btn-cancel"/);
  });
});


describe('Sprint 12.2 — admin-access-codes.js controller', () => {
  it('loads cohorts via /admin/cohorts?is_active=true', () => {
    assert.match(JS, /\/admin\/cohorts\?is_active=true/);
  });
  it('lists access codes via /admin/access-codes', () => {
    assert.match(JS, /api\.get\(['"]\/admin\/access-codes['"]\)/);
  });
  it('POSTs to /admin/access-codes/generate', () => {
    assert.match(JS, /\/admin\/access-codes\/generate/);
  });
  it('client-side guard: direct without cohort blocks submit', () => {
    // Mirrors backend 422 — gives user immediate feedback.
    assert.match(JS, /code_type\s*===\s*['"]direct['"][\s\S]*?!cohort_id/);
  });
  it('cohort row visibility toggled by type radio change', () => {
    assert.match(JS, /m-cohort-row/);
    assert.match(JS, /selectedType\(\)/);
  });
  it('revoke uses DELETE /admin/access-codes/{id}', () => {
    assert.match(JS, /api\.delete\(['"]\/admin\/access-codes\/['"]/);
  });
  it('does not import the legacy admin.html generator inline JS', () => {
    // Sprint 12.2 carved the codes section out — JS controller must
    // stand alone (no `loadCodes\(\)` from admin.html style globals).
    assert.ok(!JS.includes('panel-codes'));
  });
});


describe('Mã kích hoạt PR2 — per-user revoke button + toast', () => {
  it('assignedCell renders a remove-user button for removable assignments', () => {
    assert.match(JS, /data-action="remove-user"/);
    assert.match(JS, /u\.removable[\s\S]*?data-action="remove-user"/);
  });
  it('removeUser calls DELETE /admin/access-codes/{id}/users/{uid}', () => {
    assert.match(
      JS,
      /api\.delete\([\s\S]*?\/admin\/access-codes\/[\s\S]*?\/users\/[\s\S]*?encodeURIComponent\(userId\)/,
    );
  });
  it('per-user revoke shows a success toast on success', () => {
    assert.match(JS, /removeUser[\s\S]*?showBanner\([^,]+,\s*['"]success['"]\)/);
  });
  it('remove button carries the user email + toast names the user', () => {
    assert.match(JS, /data-action="remove-user"[\s\S]*?data-email="\$\{esc\(u\.email/);
    assert.match(JS, /function removeUser\(codeId, userId, email\)/);
    assert.match(JS, /const who = email \|\| ['"]người dùng này['"]/);
  });
  it('per-user revoke shows an error toast on failure', () => {
    assert.match(JS, /removeUser[\s\S]*?catch[\s\S]*?showBanner\([^,]+,\s*['"]error['"]\)/);
  });
  it('remove-user action is wired into the table click delegation', () => {
    assert.match(JS, /dataset\.action\s*===\s*['"]remove-user['"]\)\s*removeUser\(/);
  });
  it('per-code revoke still toasts both success and error', () => {
    assert.match(JS, /revokeCode[\s\S]*?showBanner\('Đã thu hồi mã\.', 'success'\)/);
    assert.match(JS, /revokeCode[\s\S]*?showBanner\('Không thu hồi được[\s\S]*?'error'\)/);
  });
});


describe('Mã kích hoạt — per-code "Sửa quyền" (replaces reassign)', () => {
  it('actions column renders a per-code Sửa quyền button carrying current perms', () => {
    assert.match(JS, /data-action="edit-perms"[\s\S]*?data-perms="\$\{permsAttr\}"/);
    assert.match(JS, /const permsAttr = esc\(JSON\.stringify\(c\.permissions/);
  });
  it('edit-perms modal exists with the permission checklist + per-code notice', () => {
    assert.match(HTML, /id="editperms-backdrop"/);
    assert.match(HTML, /id="ep-perms"/);
    assert.match(HTML, /class="ep-notice"/);
    // The notice must state the change applies to ALL users of the code.
    assert.match(HTML, /TẤT CẢ người dùng của mã/);
  });
  it('modal pre-checks the code current permissions on open', () => {
    assert.match(JS, /function openEditPerms\(codeId, code, permsJson\)/);
    assert.match(JS, /#ep-perms input\[type="checkbox"\][\s\S]*?cb\.checked = current\.includes\(cb\.value\)/);
  });
  it('save PATCHes only the permissions array (not used_*/session_limit)', () => {
    assert.match(JS, /api\.patch\('\/admin\/access-codes\/'\s*\+\s*_editPermsCtx\.codeId,\s*\{\s*permissions\s*\}\)/);
    assert.doesNotMatch(JS, /api\.patch[\s\S]*?session_limit/);
  });
  it('requires at least one permission before saving', () => {
    assert.match(JS, /if \(!permissions\.length\)[\s\S]*?Phải chọn ít nhất một quyền/);
  });
  it('edit-perms modal cancel + backdrop wired', () => {
    assert.match(JS, /btn-ep-cancel'\)\.addEventListener\('click', closeEditPerms\)/);
    assert.match(JS, /editperms-backdrop'\)\.addEventListener/);
  });
});


describe('Sprint 12.2 — empty + loading + status banner states', () => {
  it('loading state present by default', () => {
    assert.match(HTML, /id="codes-loading"[^>]*>Đang tải/);
  });
  it('empty state copy mentions Tạo mã mới', () => {
    assert.match(HTML, /id="codes-empty"[\s\S]*?Tạo mã mới/);
  });
  it('status banner element exists', () => {
    assert.match(HTML, /id="status-banner"/);
  });
});

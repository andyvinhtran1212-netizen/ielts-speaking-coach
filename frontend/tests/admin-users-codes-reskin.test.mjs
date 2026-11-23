/**
 * admin-users-codes-reskin.test.mjs — re-skin of the 2-tab user-management
 * page (Người dùng + Mã kích hoạt). Layout/CSS-only + a11y fold + the single
 * allowed behavior change (revoked hidden by default). Pins the styling-fix
 * regression guard and that NO id/handler/hazard was lost.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...r) => readFileSync(join(__dirname, '..', ...r), 'utf8');
const HTML = read('pages', 'admin', 'users', 'index.html');
// LEGACYJS-0075 W3a: the two legacy controllers are deleted; the same
// contracts are pinned on the Next panels and model that own /admin/users.
const PANEL = (name) => read('app', '(authed-admin-users)', 'admin', 'users', name);
const USERS_JS = PANEL('admin-users-panel.tsx');
const CODES_JS = PANEL('admin-access-codes-panel.tsx');
const UI = PANEL('admin-user-ui.tsx');
const MODEL = read('lib', 'admin-users-model.mjs');


describe('re-skin — styling regression fix (code-tab primitives now styled)', () => {
  test('page links admin-components.css (carries .adm-table/.adm-status-pill/.adm-modal)', () => {
    assert.match(HTML, /href="\/css\/aver-design\/admin-components\.css"/);
  });
});


describe('re-skin — revoked hidden by default, still reachable (single behavior change)', () => {
  test('default "Tất cả" view filters out revoked rows', () => {
    assert.match(MODEL, /if \(!status && code\.is_revoked\) return false;/);
    assert.match(CODES_JS, /<option value="">Đang dùng<\/option>/);
  });
  test('explicit "Đã thu hồi" filter option preserved (audit still reachable)', () => {
    assert.match(HTML, /<option value="revoked">Đã thu hồi<\/option>/);
  });
  test('the sort/rank helpers live in the model (codeStatusRank/selectCodes)', () => {
    assert.match(MODEL, /export function codeStatusRank/);
    assert.match(MODEL, /export function selectCodes/);
  });
});


describe('re-skin — a11y fold (aria-sort + keyboard + focus ring)', () => {
  test('sortable headers carry tabindex + initial aria-sort in markup', () => {
    assert.match(HTML, /class="usr-sortable" data-sort="display_name" tabindex="0" aria-sort="none"/);
    assert.match(HTML, /class="ac-sortable" data-sort="status" tabindex="0" aria-sort="none"/);
  });
  test('both panels sort through one labelled SortButton that shows the sort state', () => {
    assert.match(USERS_JS, /<SortButton field="display_name"/);
    assert.match(CODES_JS, /<SortButton field="status"/);
    assert.match(UI, /aria-label=\{`Sắp xếp theo \$\{String\(children\)\}`\}/);
    assert.match(UI, /active \? \(sort\.order === 'asc' \? '↑' : '↓'\) : '↕'/);
  });
  test('keyboard activation (Enter/Space) comes from a native button', () => {
    assert.match(UI, /<button\s+className=\{`au-sort/);
    assert.match(UI, /type="button"/);
  });
  test('focus-visible ring uses the canonical --av-shadow-focus token', () => {
    assert.match(HTML, /:focus-visible[\s\S]*?var\(--av-shadow-focus\)/);
  });
});


describe('re-skin — preserved ids / handlers / hazards (no logic regressed)', () => {
  test('user-tab ids + the #482 generate-and-assign action survive', () => {
    assert.match(HTML, /id="usr-tbody"/);
    assert.match(HTML, /id="ga-backdrop"/);
    assert.match(USERS_JS, /onClick=\{\(\) => setGenerate\(\{ user,/);
    assert.match(USERS_JS, /'\/admin\/access-codes\/generate-and-assign'/);
  });
  test('code-tab 5 hazards intact in the controller', () => {
    assert.match(CODES_JS, /association_lookup_failed/);     // → ⚠ lookup failed
    assert.match(CODES_JS, /⚠ lookup failed/);
    assert.match(CODES_JS, /code\.assigned_users\.map\(/);     // assigned-users cell
    assert.match(CODES_JS, /loadCodes\(true\)/);              // silent refetch (not optimistic)
    assert.match(CODES_JS, /user\.removable &&/);              // #442 used_by fallback gate
    assert.match(CODES_JS, /Thay đổi áp dụng ngay cho <strong>tất cả người dùng<\/strong> của mã/); // edit-perms scope warning
  });
  test('row actions wrapped but delegation targets unchanged', () => {
    assert.match(USERS_JS, /<div className="au-row-actions">/);
    assert.match(USERS_JS, /title: 'Gỡ người dùng khỏi mã'/);
    assert.match(USERS_JS, /onClick=\{\(\) => setConvert\(\{ user,/);
  });
});

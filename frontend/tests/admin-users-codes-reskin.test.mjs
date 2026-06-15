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
const USERS_JS = read('js', 'admin-users.js');
const CODES_JS = read('js', 'admin-access-codes.js');


describe('re-skin — styling regression fix (code-tab primitives now styled)', () => {
  test('page links admin-components.css (carries .adm-table/.adm-status-pill/.adm-modal)', () => {
    assert.match(HTML, /href="\/css\/aver-design\/admin-components\.css"/);
  });
});


describe('re-skin — revoked hidden by default, still reachable (single behavior change)', () => {
  test('default "Tất cả" view filters out revoked rows', () => {
    assert.match(CODES_JS, /if \(!f\.status && row\.is_revoked\) return false;/);
  });
  test('explicit "Đã thu hồi" filter option preserved (audit still reachable)', () => {
    assert.match(HTML, /<option value="revoked">Đã thu hồi<\/option>/);
  });
  test('did NOT touch the pure sort/rank util (compareCodesBy/statusRank intact)', () => {
    const UTIL = read('js', 'admin-codes-util.js');
    assert.match(UTIL, /export function statusRank/);
    assert.match(UTIL, /export function compareCodesBy/);
  });
});


describe('re-skin — a11y fold (aria-sort + keyboard + focus ring)', () => {
  test('sortable headers carry tabindex + initial aria-sort in markup', () => {
    assert.match(HTML, /class="usr-sortable" data-sort="display_name" tabindex="0" aria-sort="none"/);
    assert.match(HTML, /class="ac-sortable" data-sort="status" tabindex="0" aria-sort="none"/);
  });
  test('both controllers reflect real sort state onto aria-sort', () => {
    assert.match(USERS_JS, /function reflectSort[\s\S]*?th\.usr-sortable\[data-sort\][\s\S]*?aria-sort/);
    assert.match(CODES_JS, /function reflectSort[\s\S]*?th\.ac-sortable\[data-sort\][\s\S]*?aria-sort/);
  });
  test('keyboard activation (Enter/Space) on sortable headers', () => {
    assert.match(USERS_JS, /keydown[\s\S]*?(Enter|' ')[\s\S]*?th\.click\(\)/);
    assert.match(CODES_JS, /keydown[\s\S]*?(Enter|' ')[\s\S]*?th\.click\(\)/);
  });
  test('focus-visible ring uses the canonical --av-shadow-focus token', () => {
    assert.match(HTML, /:focus-visible[\s\S]*?var\(--av-shadow-focus\)/);
  });
});


describe('re-skin — preserved ids / handlers / hazards (no logic regressed)', () => {
  test('user-tab ids + the #482 generate-and-assign action survive', () => {
    assert.match(HTML, /id="usr-tbody"/);
    assert.match(HTML, /id="ga-backdrop"/);
    assert.match(USERS_JS, /data-gencode=/);
    assert.match(USERS_JS, /\/admin\/access-codes\/generate-and-assign/);
  });
  test('code-tab 5 hazards intact in the controller', () => {
    assert.match(CODES_JS, /association_lookup_failed/);     // → ⚠ lookup failed
    assert.match(CODES_JS, /⚠ lookup failed/);
    assert.match(CODES_JS, /function assignedCell/);          // assigned-users cell
    assert.match(CODES_JS, /loadCodes\(true\)/);              // silent refetch (not optimistic)
    assert.match(CODES_JS, /u\.removable/);                   // #442 used_by fallback gate
    assert.match(HTML, /TẤT CẢ người dùng của mã/);           // edit-perms scope warning
  });
  test('row actions wrapped but delegation targets unchanged', () => {
    assert.match(USERS_JS, /class="usr-actions"/);
    assert.match(USERS_JS, /data-removecode=/);
    assert.match(USERS_JS, /data-convert=/);
  });
});

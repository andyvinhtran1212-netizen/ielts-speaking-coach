/**
 * admin-confirm-danger.test.mjs — notification arc PR-2 (styled danger confirm).
 *
 * Pins window.confirmDanger (on .adm-modal + Student-Hub focus-trap) and the
 * replacement of the 4 core revoke/gỡ native confirm() sites — gate preserved
 * (action only on confirm). DELETE-frozen / inline-boolean / student confirms
 * stay native.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...r) => readFileSync(join(__dirname, '..', ...r), 'utf8');
const CD = read('js', 'confirm-danger.js');
const ADMINCSS = read('css', 'aver-design', 'admin-components.css');
const AC = read('js', 'admin-access-codes.js');
const USERS = read('js', 'admin-users.js');
const COH = read('js', 'admin-cohorts.js');


describe('confirmDanger helper — modal + a11y', () => {
  test('exposes window.confirmDanger on the .adm-modal primitive (aver-design)', () => {
    assert.match(CD, /window\.confirmDanger = confirmDanger/);
    assert.match(CD, /'adm-modal av-confirm'/);
    assert.match(CD, /'adm-modal-backdrop av-confirm-backdrop'/);
    assert.match(CD, /'adm-btn-danger'/);   // destructive confirm button
  });
  test('dialog aria (role/aria-modal/labelledby)', () => {
    assert.match(CD, /setAttribute\('role', 'dialog'\)/);
    assert.match(CD, /setAttribute\('aria-modal', 'true'\)/);
    assert.match(CD, /aria-labelledby/);
  });
  test('Esc cancels, Tab focus-trap, return focus to opener, default focus = cancel', () => {
    assert.match(CD, /e\.key === 'Escape'[\s\S]*?doCancel\(\)/);
    assert.match(CD, /e\.key === 'Tab'/);
    assert.match(CD, /prevFocus[\s\S]*?\.focus\(\)/);
    assert.match(CD, /cancelBtn\.focus\(\)/);
  });
  test('gate: action runs only on confirm; cancel is a no-op for the action', () => {
    assert.match(CD, /function doConfirm\(\)[\s\S]*?opts\.onConfirm/);
    assert.match(CD, /function doCancel\(\)[\s\S]*?opts\.onCancel/);
    assert.doesNotMatch(CD, /doCancel[\s\S]{0,40}onConfirm/);   // cancel never fires onConfirm
  });
  test('CSS .av-confirm danger variant defined', () => {
    assert.match(ADMINCSS, /\.av-confirm \{/);
    assert.match(ADMINCSS, /\.av-confirm__body/);
  });
});


describe('migration — 4 core revoke/gỡ confirms → confirmDanger (gate preserved)', () => {
  test('access-codes revokeCode + removeUser use confirmDanger (action in onConfirm)', () => {
    assert.match(AC, /function revokeCode\(codeId\) \{\s*confirmDanger\(\{/);
    assert.match(AC, /function removeUser\(codeId, userId, email\) \{[\s\S]*?confirmDanger\(\{/);
    assert.match(AC, /onConfirm: async \(\) => \{[\s\S]*?api\.delete\('\/admin\/access-codes\/' \+ codeId\)/);
  });
  test('users removeFromCode uses confirmDanger; refetch (loadList) preserved', () => {
    assert.match(USERS, /function removeFromCode\(codeId, userId\) \{\s*confirmDanger\(\{/);
    assert.match(USERS, /onConfirm: async[\s\S]*?loadList\(\)/);
  });
  test('cohorts removeMember uses confirmDanger; refetch (loadDetail) preserved', () => {
    assert.match(COH, /function removeMember\(studentId\) \{\s*confirmDanger\(\{/);
    assert.match(COH, /onConfirm: async[\s\S]*?loadDetail\(_cohortId\)/);
  });
  test('those 4 no longer call native confirm()', () => {
    assert.doesNotMatch(AC, /if \(!confirm\('Thu hồi mã này/);
    assert.doesNotMatch(AC, /if \(!confirm\('Gỡ ' \+ who/);
    assert.doesNotMatch(USERS, /if \(!confirm\('Gỡ học viên này khỏi mã/);
    assert.doesNotMatch(COH, /if \(!confirm\('Xóa học viên này khỏi lớp/);
  });
});


describe('migration — out-of-scope confirms stay NATIVE (no over-reach)', () => {
  test('refill (not a revoke) + changeRole (inline-boolean) keep native confirm', () => {
    assert.match(AC, /if \(!confirm\('Cấp một mã mới/);
    assert.match(USERS, /if \(!confirm\(`Đổi role thành/);
  });
  test('DELETE-frozen confirm (delete student) stays native', () => {
    const STU = read('pages', 'admin', 'students', 'index.html');
    assert.match(STU, /if \(!confirm\('Xóa học viên "/);
    assert.doesNotMatch(STU, /confirmDanger/);
  });
});


describe('confirm-danger.js loaded on the 3 migrated pages', () => {
  for (const p of [
    ['pages','admin','access-codes','index.html'],
    ['pages','admin','users','index.html'],
    ['pages','admin','cohorts','index.html'],
  ]) {
    test(`${p.slice(2).join('/')} loads /js/confirm-danger.js`, () => {
      assert.match(read(...p), /src="\/js\/confirm-danger\.js"/);
    });
  }
});

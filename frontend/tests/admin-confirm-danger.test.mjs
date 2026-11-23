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
// LEGACYJS-0075 W3a: the codes and users controllers are the Next panels now;
// they confirm through the shared React dialog (`danger: true`), not window.confirmDanger.
const AC = read('app', '(authed-admin-users)', 'admin', 'users', 'admin-access-codes-panel.tsx');
const USERS = read('app', '(authed-admin-users)', 'admin', 'users', 'admin-users-panel.tsx');
// LEGACYJS-0075 W3b: admin-classes.js and admin-students-panel.js are deleted;
// the class roster and the students directory confirm through the shared Dialog.
const COH = read('app', '(authed-admin-classes)', 'admin', 'classes', '[cohortId]', 'admin-class-detail.tsx');
const STU = read('app', '(authed-admin-students)', 'admin', 'students', 'admin-students-directory.tsx');


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
  test('access-codes revoke + remove-user confirm as danger (action only in run)', () => {
    assert.match(AC, /title: 'Thu hồi mã',[\s\S]{0,160}danger: true,\s*run: async \(\) => mutate\(\s*\(\) => window\.api\.delete\(`\/admin\/access-codes\/\$\{encodeURIComponent\(code\.id\)\}`\)/);
    assert.match(AC, /title: 'Gỡ người dùng khỏi mã',[\s\S]{0,260}danger: true,\s*run: async \(\) => mutate\(/);
  });
  test('users remove-from-code confirms as danger; canonical refetch preserved', () => {
    assert.match(USERS, /title: 'Gỡ người dùng khỏi mã',[\s\S]{0,260}danger: true,\s*run: async \(\) => mutate\(/);
    assert.match(USERS, /await action\(\);[\s\S]+await loadUsers\(true\)/);
  });
  test('cohorts removeMember is gated by a dialog; canonical refetch preserved', () => {
    assert.match(COH, /onClick=\{\(\) => setConfirm\(\{ kind: 'remove-member', member \}\)\}/);
    assert.match(COH, /if \(confirm\?\.kind === 'remove-member'\) void removeMember\(confirm\.member\)/);
    assert.match(COH, /const removeMember = async[\s\S]*?window\.api\.delete\(`\/admin\/cohorts\/[\s\S]*?await loadOverview\(true\)/);
  });
  test('those 4 no longer call native confirm()', () => {
    assert.doesNotMatch(AC, /\bconfirm\(/);
    assert.doesNotMatch(USERS, /\bconfirm\(/);
    assert.doesNotMatch(COH, /\bconfirm\(/);
  });
});


describe('migration — out-of-scope confirms stay NATIVE (no over-reach)', () => {
  test('refill (not a revoke) is a plain confirm; a role change is danger only for self-demotion', () => {
    assert.match(AC, /title: 'Cấp mã mới',\s*body: [^\n]+\n\s*confirmLabel: 'Cấp mã mới',\s*run:/);
    assert.match(USERS, /danger: user\.id === profileId && nextRole !== 'admin'/);
  });
  test('archive student is gated by its own dialog (work kept), not a danger confirm', () => {
    // STUDENTARCHIVE-0029: archiving keeps work. The native directory gates it
    // with the shared Dialog and a reason form, not window.confirm.
    assert.match(STU, /onClick=\{\(\) => setArchiveDraft\(\{ student, reason: '', deactivateAccount: false, error: '' \}\)\}/);
    assert.match(STU, /<Dialog open=\{Boolean\(archiveDraft\)\} title=\{`Lưu trữ /);
    assert.doesNotMatch(STU, /\bconfirm\(|confirmDanger/);
  });
});


describe('confirm-danger.js loaded on the migrated legacy page', () => {
  for (const p of [
    ['pages','admin','classes','index.html'],
  ]) {
    test(`${p.slice(2).join('/')} loads /js/confirm-danger.js`, () => {
      assert.match(read(...p), /src="\/js\/confirm-danger\.js"/);
    });
  }
});

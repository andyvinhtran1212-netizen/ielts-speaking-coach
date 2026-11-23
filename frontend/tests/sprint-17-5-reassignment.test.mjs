/**
 * frontend/tests/sprint-17-5-reassignment.test.mjs — Sprint 17.5 (Direction E)
 *
 * Source-scan of the reassign/refill (codes UI) + cohort member add/remove
 * (cohort UI) action wiring. Both controllers are auto-running/DOM-coupled, so
 * this pins endpoint calls + Pattern #26 rather than executing them.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const front = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');
// LEGACYJS-0075 W3a: admin-access-codes.js is deleted; the codes tab is the Next panel.
const CODES = front('app', '(authed-admin-users)', 'admin', 'users', 'admin-access-codes-panel.tsx');
// LEGACYJS-0075 W3b: admin-classes.js is deleted; the roster is the Next class detail.
const COHORTS = front('app', '(authed-admin-classes)', 'admin', 'classes', '[cohortId]', 'admin-class-detail.tsx');
const CODES_HTML = front('pages', 'admin', 'access-codes', 'index.html');
const COHORTS_HTML = front('pages', 'admin', 'classes', 'index.html');


describe('Sprint 17.5 — codes UI refill (reassign replaced by edit-perms)', () => {
  // The per-user reassign ("Đổi") was removed — Andy: not needed; permissions
  // are now edited PER-CODE via "Sửa quyền". Pin that the reassign wiring is
  // gone so it can't silently regress, and that refill is untouched.
  test('reassign action + modal fully removed', () => {
    assert.doesNotMatch(CODES, /reassign/i);
    assert.doesNotMatch(CODES_HTML, /id="reassign-backdrop"/);
    assert.doesNotMatch(CODES_HTML, /id="ra-to"/);
  });
  test('refill button calls /refill', () => {
    assert.match(CODES, />Cấp mã mới<\/button>/);
    assert.match(CODES, /window\.api\.post\(`\/admin\/access-codes\/\$\{encodeURIComponent\(code\.id\)\}\/refill`, \{\}\)/);
  });
  test('row actions open edit-perms + refill', () => {
    assert.match(CODES, /onClick=\{\(\) => setEdit\(\{ code, permissions:/);
    assert.match(CODES, /title: 'Cấp mã mới',/);
  });
  test('Pattern #26 — no inline colour/bg/hex', () => {
    assert.doesNotMatch(CODES, /style=\{\{[^}]*color\s*:/);
    assert.doesNotMatch(CODES, /style=\{\{[^}]*background/);
    assert.doesNotMatch(CODES, /rgba\(\s*\d+\s*,/);
  });
});

describe('Sprint 17.5 — cohort UI member add/remove', () => {
  test('add assigns existing student (POST /students) + remove DELETEs /students', () => {
    // WF-1: roster add/remove sets/clears students.cohort_id (no code issued).
    assert.match(COHORTS, /window\.api\.post\(`\/admin\/cohorts\/\$\{encodeURIComponent\(cohortId\)\}\/students`, \{ student_id: selectedStudent \}\)/);
    assert.match(COHORTS, /window\.api\.delete\(`\/admin\/cohorts\/\$\{encodeURIComponent\(cohortId\)\}\/students\/\$\{encodeURIComponent\(member\.student_id\)\}`\)/);
  });
  test('remove-member button per row + confirm gate', () => {
    assert.match(COHORTS, /setConfirm\(\{ kind: 'remove-member', member \}\)/);
    assert.match(COHORTS, /title=\{confirm\?\.kind === 'remove-member' \? 'Gỡ học viên khỏi lớp\?'/);
  });
  test('Pattern #26 — no inline colour/bg/hex', () => {
    assert.doesNotMatch(COHORTS, /style=\{\{[^}]*color\s*:/);
    assert.doesNotMatch(COHORTS, /style=\{\{[^}]*background/);
    assert.doesNotMatch(COHORTS, /rgba\(\s*\d+\s*,/);
  });
  test('add-member dialog with a student picker', () => {
    assert.match(COHORTS, /<Dialog open=\{memberPicker\} title="Thêm học viên vào lớp"/);
    assert.match(COHORTS, /<form id="acx-member-form" className="acd-form" onSubmit=\{addMember\}>/);
    assert.match(COHORTS, /<Field label="Học viên"/);
  });
});

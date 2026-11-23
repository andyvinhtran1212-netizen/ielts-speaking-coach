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
const COHORTS = front('js', 'admin-classes.js');
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
    assert.match(COHORTS, /api\.post\('\/admin\/cohorts\/'\s*\+\s*encodeURIComponent\(_cohortId\)\s*\+\s*'\/students'/);
    assert.match(COHORTS, /api\.delete\('\/admin\/cohorts\/'\s*\+\s*encodeURIComponent\(_cohortId\)\s*\+\s*'\/students\/'/);
  });
  test('remove-member button per row + confirm gate', () => {
    assert.match(COHORTS, /data-action="remove-member"/);
    // Notification PR-2: native confirm() → styled confirmDanger (gate preserved).
    assert.match(COHORTS, /confirmDanger\(/);
  });
  test('Pattern #26 — no inline colour/bg/hex', () => {
    assert.doesNotMatch(COHORTS, /style\s*=\s*["'][^"']*color\s*:/);
    assert.doesNotMatch(COHORTS, /style\s*=\s*["'][^"']*background/);
    assert.doesNotMatch(COHORTS, /rgba\(\s*\d+\s*,/);
  });
  test('add-member modal present in page', () => {
    assert.match(COHORTS_HTML, /id="member-modal"/);
    assert.match(COHORTS_HTML, /id="mf-student"/);
    assert.match(COHORTS_HTML, /id="btn-add-member"/);
  });
});

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
const CODES = front('js', 'admin-access-codes.js');
const COHORTS = front('js', 'admin-cohorts.js');
const CODES_HTML = front('pages', 'admin', 'access-codes', 'index.html');
const COHORTS_HTML = front('pages', 'admin', 'cohorts', 'index.html');


describe('Sprint 17.5 — codes UI refill (reassign replaced by edit-perms)', () => {
  // The per-user reassign ("Đổi") was removed — Andy: not needed; permissions
  // are now edited PER-CODE via "Sửa quyền". Pin that the reassign wiring is
  // gone so it can't silently regress, and that refill is untouched.
  test('reassign action + modal fully removed', () => {
    assert.doesNotMatch(CODES, /data-action="reassign"/);
    assert.doesNotMatch(CODES, /_reassignCtx/);
    assert.doesNotMatch(CODES_HTML, /id="reassign-backdrop"/);
    assert.doesNotMatch(CODES_HTML, /id="ra-to"/);
  });
  test('refill button calls /refill', () => {
    assert.match(CODES, /data-action="refill"/);
    assert.match(CODES, /\/admin\/access-codes\/'\s*\+\s*codeId\s*\+\s*'\/refill/);
  });
  test('click handler dispatches edit-perms + refill', () => {
    assert.match(CODES, /dataset\.action === 'edit-perms'/);
    assert.match(CODES, /dataset\.action === 'refill'/);
  });
  test('Pattern #26 — no inline colour/bg/hex', () => {
    assert.doesNotMatch(CODES, /style\s*=\s*["'][^"']*color\s*:/);
    assert.doesNotMatch(CODES, /style\s*=\s*["'][^"']*background/);
    assert.doesNotMatch(CODES, /rgba\(\s*\d+\s*,/);
  });
});

describe('Sprint 17.5 — cohort UI member add/remove', () => {
  test('add member POSTs to cohort members + remove DELETEs', () => {
    assert.match(COHORTS, /api\.post\('\/admin\/cohorts\/'\s*\+\s*encodeURIComponent\(_cohortId\)\s*\+\s*'\/members'/);
    assert.match(COHORTS, /api\.delete\('\/admin\/cohorts\/'\s*\+\s*encodeURIComponent\(_cohortId\)\s*\+\s*'\/members\/'/);
  });
  test('remove-member button per row + confirm', () => {
    assert.match(COHORTS, /data-action="remove-member"/);
    assert.match(COHORTS, /confirm\(/);
  });
  test('Pattern #26 — no inline colour/bg/hex', () => {
    assert.doesNotMatch(COHORTS, /style\s*=\s*["'][^"']*color\s*:/);
    assert.doesNotMatch(COHORTS, /style\s*=\s*["'][^"']*background/);
    assert.doesNotMatch(COHORTS, /rgba\(\s*\d+\s*,/);
  });
  test('add-member modal present in page', () => {
    assert.match(COHORTS_HTML, /id="addmember-backdrop"/);
    assert.match(COHORTS_HTML, /id="am-user"/);
    assert.match(COHORTS_HTML, /id="btn-add-member"/);
  });
});

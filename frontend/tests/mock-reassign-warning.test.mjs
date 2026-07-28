/**
 * mock-reassign-warning.test.mjs — naming the students a retake edit missed.
 *
 * assign() reports three outcomes per student: refreshed, `locked` (mid-exam,
 * deliberately not touched) and `refresh_failed` (the write errored). Reducing
 * those to counts in a toast left the admin unable to act: the assignment table
 * below re-renders from the CANONICAL assignments, which show the NEW values
 * for everyone, so there was nowhere left to find out whose sitting still holds
 * the old skills/window — or which one to cancel (Codex review, PR #845).
 *
 * Source-sentinels.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JS = readFileSync(
  join(__dirname, '..', 'public', 'js', 'admin-mock-exams.js'), 'utf8');

describe('retake assign — the un-refreshed students are named', () => {
  test('a persistent warning host exists, not just a toast', () => {
    assert.match(JS, /id="a-warn"/);
    assert.match(JS, /function renderAssignWarning\(locked, failed\)/);
    assert.match(JS, /renderAssignWarning\(res\.locked \|\| \[\], res\.refresh_failed \|\| \[\]\)/);
  });

  test('both outcomes are rendered, and kept distinct', () => {
    // `locked` is a deliberate refusal (the student is mid-exam); a failed
    // refresh means nobody knows what that student is now sitting.
    assert.match(JS, /ĐANG LÀM BÀI[\s\S]{0,200}locked\.map/);
    assert.match(JS, /lỗi ghi[\s\S]{0,200}failed\.map/);
  });

  test('names come from the picker rows still on screen — no extra request', () => {
    assert.match(JS, /function studentName\(uid\)/);
    assert.match(JS, /tr\[data-uid=/);
  });

  test('the warning clears when a later batch has nothing to report', () => {
    assert.match(JS, /if \(!locked\.length && !failed\.length\) \{ box\.hidden = true; box\.innerHTML = ''; return; \}/);
  });

  test('student names are escaped', () => {
    assert.match(JS, /esc\(studentName\(u\)\)/);
  });
});

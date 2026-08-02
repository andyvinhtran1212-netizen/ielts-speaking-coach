/**
 * admin-classes.js — cột bài tập phải phân biệt "chưa tới hạn" với "đã trễ" (GĐ 2).
 *
 * Executes the real render helpers rather than matching their source: the thing
 * that can be wrong here is what a number MEANS on screen, and a regex cannot
 * tell "3 chưa nộp" shown as a neutral fact from the same 3 shown as a problem.
 *
 * The distinction matters because the daily task is due at 19:00. Before the
 * deadline, everyone who has not submitted is simply not due yet — styling that
 * as a warning would put a red flag on every class all day, which trains the
 * teacher to ignore the flag by the time it means something.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'public', 'js', 'admin-classes.js'), 'utf8');

function loadHelpers() {
  const start = SRC.indexOf('function dueLabel');
  const end = SRC.indexOf('function renderHomework');
  assert.ok(start !== -1 && end > start, 'homework helpers not found');

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const countLabel = (n) => String(n);

  return new Function('esc', 'countLabel', `${SRC.slice(start, end)}
    return { dueLabel, progressCell };`)(esc, countLabel);
}

const { dueLabel, progressCell } = loadHelpers();

/**
 * Strip `//` comments before asserting a symbol is ABSENT from code.
 *
 * Without this, a comment explaining why `getFullYear()` was removed satisfies
 * a /getFullYear/ match and the test fails on its own documentation — or worse,
 * a doesNotMatch passes because the code is clean while a *positive* assertion
 * is satisfied by prose. Same trap as the SQL migration tests.
 */
const codeOnly = (s) => s.replace(/\/\/[^\n]*/g, '');

// The class marker for "this needs attention" — the same one the roster uses
// for students with no account.
const WARN = 'cl-roster-gap';


describe('submission cell separates not-yet-due from overdue', () => {
  test('nobody overdue → no warning styling anywhere', () => {
    const html = progressCell({ assigned: 20, submitted: 5, late: 0, missing: 0 });
    assert.match(html, /5\/20 đã nộp/);
    assert.doesNotMatch(html, new RegExp(WARN),
      'before the deadline, "chưa nộp" is not a problem and must not be flagged');
  });

  test('overdue and unsubmitted → flagged', () => {
    const html = progressCell({ assigned: 20, submitted: 5, late: 0, missing: 15 });
    assert.match(html, new RegExp(WARN));
    assert.match(html, /15 chưa nộp, đã quá hạn/);
  });

  test('late submissions are reported but not flagged as missing', () => {
    const html = progressCell({ assigned: 20, submitted: 20, late: 3, missing: 0 });
    assert.match(html, /3 nộp trễ/);
    assert.doesNotMatch(html, new RegExp(WARN),
      'a late hand-in is still a hand-in — only nothing-at-all past the deadline is the alarm');
  });

  test('a failed progress read says so instead of showing zeros', () => {
    // "0/0 đã nộp" would be a claim about the class that no query earned.
    const html = progressCell(null);
    assert.match(html, /Không đọc được/);
    assert.doesNotMatch(html, /đã nộp/);
  });
});


describe('deadline cell', () => {
  test('no deadline is stated, not blank', () => {
    assert.match(dueLabel(null), /Không hạn/);
  });

  test('an unparseable deadline is reported, never silently dropped', () => {
    assert.match(dueLabel('not-a-date'), /không đọc được/i);
  });

  test('a real deadline renders the date', () => {
    const html = dueLabel('2026-08-03T19:00:00+07:00');
    assert.match(html, /2026/);
    assert.match(html, /03/);
  });
});


describe('the give flow tells the admin who will not receive it', () => {
  const submit = SRC.slice(SRC.indexOf('async function submitHomework'),
                           SRC.indexOf('function deleteHomework'));

  test('unactivated students are surfaced on success, as an error toast', () => {
    // Those students get a row but no account, so nothing is ever shown to them
    // — they read as simply not having done the work (mig 177 header).
    assert.match(submit, /unactivated_count/);
    assert.match(submit, /chưa kích hoạt tài khoản/);
    assert.match(submit, /'error'/,
      'a quiet success toast would bury the one thing the admin must act on');
  });

  test('the deadline is sent as a DATE — the 19:00 rule lives on the server', () => {
    assert.match(submit, /due_date: \$\('hf-due'\)\.value \|\| null/);
    assert.doesNotMatch(submit, /19:00|setHours|toISOString/,
      'composing the deadline in the browser would use the admin’s own timezone');
  });
});


describe('the default due date is TODAY IN VIETNAM, not in the browser (Codex review)', () => {
  // getFullYear/getMonth/getDate read the browser's zone. An admin abroad at the
  // day boundary would default to the wrong date; the server then correctly
  // composes 19:00 Vietnam time for a day already past, and the give is overdue
  // the moment it is created.
  const fn = SRC.slice(SRC.indexOf('function todayInVietnam'), SRC.indexOf('function fmtDate'));

  test('the helper names the timezone explicitly', () => {
    assert.match(codeOnly(fn), /timeZone: 'Asia\/Ho_Chi_Minh'/);
    assert.doesNotMatch(codeOnly(fn), /getFullYear|getMonth\(\)|getDate\(\)/,
      'browser-local getters are exactly the bug this replaced');
  });

  test('it really returns the Vietnam date at a day boundary', () => {
    // 2026-08-02T20:00Z is still 2026-08-02 in Los Angeles but already
    // 2026-08-03 in Vietnam (+07). The helper must say the 3rd.
    const boundary = new Date('2026-08-02T20:00:00Z');
    const vn = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(boundary);
    const la = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(boundary);
    assert.equal(vn, '2026-08-03');
    assert.equal(la, '2026-08-02');
    assert.notEqual(vn, la, 'fixture no longer straddles a day boundary — pick another instant');
  });

  test('the modal uses the helper, not a raw Date', () => {
    const open = SRC.slice(SRC.indexOf('function openHomeworkModal'), SRC.indexOf('function closeHomeworkModal'));
    assert.match(codeOnly(open), /todayInVietnam\(\)/);
    assert.doesNotMatch(codeOnly(open), /getFullYear/);
  });
});


describe('a give with submissions cannot be deleted from the UI', () => {
  test('the delete button is withheld once anyone has handed in', () => {
    const render = SRC.slice(SRC.indexOf('function renderHomework'),
                             SRC.indexOf('async function loadHomework'));
    assert.match(render, /const canDelete = !p\.submitted/);
    assert.match(render, /Đã có bài nộp/);
  });
});

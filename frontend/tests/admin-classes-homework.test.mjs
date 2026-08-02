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


describe('the default deadline is the next VIABLE Vietnam date (Codex review)', () => {
  // Two separate bugs met here. The date must be Vietnam's, not the browser's.
  // And "today" stops being viable once 19:00 has passed — submitting the
  // untouched form at 20:00 would create a give that is overdue the moment it
  // exists, reporting every student as missing.
  const src = SRC.slice(SRC.indexOf('const VN_TZ'), SRC.indexOf('function fmtDate'));
  const defaultDueDateVietnam = new Function(`${src}; return defaultDueDateVietnam;`)();

  test('before 19:00 Vietnam → today', () => {
    // 11:59Z == 18:59 in Vietnam (+07).
    assert.equal(defaultDueDateVietnam(new Date('2026-08-03T11:59:00Z')), '2026-08-03');
  });

  test('after 19:00 Vietnam → tomorrow, so the give is not born overdue', () => {
    assert.equal(defaultDueDateVietnam(new Date('2026-08-03T12:01:00Z')), '2026-08-04');
  });

  test('just past Vietnam midnight → that same new day', () => {
    // 20:00Z on the 3rd is already 03:00 on the 4th in Vietnam.
    assert.equal(defaultDueDateVietnam(new Date('2026-08-03T20:00:00Z')), '2026-08-04');
  });

  test('the cutoff matches the server rule', () => {
    assert.match(src, /VN_CUTOFF_HOUR = 19/);
    assert.match(src, /timeZone: VN_TZ/);
  });
});


describe('the modal wires the helper, not a raw browser Date', () => {
  test('openHomeworkModal calls the helper and no browser-local getter', () => {
    const open = codeOnly(SRC.slice(SRC.indexOf('function openHomeworkModal'),
                                    SRC.indexOf('function closeHomeworkModal')));
    assert.match(open, /defaultDueDateVietnam\(\)/);
    assert.doesNotMatch(open, /getFullYear|getMonth\(\)|getDate\(\)/,
      'browser-local getters are exactly the bug this replaced');
  });

  test('it really returns the Vietnam date at a day boundary', () => {
    // 2026-08-02T20:00Z is still the 2nd in Los Angeles but already the 3rd in
    // Vietnam (+07) — the fixture must straddle a real boundary to mean anything.
    const boundary = new Date('2026-08-02T20:00:00Z');
    const fmt = (tz) => new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(boundary);
    assert.equal(fmt('Asia/Ho_Chi_Minh'), '2026-08-03');
    assert.equal(fmt('America/Los_Angeles'), '2026-08-02');
  });
});


describe('Full Test is not offered as class homework (Codex review round 3)', () => {
  // A Full Test is a chain of three sessions and its real result is the
  // aggregate across all three; only the opening session would carry the ledger
  // link, so the homework score would deterministically be Part 1's band.
  const page = readFileSync(join(HERE, '..', 'public', 'pages', 'admin', 'classes', 'index.html'), 'utf8');

  test('the mode picker offers only the single-session modes', () => {
    assert.match(page, /<option value="practice">/);
    assert.match(page, /<option value="test_part">/);
    assert.doesNotMatch(page, /<option value="test_full">/,
      'offering a half-working Full Test is worse than not offering it');
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


describe('a failed homework load is not an empty class (Codex review round 4)', () => {
  // Replacing canonical data with [] renders the normal "Chưa giao bài nào",
  // which tells the admin something false — and the toast that said otherwise
  // has already gone.
  const load = SRC.slice(SRC.indexOf('async function loadHomework'),
                         SRC.indexOf('function openHomeworkModal'));
  const render = SRC.slice(SRC.indexOf('function renderHomework'),
                           SRC.indexOf('async function loadHomework'));

  test('failure sets a distinct error state', () => {
    assert.match(load, /_homeworkError = true/);
    assert.match(render, /_homeworkError/);
    assert.match(render, /Không đọc được danh sách bài giao/);
  });

  test('failure releases the once-only load latch so the tab can retry', () => {
    assert.match(load, /_homeworkLoaded = false/,
      'without this, reopening the tab shows the stale failure forever');
  });

  test('a successful load clears the error state', () => {
    assert.match(load, /_homeworkError = false/);
  });

  test('the empty state is restored on a good load, not left as the error text', () => {
    assert.match(render, /Chưa giao bài nào/);
  });
});

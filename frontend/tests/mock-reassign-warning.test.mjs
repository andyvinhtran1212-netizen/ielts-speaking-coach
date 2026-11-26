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
 * Source-sentinels on the Next retake dialog. LEGACYJS-0075 W2 ported these
 * from the retired `admin-mock-exams.js`.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIALOG = readFileSync(join(__dirname, '..', 'app', '(authed-admin)', '(mock-exams)', 'admin', 'mock-exams',
  'retake-assignment-dialog.tsx'), 'utf8');

describe('retake assign — the un-refreshed students are named', () => {
  test('a persistent warning in the dialog, not just a toast', () => {
    assert.match(DIALOG, /const \[warning, setWarning\] = useState<string \| null>\(null\);/);
    assert.match(DIALOG, /\{warning && <div className="mex-alert is-warning" role="alert">\{warning\}<\/div>\}/);
  });

  test('both outcomes are rendered, and kept distinct', () => {
    // `locked` is a deliberate refusal (the student is mid-exam); a failed
    // refresh means nobody knows what that student is now sitting.
    assert.match(DIALOG, /const locked = Array\.isArray\(response\?\.locked\) \? response\.locked : \[\];/);
    assert.match(DIALOG, /const failed = Array\.isArray\(response\?\.refresh_failed\) \? response\.refresh_failed : \[\];/);
    assert.match(DIALOG, /Đang làm bài, giữ assignment cũ: \$\{locked\.map/);
    assert.match(DIALOG, /Không làm mới được lượt thi: \$\{failed\.map/);
  });

  test('names come from the candidate rows already loaded — no extra request', () => {
    assert.match(DIALOG, /const names = new Map\(candidates\.map\(\(row\) => \[row\.userId, row\.studentName\]\)\);/);
    assert.match(DIALOG, /names\.get\(id\) \|\| id/);
  });

  test('the warning clears when a later batch has nothing to report', () => {
    // Both parts empty → '' → nothing rendered; choosing a new source resets it.
    assert.match(DIALOG, /\]\.filter\(Boolean\)\.join\(' '\)\);/);
    assert.match(DIALOG, /setPicked\(\{\}\);\n\s+setWarning\(null\);/);
  });

  test('student names are rendered as text, never as HTML', () => {
    assert.doesNotMatch(DIALOG, /dangerouslySetInnerHTML/);
  });
});

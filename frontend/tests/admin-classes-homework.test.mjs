/**
 * Class homework — cột bài tập phải phân biệt "chưa tới hạn" với "đã trễ" (GĐ 2).
 *
 * The distinction matters because the daily task is due at 19:00. Before the
 * deadline, everyone who has not submitted is simply not due yet — styling that
 * as a warning would put a red flag on every class all day, which trains the
 * teacher to ignore the flag by the time it means something.
 *
 * LEGACYJS-0075 W3b: admin-classes.js is deleted. The homework panel is
 * app/(authed-admin)/(classes)/admin/classes/[cohortId]/admin-class-homework.tsx
 * and its pure helpers (lib/admin-class-homework-model.mjs) are EXECUTED here.
 * Catalogue scope (protected papers, failed library, stale responses) is pinned
 * in admin-class-homework-next-behavior.test.mjs.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  defaultVietnamDueDate,
  homeworkDraft,
  normalizeAssignmentsPayload,
  validateHomeworkDraft,
} from '../lib/admin-class-homework-model.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'app', '(authed-admin)', '(classes)', 'admin', 'classes', '[cohortId]', 'admin-class-homework.tsx'), 'utf8');
const CELL = SRC.slice(SRC.indexOf('<td className="ach-progress-cell">'), SRC.indexOf('</td>', SRC.indexOf('<td className="ach-progress-cell">')));
const row = (progress, extra = {}) => normalizeAssignmentsPayload({ assignments: [{ id: 'a1', skill: 'speaking', progress, ...extra }] }).assignments[0];

describe('submission cell separates not-yet-due from overdue', () => {
  test('only overdue + unsubmitted carries the warning style', () => {
    assert.match(CELL, /\{progress\.missing > 0 && <span className="is-warning">\{progress\.missing\} chưa nộp, đã quá hạn<\/span>\}/);
    assert.equal((CELL.match(/is-warning/g) || []).length, 1, 'no other count may be styled as a warning');
  });
  test('late submissions are reported but not flagged as missing', () => {
    assert.match(CELL, /\{progress\.late > 0 && <span>\{progress\.late\} nộp trễ<\/span>\}/);
  });
  test('a failed or partial progress read says so instead of showing zeros', () => {
    assert.equal(row(null).progress, null);
    assert.equal(row({ assigned: 3, submitted: 1, late: 0 }).progress, null, 'a missing counter is unknown, not 0');
    assert.match(CELL, /: <span className="acd-unknown">Không đọc được<\/span>/);
  });
  test('unactivated learners are their own line, not "chưa nộp"', () => {
    assert.equal(row({ assigned: 4, submitted: 1, late: 0, missing: 1, no_account: 2 }).progress.no_account, 2);
    assert.match(CELL, /\{progress\.no_account > 0 && <span>\{progress\.no_account\} chưa kích hoạt<\/span>\}/);
  });
});

describe('deadline cell', () => {
  test('no deadline is stated, an unparseable one is reported, a real one is Vietnam time', () => {
    const fn = SRC.slice(SRC.indexOf('function formatDue'), SRC.indexOf('function formatLogWhen'));
    assert.match(fn, /if \(!value\) return 'Không hạn';/);
    assert.match(fn, /return 'Hạn không đọc được';/);
    assert.match(fn, /timeZone: 'Asia\/Ho_Chi_Minh'/);
  });
});

describe('the give flow tells the admin who will not receive it', () => {
  test('unactivated students are surfaced on success, as an error banner', () => {
    assert.match(SRC, /if \(canonical && result\?\.unactivated_count\) setBanner\(\{ kind: 'error', text: `\$\{base\} \$\{result\.unactivated_count\} bạn chưa kích hoạt nên chưa nhận được bài\.` \}\)/);
  });
  test('the deadline is sent as a DATE — the 19:00 rule lives on the server', () => {
    const v = validateHomeworkDraft({ ...homeworkDraft(new Date('2026-08-01T00:00:00Z')), title: 'B', contentId: 't1' },
      [{ id: 't1', title: 'T', ready: true, already_given: false }], [], 1);
    assert.equal(v.body.due_date, '2026-08-01');
    assert.equal(v.body.due_time, '19:00');
    assert.equal('due_at' in v.body, false);
  });
});

describe('the default deadline is the next VIABLE Vietnam date (Codex review)', () => {
  test('before 19:00 Vietnam → today', () => {
    assert.equal(defaultVietnamDueDate(new Date('2026-08-07T11:59:00Z')), '2026-08-07');
  });
  test('after 19:00 Vietnam → tomorrow, so the give is not born overdue', () => {
    assert.equal(defaultVietnamDueDate(new Date('2026-08-07T12:00:00Z')), '2026-08-08');
  });
  test('just past Vietnam midnight → that same new day', () => {
    assert.equal(defaultVietnamDueDate(new Date('2026-08-07T17:05:00Z')), '2026-08-08');
  });
  test('the dialog draft uses the helper, not a browser-local getter', () => {
    assert.match(readFileSync(join(HERE, '..', 'lib', 'admin-class-homework-model.mjs'), 'utf8'), /dueDate: defaultVietnamDueDate\(at\)/);
    assert.doesNotMatch(SRC, /\.getDate\(\)|\.getHours\(\)/);
  });
});

describe('Full Test is not offered as class homework (Codex review round 3)', () => {
  test('the Speaking mode picker offers only single-session modes', () => {
    const modes = [...SRC.matchAll(/<option value="(practice|test_part|test_full|full_test)">/g)].map((m) => m[1]);
    assert.deepEqual(modes, ['practice', 'test_part']);
  });
});

describe('a give with submissions or progress unknown cannot be deleted from the UI', () => {
  test('Đóng bài replaces Xóa once anyone handed in, a timed run started, or progress is unknown', () => {
    assert.match(SRC, /progress == null \|\| progress\.submitted > 0 \|\| assignment\.timed_started_at \? <button[^>]*onClick=\{\(\) => void setAssignmentStatus\(assignment, 'archived'\)\}[^>]*>Đóng bài<\/button>/);
  });
  test('an archived give is labelled and can be reopened', () => {
    assert.match(SRC, /if \(row\.status === 'archived'\) return \{ label: 'Đã đóng'/);
    assert.match(SRC, /onClick=\{\(\) => void setAssignmentStatus\(assignment, 'published'\)\} disabled=\{busy\}>Mở lại<\/button>/);
  });
});

describe('a failed homework load is not an empty class (Codex review round 4)', () => {
  test('failure is a distinct error state; a stale list is labelled as such', () => {
    assert.match(SRC, /<strong>Không đọc được danh sách bài giao<\/strong>/);
    assert.match(SRC, /className=\{assignments \? 'acd-warning' : 'acd-state is-error'\}/);
    assert.equal(normalizeAssignmentsPayload({}), null, 'a malformed payload is not an empty list');
  });
  test('a failed repair pass is surfaced, not hidden behind plausible counts', () => {
    assert.equal(normalizeAssignmentsPayload({ assignments: [], reconcile_failed: true }).reconcile_failed, true);
    assert.match(SRC, /\{reconcileFailed && <div className="acd-warning" role="alert">Chưa đối chiếu được một số bài đã nộp;/);
  });
});

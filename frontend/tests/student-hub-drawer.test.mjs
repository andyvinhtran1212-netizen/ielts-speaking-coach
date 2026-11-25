/**
 * student-hub-drawer.test.mjs — Student Hub V1.
 *
 * Per-student slide-over drawer on /admin/students: profile + lớp + target-vs-
 * current + writing progress + essay_history + "Giao writing" deep-link. FE-only,
 * 0 backend new (consumes GET /admin/students/{id} + .../summary). Evolves the
 * Phase 2.5 summary modal in place (ids/contract preserved — see
 * admin-students-redesign.test.mjs). assignments.html honors ?assign_student.
 *
 * LEGACYJS-0075 W3b: admin-students-panel.js is deleted. The profile is now the
 * shared admin Dialog in admin-students-directory.tsx (centred, not a right
 * slide-over: recorded as a gap in docs/TEST_INVARIANT_LEDGER.md). The same
 * contract is pinned on the native owner below.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...r) => readFileSync(join(__dirname, '..', ...r), 'utf8');
const STU = read('app', '(authed-admin)', '(students)', 'admin', 'students', 'admin-students-directory.tsx');
const DIALOG = read('components', 'admin-directory-ui.tsx');
const ASSIGN_MODEL = read('lib', 'admin-writing-assignments-model.mjs');
const ASSIGN = read('pages', 'admin', 'writing', 'assignments.html');


describe('Student Hub — profile dialog (a11y roles)', () => {
  test('shared Dialog renders role=dialog + aria-modal + labelledby', () => {
    assert.match(DIALOG, /role="dialog" aria-modal="true" aria-labelledby=\{titleId\}/);
    assert.match(STU, /function ProfileDialog\(/);
    assert.match(STU, /<Dialog\s+open=\{Boolean\(profile\)\}/);
  });
  test('profile shows account badge, writing stats, assignments and history', () => {
    assert.match(STU, /'Đã kích hoạt tài khoản' : 'Chưa kích hoạt'/);
    assert.match(STU, /<h3>Bài đã giao<\/h3>/);
    assert.match(STU, /<h3>Lịch sử nộp bài<\/h3>/);
  });
});


describe('Student Hub — 0 backend new (consumes existing endpoints)', () => {
  test('profile fetches BOTH the detail + writing-summary endpoints', () => {
    assert.match(STU, /window\.api\.get<unknown>\(`\/admin\/students\/\$\{encodeURIComponent\(student\.id\)\}`\)/);
    assert.match(STU, /window\.api\.get<unknown>\(`\/admin\/writing\/students\/\$\{encodeURIComponent\(student\.id\)\}\/summary`\)/);
  });
  test('repurposes essay_history into the Lịch sử nộp bài list', () => {
    assert.match(STU, /const history = array\(profile\?\.detail\?\.essay_history\)/);
  });
  test('partial-failure tolerant via Promise.allSettled, failures stay visible', () => {
    assert.match(STU, /Promise\.allSettled/);
    assert.match(STU, /Không tải được tổng quan Writing\./);
  });
});


describe('Student Hub — header (account state + bands)', () => {
  test('has_account derived from user_id (no new field)', () => {
    assert.match(STU, /detail\?\.user_id/);
  });
  test('empty-state says "chưa kích hoạt", NOT "không hoạt động"', () => {
    assert.match(STU, /Chưa kích hoạt/);
    assert.doesNotMatch(STU, /không hoạt động/i);
  });
  test('target-vs-current band rendered from the student row', () => {
    assert.match(STU, /Hiện tại \$\{detail\?\.current_band_estimate \?\? '—'\} · Mục tiêu \$\{detail\?\.target_band \?\? '—'\}/);
  });
});


describe('Student Hub — Giao writing reuses assign flow (deep-link, no rebuild)', () => {
  test('profile "Giao bài Writing" deep-links with ?assign_student', () => {
    assert.match(STU, /href=\{assignmentHref\(\{\}, \{ studentId: profile\.id \}\)\}/);
    assert.match(ASSIGN_MODEL, /params\.set\('assign_student', target\.studentId\)/);
  });
  test('assignments.html honors ?assign_student → preselect + open modal', () => {
    assert.match(ASSIGN, /getParam? ?|assign_student/);
    assert.match(ASSIGN, /_preselectStudentId/);
    assert.match(ASSIGN, /_selectedStudentIds\.add\(_preselectStudentId\)/);
    assert.match(ASSIGN, /\.get\(['"]assign_student['"]\)[\s\S]*?openCreateModal\(\)/);
  });
});


describe('Student Hub — a11y (focus trap + return focus + Esc)', () => {
  test('focus-trap on Tab within the dialog', () => {
    assert.match(DIALOG, /if \(event\.key !== 'Tab'\) return;/);
    assert.match(DIALOG, /active === first/);
  });
  test('close returns focus to the opener', () => {
    assert.match(DIALOG, /if \(previous\?\.isConnected\) previous\.focus\(\)/);
  });
  test('Esc closes the dialog unless busy', () => {
    assert.match(DIALOG, /event\.key === 'Escape' && !busyRef\.current/);
  });
});

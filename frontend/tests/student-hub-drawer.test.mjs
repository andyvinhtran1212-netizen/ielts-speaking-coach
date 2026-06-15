/**
 * student-hub-drawer.test.mjs — Student Hub V1.
 *
 * Per-student slide-over drawer on /admin/students: profile + lớp + target-vs-
 * current + writing progress + essay_history + "Giao writing" deep-link. FE-only,
 * 0 backend new (consumes GET /admin/students/{id} + .../summary). Evolves the
 * Phase 2.5 summary modal in place (ids/contract preserved — see
 * admin-students-redesign.test.mjs). assignments.html honors ?assign_student.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...r) => readFileSync(join(__dirname, '..', ...r), 'utf8');
const STU = read('pages', 'admin', 'students', 'index.html');
const ASSIGN = read('pages', 'admin', 'writing', 'assignments.html');


describe('Student Hub — drawer markup (slide-over, a11y roles)', () => {
  test('slide-over panel with dialog role + aria-modal + labelledby', () => {
    assert.match(STU, /class="st-drawer"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="summary-title"/);
  });
  test('new drawer ids present (badge / cohort / no-account / assign / history)', () => {
    for (const id of ['summary-account-badge', 'summary-cohort', 'summary-noaccount', 'summary-assign', 'summary-history']) {
      assert.match(STU, new RegExp(`id="${id}"`), `Missing #${id}`);
    }
  });
  test('drawer CSS anchored right (fixed, right:0) — not a centered modal', () => {
    assert.match(STU, /\.st-drawer\s*\{[\s\S]*?position:\s*fixed[\s\S]*?right:\s*0/);
  });
});


describe('Student Hub — 0 backend new (consumes existing endpoints)', () => {
  test('drawer fetches BOTH the detail + writing-summary endpoints', () => {
    assert.match(STU, /window\.api\.get\(\s*['"]\/admin\/students\/['"]\s*\+\s*studentId\s*\)/);
    assert.match(STU, /window\.api\.get\(\s*['"]\/admin\/writing\/students\/['"]\s*\+\s*studentId\s*\+\s*['"]\/summary['"]/);
  });
  test('repurposes essay_history into the Lịch sử nộp bài list', () => {
    assert.match(STU, /detail\.essay_history/);
    assert.match(STU, /getElementById\(\s*['"]summary-history['"]\s*\)\.innerHTML/);
  });
  test('partial-failure tolerant via Promise.allSettled', () => {
    assert.match(STU, /Promise\.allSettled/);
  });
});


describe('Student Hub — header (account state + bands) ', () => {
  test('has_account derived from user_id (no new field)', () => {
    assert.match(STU, /detail\.user_id/);
  });
  test('empty-state says "chưa kích hoạt", NOT "không hoạt động"', () => {
    assert.match(STU, /Chưa kích hoạt/);
    assert.doesNotMatch(STU, /không hoạt động/i);
  });
  test('target-vs-current band rendered from the student row', () => {
    assert.match(STU, /target_band/);
    assert.match(STU, /current_band_estimate/);
  });
});


describe('Student Hub — Giao writing reuses assign flow (deep-link, no rebuild)', () => {
  test('drawer "Giao writing" deep-links to assignments.html?assign_student', () => {
    assert.match(STU, /assignments\.html\?assign_student='\s*\+\s*encodeURIComponent\(studentId\)/);
  });
  test('assignments.html honors ?assign_student → preselect + open modal', () => {
    assert.match(ASSIGN, /getParam? ?|assign_student/);
    assert.match(ASSIGN, /_preselectStudentId/);
    assert.match(ASSIGN, /_selectedStudentIds\.add\(_preselectStudentId\)/);
    assert.match(ASSIGN, /\.get\(['"]assign_student['"]\)[\s\S]*?openCreateModal\(\)/);
  });
});


describe('Student Hub — a11y (focus trap + return focus + Esc)', () => {
  test('focus-trap on Tab within the drawer', () => {
    assert.match(STU, /e\.key !== 'Tab'/);
    assert.match(STU, /document\.activeElement === first/);
  });
  test('closeSummary returns focus to the opener row control', () => {
    assert.match(STU, /function closeSummary[\s\S]*?_drawerLastFocus[\s\S]*?\.focus\(\)/);
  });
  test('Esc still closes the drawer (preserved)', () => {
    assert.match(STU, /e\.key\s*===\s*['"]Escape['"]/);
    assert.match(STU, /closeSummary\(\)/);
  });
});

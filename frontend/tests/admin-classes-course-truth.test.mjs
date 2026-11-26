/**
 * Class directory — the course cell and course picker must not lie (GĐ 1a).
 *
 * Codex review on the GĐ 1a branch found two ways this screen could quietly
 * misreport canonical data:
 *
 *   1. A class pointing at an ARCHIVED course. The picker used to list active
 *      courses only, so no option matched, the <select> fell back to its empty
 *      first entry, and saving an unrelated field (renaming the class) posted
 *      course_id: null — detaching the class from its course with no error.
 *
 *   2. A FAILED course lookup rendering as "Chưa gán khoá", i.e. a real
 *      assignment displayed as an empty one, sending the admin to fix something
 *      that was never broken.
 *
 * LEGACYJS-0075 W3b: admin-classes.js is deleted. The class list is
 * app/(authed-admin)/(classes)/admin/classes/admin-classes-directory.tsx and its
 * pure helpers live in lib/admin-classes-model.mjs, which are EXECUTED here.
 * The old GĐ 1b tab/panel bootstrap pins retired with the merged page: Lớp and
 * Học viên are now two routes, each with its own static `subsection`.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { cohortDraft, courseOptionLabel, validateCohortDraft } from '../lib/admin-classes-model.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(HERE, '..', ...p), 'utf8');
const DIR = read('app', '(authed-admin)', '(classes)', 'admin', 'classes', 'admin-classes-directory.tsx');
const CELL = DIR.slice(DIR.indexOf('function CourseCell'), DIR.indexOf('\n}\n', DIR.indexOf('function CourseCell')));
const COURSES_API = read('lib', 'admin-courses-api.ts');

describe('course cell tells apart unassigned / archived / unreadable', () => {
  test('no course id at all → "Chưa gán khoá"', () => {
    assert.match(CELL, /return <span className="acd-muted">Chưa gán khoá<\/span>;\s*$/);
  });
  test('course id present but unresolved → "Không đọc được", never "Chưa gán khoá"', () => {
    assert.match(CELL, /if \(cohort\.course_id\) return <span className="acd-unknown">\{lookupFailed \? 'Không đọc được khoá' : 'Khoá không còn trong danh mục'\}<\/span>;/);
    assert.ok(CELL.indexOf('cohort.course_id') < CELL.indexOf('Chưa gán khoá'), 'the unresolved branch must run first');
  });
  test('resolved course renders its code, and marks an archived one', () => {
    assert.match(CELL, /\{cohort\.course\.code && <span className="adm-chip">\{cohort\.course\.code\}<\/span>\}/);
    assert.match(CELL, /\{!cohort\.course\.is_active && <small>Đã lưu trữ<\/small>\}/);
    assert.equal(courseOptionLabel({ code: 'C0', name: 'Khoá cũ', is_active: false }), 'C0 — Khoá cũ (đã lưu trữ)');
  });
});

describe('course picker never silently detaches a class', () => {
  test('an archived or unknown course the class still points at stays selected', () => {
    assert.match(DIR, /const selectedCourseKnown = !draft\?\.courseId \|\| courses\.some\(\(course\) => course\.id === draft\.courseId\);/);
    assert.match(DIR, /\{draft\?\.courseId && !selectedCourseKnown && <option value=\{draft\.courseId\}>Khóa hiện tại \(không đọc được tên\)<\/option>\}/);
  });
  test('renaming a class keeps its course id (no course_id: null on save)', () => {
    const draft = cohortDraft({ id: 'c1', name: 'Lớp A', course_id: 'archived-course' });
    draft.name = 'Lớp A mới';
    assert.equal(validateCohortDraft(draft).body.course_id, 'archived-course');
  });
  test('a class with no course saves unassigned', () => {
    assert.equal(validateCohortDraft(cohortDraft({ id: 'c2', name: 'Lớp B', course_id: null })).body.course_id, null);
  });
});

describe('the course fetch includes archived courses', () => {
  test('the directory reads every course, not is_active=true only', () => {
    assert.match(DIR, /getAdminCohorts\(\{ withRollup: true \}\),\s*getAdminCourses\(\),/);
    assert.match(COURSES_API, /if \(options\.isActive !== undefined\) query\.set\('is_active'/);
    assert.match(DIR, /Bao gồm cả khóa đã lưu trữ để không làm mất liên kết lịch sử\./);
  });
  test('a failed course catalogue locks the picker instead of offering a wrong empty choice', () => {
    assert.match(DIR, /disabled=\{Boolean\(coursesError\)\}/);
    assert.match(DIR, /Không đọc được danh mục; giá trị hiện tại được giữ nguyên khi lưu\./);
  });
});

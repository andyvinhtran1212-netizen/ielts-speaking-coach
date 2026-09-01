import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  cohortDraft,
  cohortSummary,
  courseOptionLabel,
  foldVietnamese,
  normalizeCohortsPayload,
  normalizeCoursesPayload,
  selectCohorts,
  validateCohortDraft,
} from '../lib/admin-classes-model.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-admin-classes)', 'admin', 'classes', 'page.tsx');
const DIRECTORY = read('app', '(authed-admin-classes)', 'admin', 'classes', 'admin-classes-directory.tsx');
const UI = read('components', 'admin-directory-ui.tsx');
const LAYOUT = read('app', '(authed-admin-classes)', 'layout.tsx');
const CSS = read('public', 'css', 'admin-classes-next.css');
const MODEL = read('lib', 'admin-classes-model.mjs');
const CHROME = read('public', 'js', 'components', 'aver-admin-chrome.js');
const LEGACY = read('public', 'pages', 'admin', 'classes', 'index.html');
const LEDGER = read('..', 'docs', 'ROUTE_LEDGER.md');
const WORKFLOW = read('..', '.github', 'workflows', 'parity-gate.yml');
const BROWSER = read('tooling', 'verify-admin-classes-flow.mjs');

describe('/admin/classes — native directory ownership', () => {
  test('uses backend admin gate and enters the native detail/student routes', () => {
    assert.match(PAGE, /<AdminAccessGate>/);
    assert.match(PAGE, /active="classes" subsection="classes"/);
    assert.match(DIRECTORY, /href="\/admin\/students"/);
    assert.match(DIRECTORY, /`\/admin\/classes\/\$\{encodeURIComponent\(cohort\.id\)\}`/);
    assert.match(LEGACY, /id="view-detail"/);
    assert.match(LEDGER, /`\/admin\/classes`[^\n]+native directory ownership/);
  });

  test('loads canonical rollup and all courses, then reloads after every mutation', () => {
    assert.match(DIRECTORY, /'\/admin\/cohorts\?with_rollup=true'/);
    assert.match(DIRECTORY, /'\/admin\/courses'/);
    assert.doesNotMatch(DIRECTORY, /\/admin\/courses\?is_active=true/);
    assert.match(DIRECTORY, /await action\(\);[\s\S]+await loadDirectory\(true\)/);
    assert.match(DIRECTORY, /await window\.api\.(?:patch|post)[\s\S]+await loadDirectory\(true\)/);
    assert.match(DIRECTORY, /is_active: current\.nextActive/);
  });

  test('shows truthful failure states and keeps course links intact', () => {
    assert.match(DIRECTORY, /payload\.rollup_failed/);
    assert.match(DIRECTORY, /Không đọc được sĩ số/);
    assert.match(DIRECTORY, /payload\.course_lookup_failed/);
    assert.match(DIRECTORY, /Khóa hiện tại \(không đọc được tên\)/);
    assert.match(DIRECTORY, /disabled=\{Boolean\(coursesError\)\}/);
    assert.doesNotMatch(DIRECTORY, /setPayload\(\{ cohorts: \[\], rollup_failed: true/);
    assert.doesNotMatch(DIRECTORY, /setCourses\(\[\]\);\s*setCoursesError/);
    assert.match(DIRECTORY, /Dữ liệu bên dưới có thể đã cũ/);
    assert.match(DIRECTORY, /Chưa đọc được số chưa kích hoạt/);
    assert.match(DIRECTORY, /hasCohortSnapshot \? summary\.students : null/);
    assert.match(DIRECTORY, /showingStaleCohorts = Boolean\(loadError && hasCohortSnapshot\)/);
    assert.match(MODEL, /course_id: courseId \|\| null/);
    assert.doesNotMatch(DIRECTORY, /dangerouslySetInnerHTML|\.innerHTML/);
  });

  test('ships stable dialog focus, contained table and responsive rules', () => {
    assert.match(UI, /\}, \[open\]\);/);
    assert.match(UI, /busyRef\.current/);
    assert.match(UI, /event\.key !== 'Tab'/);
    assert.match(CSS, /\.acd-table-scroll\s*\{[^}]*overflow-x:\s*auto/s);
    assert.match(CSS, /@media \(max-width: 768px\)/);
    assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(LAYOUT, /admin-classes-next\.css/);
  });

  test('canonical navigation enters native directory and exits to legacy student workspace', () => {
    assert.match(CHROME, /section:\s*'classes'[^}]*href:\s*'\/admin\/classes'/);
    assert.match(CHROME, /slug:\s*'classes'[^}]*href:\s*'\/admin\/classes'/);
    assert.match(CHROME, /slug:\s*'students'[^}]*href:\s*'\/admin\/students'/);
  });

  test('fixture-backed browser contract is gated in CI', () => {
    assert.match(WORKFLOW, /frontend\/app\/\(authed-admin-classes\)\/\*\*/);
    assert.match(WORKFLOW, /frontend\/public\/css\/admin-classes-next\.css/);
    assert.match(WORKFLOW, /node tooling\/verify-admin-classes-flow\.mjs/);
    assert.match(BROWSER, /unexpectedWrites/);
    assert.match(BROWSER, /canonical reload/);
    assert.match(BROWSER, /initial cohort failure never becomes fake zero/);
  });
});

describe('admin classes model — canonical truth and filtering', () => {
  const activeCourse = { id: 'course-active', code: 'C1', name: 'Nền tảng', is_active: true, sort_order: 1 };
  const archivedCourse = { id: 'course-old', code: 'C0', name: 'Khoá cũ', is_active: false, sort_order: 0 };

  test('normalizes hostile/partial payloads without inventing ids or counts', () => {
    const result = normalizeCohortsPayload({
      rollup_failed: true,
      course_lookup_failed: true,
      cohorts: [null, { name: 'missing id' }, { id: 'c1', name: '<img>', member_count: '4', unactivated_count: null, course_id: 'course-active', course: activeCourse }],
    });
    assert.equal(result.cohorts.length, 1);
    assert.equal(result.cohorts[0].name, '<img>');
    assert.equal(result.cohorts[0].member_count, 4);
    assert.equal(result.cohorts[0].unactivated_count, null);
    assert.equal(result.rollup_failed, true);
    assert.equal(result.course_lookup_failed, true);
    assert.deepEqual(normalizeCoursesPayload({ courses: [activeCourse, archivedCourse, { name: 'missing id' }] }).map((item) => item.id), ['course-active', 'course-old']);
  });

  test('summary excludes archived classes and never converts unknown rollup to zero', () => {
    const cohorts = normalizeCohortsPayload({ cohorts: [
      { id: 'a', name: 'Active', member_count: 4, unactivated_count: 1, is_active: true },
      { id: 'b', name: 'Archived', member_count: 99, unactivated_count: 50, is_active: false },
    ] }).cohorts;
    assert.deepEqual(cohortSummary(cohorts, false), { active: 1, total: 2, students: 4, unactivated: 1 });
    assert.deepEqual(cohortSummary(cohorts, true), { active: 1, total: 2, students: null, unactivated: null });
    const partial = normalizeCohortsPayload({ cohorts: [
      { id: 'c', name: 'Partial', member_count: 7, unactivated_count: null, is_active: true },
    ] }).cohorts;
    assert.deepEqual(cohortSummary(partial, false), { active: 1, total: 1, students: 7, unactivated: null });
  });

  test('filters status/course and folds Vietnamese search', () => {
    const cohorts = normalizeCohortsPayload({ cohorts: [
      { id: 'a', name: 'Lớp Nền Tảng', code_prefix: 'AUG4', course_id: 'course-active', is_active: true },
      { id: 'b', name: 'Khóa cũ', code_prefix: 'OLD', course_id: 'course-old', is_active: false },
    ] }).cohorts;
    assert.equal(foldVietnamese('Lớp Nền Tảng'), 'lop nen tang');
    assert.deepEqual(selectCohorts(cohorts, { status: 'active', courseId: 'course-active', search: 'nen tang' }).map((item) => item.id), ['a']);
    assert.deepEqual(selectCohorts(cohorts, { status: 'archived', search: 'old' }).map((item) => item.id), ['b']);
  });

  test('draft preserves unresolved course and sends explicit null for clearable fields', () => {
    const draft = cohortDraft({ id: 'c1', name: 'Lớp A', course_id: 'orphan', code_prefix: null, description: null });
    draft.name = 'Lớp A mới';
    assert.deepEqual(validateCohortDraft(draft), {
      ok: true,
      body: { name: 'Lớp A mới', course_id: 'orphan', code_prefix: null, description: null },
    });
    draft.courseId = '';
    assert.equal(validateCohortDraft(draft).body.course_id, null);
    assert.equal(validateCohortDraft({ ...draft, name: '' }).ok, false);
    assert.equal(validateCohortDraft({ ...draft, codePrefix: 'x'.repeat(21) }).ok, false);
  });

  test('course labels include archived state', () => {
    assert.equal(courseOptionLabel(activeCourse), 'C1 — Nền tảng');
    assert.equal(courseOptionLabel(archivedCourse), 'C0 — Khoá cũ (đã lưu trữ)');
  });
});

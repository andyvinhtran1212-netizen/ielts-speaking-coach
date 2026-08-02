/**
 * admin-classes.js — the course cell and course picker must not lie (GĐ 1a).
 *
 * Codex review on the GĐ 1a branch found two ways this screen could quietly
 * misreport canonical data. Both are pinned here by EXECUTING the real
 * functions, not by matching their source: the bugs were about what the
 * rendered value means, and a regex over the source cannot tell the difference
 * between "Chưa gán khoá" printed for an unassigned class and the same string
 * printed for one whose course simply failed to load.
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
 * The functions are lifted out of the module source and run with stubs because
 * the module has top-level browser side effects (window.api, Supabase bootstrap)
 * that cannot be imported under node --test.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'public', 'js', 'admin-classes.js'), 'utf8');

/** Lift the pure render helpers out of the module and bind them to stubs. */
function loadHelpers(courses) {
  const start = SRC.indexOf('function courseLabel');
  const end = SRC.indexOf('function renderList');
  assert.ok(start !== -1 && end > start, 'helper block not found — did the module get restructured?');

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const el = { innerHTML: '', value: '' };
  const $ = () => el;
  const countLabel = (n) => String(n);

  const factory = new Function(
    'esc', '$', 'countLabel', '_courses',
    `${SRC.slice(start, end)}
     return { courseLabel, renderCourseOptions, courseOptionLabel };`,
  );
  return { ...factory(esc, $, countLabel, courses), el };
}

const ACTIVE = { id: 'c-active', code: 'C2', name: 'Kỹ năng nền tảng', is_active: true };
const ARCHIVED = { id: 'c-archived', code: 'C9', name: 'Khoá cũ', is_active: false };


describe('course cell tells apart unassigned / archived / unreadable', () => {
  test('no course id at all → "Chưa gán khoá"', () => {
    const { courseLabel } = loadHelpers([ACTIVE]);
    assert.match(courseLabel(null, null), /Chưa gán khoá/);
  });

  test('course id present but unresolved → "Không đọc được", never "Chưa gán khoá"', () => {
    const { courseLabel } = loadHelpers([ACTIVE]);
    const html = courseLabel(null, 'c-active');
    assert.match(html, /Không đọc được khoá/);
    assert.doesNotMatch(html, /Chưa gán khoá/,
      'a failed lookup rendered as "unassigned" sends the admin to re-assign a course that is already assigned');
  });

  test('resolved course renders its code, and marks an archived one', () => {
    const { courseLabel } = loadHelpers([ACTIVE, ARCHIVED]);
    assert.match(courseLabel(ACTIVE, ACTIVE.id), /C2/);
    assert.doesNotMatch(courseLabel(ACTIVE, ACTIVE.id), /đã lưu trữ/);
    assert.match(courseLabel(ARCHIVED, ARCHIVED.id), /đã lưu trữ/);
  });
});


describe('course picker never silently detaches a class', () => {
  const selectedValues = (html) => {
    const out = [];
    const re = /<option value="([^"]*)"[^>]*\sselected[^>]*>/g;
    let m;
    while ((m = re.exec(html)) !== null) out.push(m[1]);
    return out;
  };

  test('an archived course the class still points at stays selected', () => {
    const { renderCourseOptions, el } = loadHelpers([ACTIVE, ARCHIVED]);
    renderCourseOptions(ARCHIVED.id);
    assert.deepEqual(selectedValues(el.innerHTML), [ARCHIVED.id]);
  });

  test('a course id missing from the list keeps its own selected option', () => {
    // This is the failed-fetch case: _courses is empty but the class has a course.
    const { renderCourseOptions, el } = loadHelpers([]);
    renderCourseOptions('c-unknown');
    assert.deepEqual(selectedValues(el.innerHTML), ['c-unknown'],
      'with no option selected the <select> falls back to "" and the next save posts course_id: null');
    assert.match(el.innerHTML, /Khoá hiện tại/);
  });

  test('a class with no course selects nothing (so saving keeps it unassigned)', () => {
    const { renderCourseOptions, el } = loadHelpers([ACTIVE]);
    renderCourseOptions(null);
    assert.deepEqual(selectedValues(el.innerHTML), []);
  });

  test('the normal case still selects the right active course', () => {
    const { renderCourseOptions, el } = loadHelpers([ACTIVE, ARCHIVED]);
    renderCourseOptions(ACTIVE.id);
    assert.deepEqual(selectedValues(el.innerHTML), [ACTIVE.id]);
  });
});


describe('the course fetch includes archived courses', () => {
  test('loadCourses does not filter to is_active=true', () => {
    // The picker cannot keep an archived course selected if it never arrives.
    assert.doesNotMatch(SRC, /\/admin\/courses\?is_active=true/,
      'filtering the fetch to active courses reintroduces the silent-detach bug');
    assert.match(SRC, /api\.get\('\/admin\/courses'\)/);
  });
});

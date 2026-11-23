// ADMINIA-0074 FR-106 (G09-T40): teacher table and profile.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  formatMaybeCount,
  formatReviewHours,
  instructorProfileHref,
  nextTeacherSort,
  normalizeCohortChoices,
  normalizeInstructorProfile,
  normalizeInstructorsPayload,
  normalizeTeacherOverview,
  parseTeacherSort,
  removeTeacherSummary,
  sortTeachers,
} from '../lib/admin-instructors-model.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'app', '(authed-admin)', '(instructors)', 'admin', 'instructors');
const LIST = readFileSync(join(DIR, 'admin-instructors.tsx'), 'utf8');
const PROFILE = readFileSync(join(DIR, '[instructorId]', 'admin-instructor-profile.tsx'), 'utf8');
const PROFILE_PAGE = readFileSync(join(DIR, '[instructorId]', 'page.tsx'), 'utf8');

const base = { students: 1, prompts: 0, graded: 0, regraded: 0, regrade_events: 0, tokens: 0, cost_usd: 0 };

describe('teacher overview payload', () => {
  test('reads classes and counts, and keeps an unreadable number as null, never 0', () => {
    const row = normalizeTeacherOverview({
      classes: [{ id: 'c1', name: 'Lớp 1', writing_pending: 4, writing_overdue: null }, { name: 'no id' }],
      writing_pending: 4, writing_overdue: null, delivered_30d: 9, in_progress: 0, avg_review_hours: 12.5,
    });
    assert.deepEqual(row.classes, [{ id: 'c1', name: 'Lớp 1', writingPending: 4, writingOverdue: null, speakingMockPending: null }]);
    assert.equal(row.writingOverdue, null);
    assert.equal(row.inProgress, 0);
    assert.equal(row.avgReviewHours, 12.5);
  });

  test('an older backend without the fields reads as "chưa có", not as no classes', () => {
    const [row] = normalizeInstructorsPayload([{ instructor_id: 'gv', ...base }]).rows;
    assert.equal(row.classes, null);
    assert.equal(row.writingPending, null);
    assert.equal(formatMaybeCount(row.writingPending), 'chưa có');
    assert.equal(formatMaybeCount(0), '0');
  });

  test('the profile keeps the W-8 Writing numbers', () => {
    const profile = normalizeInstructorProfile({ instructor_id: 'gv', ...base, classes: [] });
    assert.equal(profile.students, 1);
    assert.deepEqual(profile.classes, []);
    assert.equal(normalizeInstructorProfile({ instructor_id: 'gv' }), null);
  });
});

describe('sorting', () => {
  const rows = [
    { instructorId: 'a', displayName: 'An', classes: [{}, {}], writingPending: 2, avgReviewHours: null },
    { instructorId: 'b', displayName: 'Bình', classes: null, writingPending: null, avgReviewHours: 5 },
    { instructorId: 'c', displayName: 'Châu', classes: [{}], writingPending: 9, avgReviewHours: 20 },
  ];
  const ids = (list) => list.map((r) => r.instructorId);

  test('sorts each column and keeps unknown values last in both directions', () => {
    assert.deepEqual(ids(sortTeachers(rows, { key: 'name', dir: 'asc' })), ['a', 'b', 'c']);
    assert.deepEqual(ids(sortTeachers(rows, { key: 'pending', dir: 'desc' })), ['c', 'a', 'b']);
    assert.deepEqual(ids(sortTeachers(rows, { key: 'pending', dir: 'asc' })), ['a', 'c', 'b']);
    assert.deepEqual(ids(sortTeachers(rows, { key: 'classes', dir: 'desc' })), ['a', 'c', 'b']);
    assert.deepEqual(ids(sortTeachers(rows, { key: 'speed', dir: 'asc' })), ['b', 'c', 'a']);
  });

  test('reads and toggles the URL sort', () => {
    assert.deepEqual(parseTeacherSort('?sort=pending&dir=desc'), { key: 'pending', dir: 'desc' });
    assert.deepEqual(parseTeacherSort('?sort=evil'), { key: 'name', dir: 'asc' });
    assert.deepEqual(nextTeacherSort({ key: 'name', dir: 'asc' }, 'pending'), { key: 'pending', dir: 'desc' });
    assert.deepEqual(nextTeacherSort({ key: 'pending', dir: 'desc' }, 'pending'), { key: 'pending', dir: 'asc' });
  });
});

describe('wording', () => {
  test('review speed is blank below the minimum and readable above it', () => {
    assert.equal(formatReviewHours(null), '');
    assert.equal(formatReviewHours(.4), 'dưới 1 giờ');
    assert.equal(formatReviewHours(10.25), '10,3 giờ');
    assert.equal(formatReviewHours(72), '3 ngày');
  });

  test('the remove confirm names what moves to the admin queue', () => {
    assert.equal(
      removeTeacherSummary({ writingPending: 3, speakingMockPending: null }),
      'Lớp sẽ không còn giáo viên. 3 bài Writing chờ duyệt và số bài Speaking thi thử chờ chấm: chưa có sẽ chuyển về hàng chờ của admin.',
    );
    assert.match(removeTeacherSummary({ writingPending: null }), /Chưa đếm được số bài Writing chờ duyệt/);
  });

  test('profile links and class choices', () => {
    assert.equal(instructorProfileHref('gv/1'), '/admin/instructors/gv%2F1');
    assert.equal(normalizeCohortChoices({}), null);
    assert.deepEqual(normalizeCohortChoices({ cohorts: [
      { id: 'c2', name: 'Zeta', is_active: true, instructor: { id: 't1', name: 'Cô A' } },
      { id: 'c1', name: 'Alpha', is_active: true, instructor_id: null },
      { id: 'c3', name: 'Cũ', is_active: false },
    ] }), [
      { id: 'c1', name: 'Alpha', teacherId: null, teacherName: null },
      { id: 'c2', name: 'Zeta', teacherId: 't1', teacherName: 'Cô A' },
    ]);
  });
});

describe('page contracts', () => {
  test('the list is a sortable table, read-only, with a profile link per teacher', () => {
    assert.match(LIST, /<table className="ain-table">/);
    assert.match(LIST, /aria-sort=/);
    assert.match(LIST, /instructorProfileHref\(row\.instructorId\)/);
    assert.doesNotMatch(LIST, /ain-card|ain-list/);
    assert.doesNotMatch(LIST, /window\.api\.(post|put|patch|delete)/);
  });

  test('the profile is a child route behind the admin gate', () => {
    assert.ok(existsSync(join(DIR, '[instructorId]', 'page.tsx')));
    assert.match(PROFILE_PAGE, /<AdminAccessGate>/);
    assert.match(PROFILE_PAGE, /<aver-admin-chrome active="instructors">/);
    assert.match(PROFILE, /window\.api\.get<unknown>\(path\)/);
    assert.match(PROFILE, /`\/admin\/instructors\/\$\{encodeURIComponent\(instructorId\)\}`/);
  });

  test('every class change is one PATCH of cohorts.instructor_id, confirmed, then refetched', () => {
    const writes = PROFILE.match(/window\.api\.(post|put|patch|delete)\(/g) || [];
    assert.deepEqual(writes, ['window.api.patch(']);
    assert.match(PROFILE, /window\.api\.patch\(`\/admin\/cohorts\/\$\{encodeURIComponent\(cohortId\)\}`, \{\s*instructor_id: pending\.kind === 'remove' \? null : instructorId,/);
    assert.match(PROFILE, /<Dialog\n/);
    assert.match(PROFILE, /finally \{[\s\S]*?void load\(\);/);
    assert.doesNotMatch(PROFILE, /Thêm giáo viên|đồng giáo viên|trợ giảng/i);
  });
});

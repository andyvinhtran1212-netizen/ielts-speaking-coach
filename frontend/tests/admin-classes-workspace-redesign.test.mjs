/**
 * Lớp & Học viên workspace — truthful directory, roster, assignments, students.
 *
 * LEGACYJS-0075 W3b: admin-classes.js and admin-students-panel.js are deleted.
 * The surviving behaviour contracts of the handcrafted workspace are EXECUTED
 * here on the native models, with a few source pins on the Next owners:
 *   - app/(authed-admin-classes)/admin/classes/admin-classes-directory.tsx
 *   - app/(authed-admin-classes)/admin/classes/[cohortId]/admin-class-detail.tsx
 *   - app/(authed-admin-students)/admin/students/admin-students-directory.tsx
 * Legacy page ids, the handcrafted `admin-classes-workspace.css` layout and the
 * four-step wizard retired with the merged page; the native layouts are pinned
 * in admin-classes-next-behavior, admin-class-detail-next-behavior,
 * admin-class-homework-next-behavior and admin-students-next-behavior.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cohortSummary, foldVietnamese, selectCohorts } from '../lib/admin-classes-model.mjs';
import { rosterSummary, selectRoster } from '../lib/admin-class-detail-model.mjs';
import { assignmentSummary } from '../lib/admin-class-homework-model.mjs';
import { cohortTruth, studentSummary } from '../lib/admin-students-model.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(HERE, '..', ...p), 'utf8');
const DIR = read('app', '(authed-admin-classes)', 'admin', 'classes', 'admin-classes-directory.tsx');
const DETAIL = read('app', '(authed-admin-classes)', 'admin', 'classes', '[cohortId]', 'admin-class-detail.tsx');
const STUDENTS = read('app', '(authed-admin-students)', 'admin', 'students', 'admin-students-directory.tsx');

describe('workspace — class directory', () => {
  test('list transport failure is distinct from an empty directory', () => {
    assert.match(DIR, /<strong>Không tải được danh sách lớp mới nhất<\/strong>/);
    assert.match(DIR, /value == null \? <span className="acd-unknown">Chưa đọc được<\/span>/);
  });
  test('behaviour: student KPIs exclude archived classes; a failed rollup is unknown, not 0', () => {
    const cohorts = [
      { id: 'a', is_active: true, member_count: 4, unactivated_count: 1 },
      { id: 'b', is_active: false, member_count: 9, unactivated_count: 7 },
    ];
    assert.deepEqual(cohortSummary(cohorts), { active: 1, total: 2, students: 4, unactivated: 1 });
    assert.deepEqual(cohortSummary(cohorts, true), { active: 1, total: 2, students: null, unactivated: null });
  });
  test('local search folds Vietnamese diacritics', () => {
    assert.equal(foldVietnamese('Lớp Đặc biệt'), 'lop dac biet');
    assert.deepEqual(selectCohorts([{ id: '1', name: 'Lớp Đặc biệt', is_active: true }, { id: '2', name: 'Khác', is_active: true }], { search: 'dac' }).map((c) => c.id), ['1']);
  });
});

describe('workspace — class dialog and hierarchy', () => {
  test('class name is programmatically required', () => {
    assert.match(DIR, /<Field label="Tên lớp"><input autoFocus required maxLength=\{200\}/);
  });
  test('back breadcrumb names its destination', () => {
    assert.match(DETAIL, /<nav className="acx-breadcrumb" aria-label="Đường dẫn"><Link href="\/admin\/classes">Lớp & Học viên<\/Link><span>\/<\/span><strong aria-current="page">/);
  });
});

describe('workspace — roster', () => {
  const members = [{ name: 'An', student_code: 'A1', user_id: 'u1' }, { name: 'Bình', student_code: 'B2', user_id: null }];
  test('detail header totals come from the canonical roster', () => {
    assert.deepEqual(rosterSummary(members), { total: 2, activated: 1, unactivated: 1 });
    assert.match(DETAIL, /<span>Chưa kích hoạt<\/span><strong>\{summary\.unactivated\.toLocaleString\('vi-VN'\)\}<\/strong>/);
  });
  test('behaviour: account filter renders only truthful matching rows', () => {
    assert.deepEqual(selectRoster(members, { account: 'unactivated' }).map((m) => m.name), ['Bình']);
    assert.deepEqual(selectRoster(members, { search: 'a1' }).map((m) => m.name), ['An']);
    assert.match(DETAIL, /\{visibleMembers\.length\.toLocaleString\('vi-VN'\)\} \/ \{members\.length\.toLocaleString\('vi-VN'\)\} học viên/);
  });
  test('no-match is distinct from an empty class', () => {
    assert.match(DETAIL, /title="Lớp chưa có học viên"/);
    assert.match(DETAIL, /title="Không có học viên khớp bộ lọc"/);
  });
});

describe('workspace — assignments', () => {
  test('behaviour: expired work is never counted as open', () => {
    const now = Date.parse('2026-08-05T00:00:00Z');
    assert.deepEqual(assignmentSummary([
      { status: 'published', due_at: '2026-08-04T12:00:00Z' },
      { status: 'published', due_at: '2026-08-06T12:00:00Z' },
      { status: 'archived', due_at: '2026-08-06T12:00:00Z' },
    ], now), { open: 1, dueSoon: 1, closed: 1 });
  });
});

describe('workspace — student directory', () => {
  test('behaviour: student KPI values are derived from the current canonical rows', () => {
    const s = studentSummary([
      { cohorts: [], cohort_id: null, target_date: '2026-09-01' },
      { cohorts: [{ id: 'c' }], target_date: '2027-12-01' },
    ], new Date(2026, 7, 1));
    assert.deepEqual(s, { total: 2, unassigned: 1, upcoming: 1 });
  });
  test('behaviour: a failed cohort-name lookup never counts an assigned student as unassigned', () => {
    assert.equal(cohortTruth({ cohort_id: 'c1', cohort_lookup_failed: true }).kind, 'unknown');
    assert.equal(cohortTruth({ cohort_id: null, membership_lookup_failed: true }).kind, 'unknown');
    assert.equal(cohortTruth({ cohort_id: null }).kind, 'unassigned');
  });
  test('date-only targets are parsed as local calendar dates', () => {
    assert.match(read('lib', 'admin-students-model.mjs'), /new Date\(`\$\{row\.target_date\}T00:00:00`\)/);
  });
  test('bulk assignment remains canonical and can clear selection', () => {
    assert.match(STUDENTS, /onClick=\{\(\) => setSelected\(new Set\(\)\)\} disabled=\{busy\}>Bỏ chọn<\/button>/);
  });
});

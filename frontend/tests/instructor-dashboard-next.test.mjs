import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

import {
  assignmentTone,
  buildInstructorMatrix,
  instructorApiPath,
  instructorGradeHref,
  normalizeInstructorAssignments,
  normalizeInstructorCodes,
  normalizeInstructorCohorts,
  normalizeInstructorProfile,
  normalizeInstructorPrompts,
  normalizeInstructorQueue,
  normalizeInstructorStudents,
  normalizeInstructorSummary,
} from '../lib/instructor-dashboard-model.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = readFileSync(join(ROOT, 'app', '(authed-instructor)', 'instructor', 'page.tsx'), 'utf8');
const VIEW = readFileSync(join(ROOT, 'app', '(authed-instructor)', 'instructor', 'instructor-dashboard.tsx'), 'utf8');
const LAYOUT = readFileSync(join(ROOT, 'app', '(authed-instructor)', 'layout.tsx'), 'utf8');

describe('/instructor native dashboard model', () => {
  test('normalizes every canonical owner-scoped collection and rejects malformed envelopes', () => {
    assert.deepEqual(normalizeInstructorProfile({ id: 'u1', role: 'instructor' }), { id: 'u1', role: 'instructor', email: null });
    assert.equal(normalizeInstructorProfile({ id: 'u1' }), null);
    assert.deepEqual(normalizeInstructorCohorts([{ id: 'c1', name: 'Class 1', created_at: '2026-01-01' }]), [{ id: 'c1', name: 'Class 1', createdAt: '2026-01-01' }]);
    assert.deepEqual(normalizeInstructorStudents([{ id: 's1', full_name: 'An', student_code: 'HV1', cohort_id: 'c1', user_id: null }]), [{ id: 's1', fullName: 'An', studentCode: 'HV1', cohortId: 'c1', userId: null }]);
    assert.deepEqual(normalizeInstructorPrompts([{ id: 'p1', title: 'Task', task_type: 'task2' }]), [{ id: 'p1', title: 'Task', taskType: 'task2' }]);
    assert.deepEqual(normalizeInstructorCodes([{ id: 'k1', code: 'ABC', is_used: false, cohort_id: null }]), [{ id: 'k1', code: 'ABC', isUsed: false, cohortId: null }]);
    assert.deepEqual(normalizeInstructorAssignments([{ id: 'a1', prompt_id: 'p1', student_id: 's1', status: 'assigned' }]), [{ id: 'a1', promptId: 'p1', studentId: 's1', status: 'assigned', essayId: null, deadline: null }]);
    assert.deepEqual(normalizeInstructorQueue([{ essay_id: 'e1', task_type: 'task2', review: { id: 'r1', status: 'queued' } }]), [{ essayId: 'e1', reviewId: 'r1', status: 'queued', studentEmail: null, taskType: 'task2' }]);
    assert.equal(normalizeInstructorStudents({ rows: [] }), null);
    assert.equal(normalizeInstructorAssignments([{ id: 'a1', prompt_id: 'p1' }]), null);
    assert.equal(normalizeInstructorAssignments([{ id: 'a1', prompt_id: 'p1', student_id: 's1' }]), null);
  });

  test('normalizes student summary without treating malformed recent essays as empty', () => {
    const summary = normalizeInstructorSummary({
      student: { id: 's1', full_name: 'An', student_code: 'HV1', target_band: 7.0 },
      stats: { total_essays: 3, graded_count: 2, flagged_count: 1, average_band_last5: 6.5 },
      recent_essays: [{ id: 'e1', task_type: 'task2', status: 'delivered' }],
    });
    assert.equal(summary.student.fullName, 'An');
    assert.equal(summary.student.targetBand, '7');
    assert.equal(summary.stats.averageBandLast5, 6.5);
    assert.equal(summary.recentEssays[0].status, 'delivered');
    assert.equal(normalizeInstructorSummary({ student: { id: 's1' }, stats: {}, recent_essays: null }), null);
    assert.equal(normalizeInstructorSummary({ student: { id: 's1' }, stats: { total_essays: 'bad', graded_count: 0, flagged_count: 0 }, recent_essays: [] }), null);
    assert.equal(normalizeInstructorSummary({ student: { id: 's1' }, stats: { total_essays: false, graded_count: 0, flagged_count: 0 }, recent_essays: [] }), null);
    assert.equal(normalizeInstructorSummary({ student: { id: 's1' }, stats: { total_essays: 0, graded_count: 0, flagged_count: 0 }, recent_essays: [{ status: 'delivered' }] }), null);
    assert.equal(normalizeInstructorSummary({ student: { id: 's1', target_band: 'not-a-band' }, stats: { total_essays: 0, graded_count: 0, flagged_count: 0 }, recent_essays: [] }).student.targetBand, null);
  });

  test('propagates impersonation only to instructor API paths and preserves existing queries', () => {
    assert.equal(instructorApiPath('/instructor/students', null), '/instructor/students');
    assert.equal(instructorApiPath('/instructor/essays?status=graded', 'gv/a'), '/instructor/essays?status=graded&as_instructor=gv%2Fa');
    assert.throws(() => instructorApiPath('/admin/students', 'gv'), /instructor-api-path-required/);
    assert.throws(() => instructorApiPath('/instructor-evil', 'gv'), /instructor-api-path-required/);
    assert.equal(
      instructorGradeHref('essay/a', 'review b', 'gv/c'),
      '/pages/instructor/grade.html?essay_id=essay%2Fa&review_id=review+b&as_instructor=gv%2Fc',
    );
  });

  test('derives truthful assignment tones and matrix coordinates', () => {
    const students = normalizeInstructorStudents([{ id: 's1', full_name: 'An' }, { id: 's2', full_name: 'Binh' }]);
    const prompts = normalizeInstructorPrompts([{ id: 'p1', title: 'Task 1' }]);
    const assignments = normalizeInstructorAssignments([
      { id: 'a1', prompt_id: 'p1', student_id: 's1', status: 'delivered' },
      { id: 'a2', prompt_id: 'p1', student_id: 's2', status: 'assigned', deadline: '2026-01-01T00:00:00Z' },
    ]);
    const matrix = buildInstructorMatrix(students, prompts, assignments);
    assert.equal(matrix.columns[0].title, 'Task 1');
    assert.equal(matrix.rows[1].cells[0].id, 'a2');
    assert.deepEqual(assignmentTone(matrix.rows[0].cells[0]), { label: 'Đã trả', tone: 'success' });
    assert.deepEqual(assignmentTone(matrix.rows[1].cells[0], Date.parse('2026-02-01T00:00:00Z')), { label: 'Trễ', tone: 'danger' });
    assert.deepEqual(assignmentTone(null), { label: '—', tone: 'muted' });
  });
});

describe('/instructor native route contracts', () => {
  test('is a native App Router page with its own non-admin chrome', () => {
    assert.match(PAGE, /InstructorDashboard/);
    assert.match(LAYOUT, /chrome="none"/);
    assert.match(LAYOUT, /instructor-next\.css/);
    assert.doesNotMatch(LAYOUT, /instructor-app\.js/);
  });

  test('uses canonical role truth and all seven owner-scoped reads', () => {
    assert.match(VIEW, /window\.api\.get<unknown>\('\/auth\/me'\)/);
    for (const path of ['cohorts', 'students', 'prompts', 'codes', 'assignments', 'reviews/queue']) {
      assert.match(VIEW, new RegExp(`'/instructor/${path.replace('/', '\\/')}'`));
    }
    assert.match(VIEW, /\['instructor', 'admin'\]\.includes/);
  });

  test('does not call admin APIs and reconciles every dashboard mutation by canonical reload', () => {
    assert.doesNotMatch(VIEW, /window\.api\.(?:get|post|patch|delete)[^(]*\([^)]*['"`]\/admin\//);
    assert.match(VIEW, /await action\(\);[\s\S]{0,180}await loadAll\(asInstructor, undefined, ownerId\)/);
    assert.match(VIEW, /if \(!refreshed\)[\s\S]{0,220}chưa xác nhận được dữ liệu canonical/);
    assert.match(VIEW, /const reconciled = refreshed\?\.queue\.find[\s\S]{0,260}Chưa xác nhận được quyền chấm/);
    assert.match(VIEW, /Dữ liệu canonical đã được tải lại/);
    assert.match(VIEW, /Chưa xác nhận được trạng thái canonical/);
    assert.match(VIEW, /không tự gửi lại mutation/);
    assert.match(VIEW, /ownerId !== accountRef\.current/);
    assert.match(VIEW, /setDrawerSummary\(null\)/);
  });
});

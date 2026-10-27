import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

import {
  ASSIGNMENT_COPY,
  assignmentTone,
  buildInstructorMatrix,
  duplicateGiveConfirmMessage,
  fanOutResultBanner,
  findExistingGive,
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
    assert.deepEqual(normalizeInstructorAssignments([{ id: 'a1', prompt_id: 'p1', student_id: 's1', status: 'assigned' }]), [{ id: 'a1', promptId: 'p1', studentId: 's1', status: 'assigned', essayId: null, deadline: null, cohortId: null, groupId: null, name: null, createdAt: null }]);
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
      '/instructor/grade?essay_id=essay%2Fa&review_id=review+b&as_instructor=gv%2Fc',
    );
  });

  test('keeps the give identity (cohort, group, name, created_at) on assignments', () => {
    const [row] = normalizeInstructorAssignments([{
      id: 'a1', prompt_id: 'p1', student_id: 's1', status: 'pending', cohort_id: 'c1',
      assignment_group_id: 'g1', name: ' Buổi 5 ', created_at: '2026-10-25T12:00:00Z',
    }]);
    assert.equal(row.cohortId, 'c1');
    assert.equal(row.groupId, 'g1');
    assert.equal(row.name, 'Buổi 5');
    assert.equal(row.createdAt, '2026-10-25T12:00:00Z');
  });

  test('findExistingGive returns the latest give of the prompt to the same cohort or student', () => {
    const assignments = normalizeInstructorAssignments([
      { id: 'a1', prompt_id: 'p1', student_id: 's1', status: 'pending', cohort_id: 'c1', created_at: '2026-10-20T00:00:00Z' },
      { id: 'a2', prompt_id: 'p1', student_id: 's2', status: 'pending', cohort_id: 'c1', created_at: '2026-10-25T00:00:00Z' },
      { id: 'a3', prompt_id: 'p2', student_id: 's1', status: 'pending', cohort_id: 'c1', created_at: '2026-10-26T00:00:00Z' },
      { id: 'a4', prompt_id: 'p1', student_id: 's3', status: 'pending', cohort_id: null, created_at: '2026-10-27T00:00:00Z' },
    ]);
    assert.equal(findExistingGive(assignments, { promptId: 'p1', cohortId: 'c1' }).id, 'a2');
    assert.equal(findExistingGive(assignments, { promptId: 'p1', cohortId: 'c2' }), null);
    assert.equal(findExistingGive(assignments, { promptId: 'p3', cohortId: 'c1' }), null);
    // single-student target matches any earlier give to that student, cohort or not
    assert.equal(findExistingGive(assignments, { promptId: 'p1', studentId: 's1' }).id, 'a1');
    assert.equal(findExistingGive(assignments, { promptId: 'p1', studentId: 's3' }).id, 'a4');
    assert.equal(findExistingGive(assignments, { promptId: 'p2', studentId: 's2' }), null);
    assert.equal(findExistingGive(assignments, { promptId: 'p1' }), null);
    assert.equal(findExistingGive(null, { promptId: 'p1', cohortId: 'c1' }), null);
  });

  test('duplicate-give confirmation and fan-out banner copy', () => {
    const existing = { createdAt: '2026-10-25T12:30:00Z' };
    const cohortMessage = duplicateGiveConfirmMessage(existing, 'QA TEST Task 2', 'cohort');
    assert.match(cohortMessage, /^Lớp này đã được giao đề 'QA TEST Task 2' lúc .*19:30.*\. Giao thêm một lượt nữa\?$/);
    assert.match(duplicateGiveConfirmMessage(existing, 'QA TEST Task 2', 'student'), /^Học viên này đã được giao đề 'QA TEST Task 2' lúc .*19:30.*\. Giao thêm một lượt nữa\?$/);
    // Missing created_at drops "lúc" entirely (never "lúc trước đó"); missing title gets a neutral placeholder.
    assert.equal(duplicateGiveConfirmMessage({ createdAt: null }, '', 'cohort'), "Lớp này đã được giao đề '(chưa có tiêu đề)' trước đó. Giao thêm một lượt nữa?");
    assert.equal(duplicateGiveConfirmMessage({ createdAt: 'not-a-date' }, 'QA TEST Task 2', 'student'), "Học viên này đã được giao đề 'QA TEST Task 2' trước đó. Giao thêm một lượt nữa?");
    assert.deepEqual(fanOutResultBanner({ duplicates_warning: ['s1', 's2'] }), { tone: 'warning', message: ASSIGNMENT_COPY.duplicatesWarning(2) });
    assert.match(ASSIGNMENT_COPY.duplicatesWarning(2), /2 học viên đã được giao đề này từ trước/);
    assert.deepEqual(fanOutResultBanner({ duplicates_warning: [] }), { tone: 'success', message: 'Đã giao bài cho lớp.' });
    assert.deepEqual(fanOutResultBanner({}), { tone: 'success', message: 'Đã giao bài cho lớp.' });
    assert.deepEqual(fanOutResultBanner(null), { tone: 'success', message: 'Đã giao bài cho lớp.' });
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

  test('A-07: a re-assigned cell shows the newest give by created_at, not the oldest', () => {
    const students = normalizeInstructorStudents([{ id: 's1', full_name: 'An' }, { id: 's2', full_name: 'Binh' }]);
    const prompts = normalizeInstructorPrompts([{ id: 'p1', title: 'Task 2' }, { id: 'p2', title: 'Task 1' }]);
    const newer = { id: 'a-new', prompt_id: 'p1', student_id: 's1', status: 'pending', created_at: '2026-10-27T00:00:00Z', name: 'Buổi 5' };
    const older = { id: 'a-old', prompt_id: 'p1', student_id: 's1', status: 'submitted', essay_id: 'e1', created_at: '2026-10-20T00:00:00Z', name: 'Buổi 5' };
    const single = { id: 'b1', prompt_id: 'p2', student_id: 's2', status: 'delivered', created_at: '2026-10-21T00:00:00Z' };
    const cellOf = (rows) => buildInstructorMatrix(students, prompts, normalizeInstructorAssignments(rows)).rows[0].cells[0];

    // API order (created_at desc), same name on both gives: newest wins.
    const desc = buildInstructorMatrix(students, prompts, normalizeInstructorAssignments([newer, single, older]));
    assert.equal(desc.rows[0].cells[0].id, 'a-new');
    assert.deepEqual(assignmentTone(desc.rows[0].cells[0]), { label: 'Chưa nộp', tone: 'neutral' });
    // One column per prompt in first-appearance order, untouched single-give cells.
    assert.deepEqual(desc.columns.map((column) => column.id), ['p1', 'p2']);
    assert.equal(desc.rows.length, 2);
    assert.equal(desc.rows[1].cells[1].id, 'b1');
    assert.equal(desc.rows[0].cells[1], null);
    assert.ok(Object.isFrozen(desc) && Object.isFrozen(desc.rows[0].cells));

    // Reversed (asc) input order: still the newest, independent of array order.
    const asc = buildInstructorMatrix(students, prompts, normalizeInstructorAssignments([older, single, newer]));
    assert.equal(asc.rows[0].cells[0].id, 'a-new');
    assert.equal(asc.columns.length, 2);

    // Both names null: still chosen by created_at.
    assert.equal(cellOf([{ ...older, name: null }, { ...newer, name: null }]).id, 'a-new');

    // Equal created_at: the first-seen row is kept.
    assert.equal(cellOf([{ ...older, created_at: newer.created_at }, newer]).id, 'a-old');
    assert.equal(cellOf([newer, { ...older, created_at: newer.created_at }]).id, 'a-new');

    // Missing or invalid created_at on every give: the first-seen row is kept.
    assert.equal(cellOf([{ ...older, created_at: null }, { ...newer, created_at: undefined }]).id, 'a-old');
    assert.equal(cellOf([{ ...newer, created_at: 'not-a-date' }, { ...older, created_at: null }]).id, 'a-new');
    // A dated give beats an undated one regardless of order.
    assert.equal(cellOf([{ ...older, created_at: null }, newer]).id, 'a-new');
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
    assert.match(VIEW, /normalizeInstructorProfile\(await getAuthorizationIdentity\(\)\)/);
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

test('assignment requests interpret datetime-local as Vietnam time for both targets', () => {
  assert.match(VIEW, /const deadline = deadlineValue \? `\$\{deadlineValue\}:00\+07:00` : null/);
  assert.equal((VIEW.match(/if \(deadline\) body\.deadline = deadline;/g) || []).length, 2);
  assert.match(VIEW, /Hạn nộp \(giờ Việt Nam\)/);
});

test('assignment form names the give, confirms re-gives, resets and surfaces duplicates_warning (W-06)', () => {
  assert.match(VIEW, /<input name="name" maxLength=\{200\}/);
  assert.equal((VIEW.match(/if \(name\) body\.name = name;/g) || []).length, 2);
  assert.equal((VIEW.match(/if \(!confirmRegive\(findExistingGive\(data\.assignments, \{ promptId, (?:cohortId|studentId) \}\)\)\) return;/g) || []).length, 2);
  assert.match(VIEW, /window\.confirm\(duplicateGiveConfirmMessage\(/);
  // the confirm runs before mutate, so cancelling sends no request
  assert.ok(VIEW.indexOf('confirmRegive(findExistingGive(data.assignments, { promptId, cohortId })') < VIEW.indexOf("'/instructor/assignments/fan-out'"));
  assert.match(VIEW, /const resetOnSuccess = [^\n]*form\.reset\(\)/);
  assert.equal((VIEW.match(/\.then\(resetOnSuccess\)/g) || []).length, 2);
  assert.match(VIEW, /'\/instructor\/assignments\/fan-out'\), body\), fanOutResultBanner\)/);
  assert.match(VIEW, /typeof success === 'function' \? success\(result\)/);
});

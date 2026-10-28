import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

import {
  ASSIGNMENT_COPY,
  AUTH_SETTLE_TIMEOUT_MS,
  assignmentTone,
  buildInstructorMatrix,
  cohortOverlapConfirmMessage,
  duplicateGiveConfirmMessage,
  fanOutResultBanner,
  findExistingGive,
  instructorApiPath,
  instructorGradeHref,
  matrixDeadlineLabel,
  normalizeDuplicatesPreview,
  normalizeInstructorAssignments,
  normalizeInstructorCodes,
  normalizeInstructorCohorts,
  normalizeInstructorProfile,
  normalizeInstructorPrompts,
  normalizeInstructorQueue,
  normalizeInstructorStudents,
  normalizeInstructorSummary,
  queueRowIdentity,
} from '../lib/instructor-dashboard-model.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = readFileSync(join(ROOT, 'app', '(authed-instructor)', 'instructor', 'page.tsx'), 'utf8');
const VIEW = readFileSync(join(ROOT, 'app', '(authed-instructor)', 'instructor', 'instructor-dashboard.tsx'), 'utf8');
const LAYOUT = readFileSync(join(ROOT, 'app', '(authed-instructor)', 'layout.tsx'), 'utf8');
const CSS = readFileSync(join(ROOT, 'public', 'css', 'instructor-next.css'), 'utf8');

describe('/instructor native dashboard model', () => {
  test('normalizes every canonical owner-scoped collection and rejects malformed envelopes', () => {
    assert.deepEqual(normalizeInstructorProfile({ id: 'u1', role: 'instructor' }), { id: 'u1', role: 'instructor', email: null });
    assert.equal(normalizeInstructorProfile({ id: 'u1' }), null);
    assert.deepEqual(normalizeInstructorCohorts([{ id: 'c1', name: 'Class 1', created_at: '2026-01-01' }]), [{ id: 'c1', name: 'Class 1', createdAt: '2026-01-01' }]);
    assert.deepEqual(normalizeInstructorStudents([{ id: 's1', full_name: 'An', student_code: 'HV1', cohort_id: 'c1', user_id: null }]), [{ id: 's1', fullName: 'An', studentCode: 'HV1', cohortId: 'c1', userId: null }]);
    assert.deepEqual(normalizeInstructorPrompts([{ id: 'p1', title: 'Task', task_type: 'task2' }]), [{ id: 'p1', title: 'Task', taskType: 'task2' }]);
    assert.deepEqual(normalizeInstructorCodes([{ id: 'k1', code: 'ABC', is_used: false, cohort_id: null }]), [{ id: 'k1', code: 'ABC', isUsed: false, cohortId: null }]);
    assert.deepEqual(normalizeInstructorAssignments([{ id: 'a1', prompt_id: 'p1', student_id: 's1', status: 'assigned' }]), [{ id: 'a1', promptId: 'p1', studentId: 's1', status: 'assigned', essayId: null, deadline: null, cohortId: null, groupId: null, name: null, createdAt: null, isLate: false }]);
    assert.deepEqual(normalizeInstructorQueue([{ essay_id: 'e1', task_type: 'task2', review: { id: 'r1', status: 'queued' } }]), [{ essayId: 'e1', reviewId: 'r1', status: 'queued', studentEmail: null, taskType: 'task2', submittedAt: null }]);
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
    // 12:30Z is 19:30 in Asia/Ho_Chi_Minh, dd/mm/yyyy HH:mm.
    assert.equal(cohortMessage, "Lớp này đã được giao đề 'QA TEST Task 2' lúc 25/10/2026 19:30. Giao thêm một lượt nữa?");
    assert.equal(duplicateGiveConfirmMessage(existing, 'QA TEST Task 2', 'student'), "Học viên này đã được giao đề 'QA TEST Task 2' lúc 25/10/2026 19:30. Giao thêm một lượt nữa?");
    // Two-digit day/month, four-digit year, 24-hour clock.
    assert.equal(duplicateGiveConfirmMessage({ createdAt: '2026-09-08T00:00:00Z' }, 'Task 2', 'cohort'), "Lớp này đã được giao đề 'Task 2' lúc 08/09/2026 07:00. Giao thêm một lượt nữa?");
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

describe('A-S3 / W-TIER-DISPLAY on /instructor', () => {
  test('a late hand-in reads "Nộp trễ" from the backend rule, on-time stays "Đã nộp"', () => {
    const [late, onTime, returnedLate, missing] = normalizeInstructorAssignments([
      { id: 'a1', prompt_id: 'p1', student_id: 's1', status: 'submitted', essay_id: 'e1', is_late: true },
      { id: 'a2', prompt_id: 'p1', student_id: 's2', status: 'submitted', essay_id: 'e2', is_late: false },
      { id: 'a3', prompt_id: 'p1', student_id: 's3', status: 'delivered', essay_id: 'e3', is_late: true },
      { id: 'a4', prompt_id: 'p1', student_id: 's4', status: 'pending', deadline: '2026-01-01T00:00:00Z' },
    ]);
    assert.deepEqual(assignmentTone(late), { label: 'Nộp trễ', tone: 'warning' });
    assert.deepEqual(assignmentTone(onTime), { label: 'Đã nộp', tone: 'success' });
    assert.deepEqual(assignmentTone(returnedLate), { label: 'Đã trả · nộp trễ', tone: 'success' });
    assert.equal(missing.isLate, false, 'only a strict true from the backend counts as late');
    assert.deepEqual(assignmentTone(missing, Date.parse('2026-02-01T00:00:00Z')), { label: 'Trễ', tone: 'danger' });
  });

  test('the give form says the essay goes to the teacher; the select is only the AI pre-pass', () => {
    assert.match(VIEW, /<span>AI chấm nháp trước khi bạn chấm<\/span><select name="grading_tier"/);
    assert.match(VIEW, /luôn vào mục Chấm bài để bạn chấm và trả/);
    assert.doesNotMatch(VIEW, /Tier chấm AI/);
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

test('tab bar keeps all four tabs reachable on 360-390px phones with a visible focus ring', () => {
  for (const label of ['Học viên', 'Lớp & Mã', 'Giao bài', 'Chấm bài']) assert.ok(VIEW.includes(`'${label}']`), label);
  // Below 560px the four tabs wrap into a 2x2 grid instead of clipping "Chấm bài" off-screen.
  const phone = CSS.match(/@media \(max-width: 560px\) \{([\s\S]*?)\n\}/);
  assert.ok(phone, 'phone tab-bar breakpoint');
  assert.match(phone[1], /\.ins-tabs \{[^}]*display: grid;[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[^}]*overflow-x: visible;/);
  assert.match(phone[1], /\.ins-tabs button \{[^}]*white-space: normal;/);
  // Desktop keeps the single scrollable row.
  assert.match(CSS, /^\.ins-tabs \{[^}]*display: flex;[^}]*overflow-x: auto;/m);
  // Inset ring so the nav's overflow clipping cannot hide keyboard focus.
  assert.match(CSS, /\.ins-tabs button:focus-visible \{[^}]*outline: 2px solid var\(--av-border-focus\);[^}]*outline-offset: -2px;/);
});

test('assignment requests interpret datetime-local as Vietnam time for both targets', () => {
  assert.match(VIEW, /const deadline = deadlineValue \? `\$\{deadlineValue\}:00\+07:00` : null/);
  assert.equal((VIEW.match(/if \(deadline\) body\.deadline = deadline;/g) || []).length, 2);
  assert.match(VIEW, /Hạn nộp \(giờ Việt Nam\)/);
});

test('assignment form names the give, confirms re-gives, resets and surfaces duplicates_warning (W-06)', () => {
  assert.match(VIEW, /<input name="name" maxLength=\{200\}/);
  assert.equal((VIEW.match(/if \(name\) body\.name = name;/g) || []).length, 2);
  // Single-student give: inline. Class give: the same W-06 check, kept so BL-18 can skip its second ask.
  assert.match(VIEW, /const existingGive = findExistingGive\(data\.assignments, \{ promptId, studentId \}\);/);
  assert.match(VIEW, /const sameClassGive = findExistingGive\(data\.assignments, \{ promptId, cohortId \}\);/);
  assert.match(VIEW, /askConfirm\(duplicateGiveConfirmMessage\(/);
  // the confirm is awaited before mutate, so cancelling sends no request
  const studentConfirm = VIEW.indexOf('if (!(await confirmRegive(existingGive))) return false;');
  assert.ok(studentConfirm >= 0 && studentConfirm < VIEW.indexOf("requestPath('/instructor/assignments'), body)"));
  const classConfirm = VIEW.indexOf('if (!(await confirmRegive(sameClassGive))) return false;');
  assert.ok(classConfirm >= 0 && classConfirm < VIEW.indexOf('await confirmCohortOverlap(promptId, cohortId, promptTitle)'));
  assert.ok(classConfirm < VIEW.indexOf("'/instructor/assignments/fan-out'"));
  assert.match(VIEW, /const resetOnSuccess = [^\n]*form\.reset\(\)/);
  assert.equal((VIEW.match(/\.then\(resetOnSuccess\)/g) || []).length, 2);
  assert.match(VIEW, /'\/instructor\/assignments\/fan-out'\), body\), fanOutResultBanner\)/);
  assert.match(VIEW, /typeof success === 'function' \? success\(result\)/);
});

describe('PC-J10 — /instructor give flow (W-12, BL-18, BL-19)', () => {
  test('W-12: each matrix cell shows its own give deadline in Vietnam time', () => {
    // 00:00Z is 07:00 in Asia/Ho_Chi_Minh, whatever the browser timezone.
    assert.equal(matrixDeadlineLabel({ deadline: '2026-09-08T00:00:00Z' }), 'Hạn 08/09/2026 07:00');
    assert.equal(matrixDeadlineLabel({ deadline: null }), null);
    assert.equal(matrixDeadlineLabel({ deadline: 'not-a-date' }), null);
    assert.equal(matrixDeadlineLabel(null), null);
    assert.match(VIEW, /const deadline = matrixDeadlineLabel\(cell\); return <td[^>]*><StatusPill[^]*?\{deadline && <small className="ins-cell-deadline">\{deadline\}<\/small>\}<\/td>/);
    assert.match(CSS, /\.ins-cell-deadline \{[^}]*display: block;/);
  });

  test('W-12: an auth state that never settles fails closed to /login', () => {
    assert.equal(AUTH_SETTLE_TIMEOUT_MS, 15_000);
    assert.match(VIEW, /if \(status !== 'initial-loading'\) return undefined;\s*const timer = window\.setTimeout\(\(\) => window\.location\.replace\('\/login'\), AUTH_SETTLE_TIMEOUT_MS\);\s*return \(\) => window\.clearTimeout\(timer\);\s*\}, \[status\]\);/);
  });

  test('BL-18: the duplicates preview is validated, and only a real overlap asks', () => {
    const preview = normalizeDuplicatesPreview({ student_count: 3, duplicate_student_ids: ['s1', 's2', 's1'] });
    assert.deepEqual(preview, { studentCount: 3, duplicateStudentIds: ['s1', 's2'] });
    assert.equal(normalizeDuplicatesPreview({ student_count: 3 }), null);
    assert.equal(normalizeDuplicatesPreview({ student_count: '3', duplicate_student_ids: [] }), null);
    assert.equal(normalizeDuplicatesPreview({ student_count: 3, duplicate_student_ids: [null] }), null);
    assert.equal(normalizeDuplicatesPreview({}), null);
    assert.equal(cohortOverlapConfirmMessage({ studentCount: 3, duplicateStudentIds: [] }, 'Task 2'), null);
    assert.equal(cohortOverlapConfirmMessage(preview, 'Task 2'),
      "2 học viên trong lớp đã từng được giao đề 'Task 2'. Giao thêm một lượt cho cả lớp? (Các học viên này sẽ có thêm một lượt.)");
    // The preview is read before the fan-out POST and cancelling stops it.
    const ask = VIEW.indexOf('await confirmCohortOverlap(promptId, cohortId, promptTitle)');
    assert.ok(ask >= 0 && ask < VIEW.indexOf("'/instructor/assignments/fan-out'"));
    assert.match(VIEW, /requestPath\('\/instructor\/assignments\/duplicates-preview'\), \{ prompt_ids: \[promptId\], cohort_id: cohortId \}/);
    assert.match(VIEW, /if \(!sameClassGive && !\(await confirmCohortOverlap\(promptId, cohortId, promptTitle\)\)\) return false;/);
  });

  test('Q-12c: give confirmations use the shared in-app Dialog, never window.confirm', () => {
    assert.doesNotMatch(VIEW, /window\.confirm\b/);
    assert.match(VIEW, /import \{ Dialog \} from '@\/components\/admin-directory-ui';/);
    assert.match(VIEW, /return !message \|\| await askConfirm\(message\);/);
    // Only the confirm button resolves true; Hủy, ×, Esc and the backdrop all cancel.
    assert.match(VIEW, /<Dialog open=\{confirmMessage !== null\} title=\{ASSIGNMENT_COPY\.confirmTitle\} description=\{confirmMessage\} onClose=\{\(\) => answerConfirm\(false\)\}/);
    assert.match(VIEW, /onClick=\{\(\) => answerConfirm\(false\)\}>\{ASSIGNMENT_COPY\.confirmCancel\}<\/button>/);
    assert.match(VIEW, /onClick=\{\(\) => answerConfirm\(true\)\}>\{ASSIGNMENT_COPY\.confirmAccept\}<\/button>/);
    // A second ask or an account change settles the open one as cancelled.
    assert.match(VIEW, /const askConfirm = [^\n]*\n\s*confirmResolve\.current\?\.\(false\);/);
    assert.match(VIEW, /useEffect\(\(\) => \{\n\s*\/\/[^\n]*\n\s*confirmResolve\.current\?\.\(false\);\s*confirmResolve\.current = null;\s*setConfirmMessage\(null\);\s*if \(status === 'signed-out'\)/);
    assert.equal(ASSIGNMENT_COPY.confirmTitle, 'Đề đã được giao trước đó');
    assert.equal(ASSIGNMENT_COPY.confirmCancel, 'Hủy');
    assert.equal(ASSIGNMENT_COPY.confirmAccept, 'Giao thêm');
    // /instructor loads no admin stylesheet, so the dialog is styled here.
    assert.match(CSS, /\.acd-dialog-backdrop \{[^}]*position: fixed;/);
    assert.match(CSS, /\.acd-dialog \{[^}]*background: var\(--av-surface-card\);/);
  });

  test('BL-19: a missing prompt shows the app message, not the browser validation bubble', () => {
    assert.match(VIEW, /<form className="ins-form" onSubmit=\{createAssignment\} noValidate>/);
    assert.match(VIEW, /if \(!promptId\) return missing\('prompt_id', 'Chưa chọn đề bài\.'\);/);
  });
});

describe('PC-J36 — "Chấm bài" rows identify their essay', () => {
  test('two essays from the same student get distinct row identities from response data only', () => {
    const queue = normalizeInstructorQueue([
      { essay_id: 'ad8db313-3c59-4ffe-a665-1fe0fbc87804', student_email: 'hv@example.com', task_type: 'task2', submitted_at: '2026-10-28T07:05:00Z', review: { id: 'r1', status: 'queued' } },
      { essay_id: '72c07a2a-0000-4000-8000-000000000000', student_email: 'hv@example.com', task_type: 'task2', submitted_at: '2026-10-28T09:30:00+00:00', review: { id: 'r2', status: 'claimed' } },
    ]);
    assert.equal(queue[0].submittedAt, '2026-10-28T07:05:00Z');
    // 07:05Z is 14:05 in Asia/Ho_Chi_Minh, whatever the browser timezone.
    assert.equal(queueRowIdentity(queue[0]), 'ad8db313 · 28/10/2026 14:05');
    assert.equal(queueRowIdentity(queue[1]), '72c07a2a · 28/10/2026 16:30');
    assert.notEqual(queueRowIdentity(queue[0]), queueRowIdentity(queue[1]));
  });

  test('a missing or unparseable submit time falls back to the short essay id alone', () => {
    assert.equal(queueRowIdentity({ essayId: 'ad8db313-3c59-4ffe-a665-1fe0fbc87804', submittedAt: null }), 'ad8db313');
    assert.equal(queueRowIdentity({ essayId: 'ad8db313-3c59-4ffe-a665-1fe0fbc87804', submittedAt: 'not-a-date' }), 'ad8db313');
    assert.equal(queueRowIdentity(null), '');
  });

  test('the identity renders under the student in the existing column — no new header or label', () => {
    assert.match(VIEW, /<td>\{item\.studentEmail \|\| item\.essayId\}<small className="ins-cell-meta">\{queueRowIdentity\(item\)\}<\/small><\/td>/);
    assert.match(VIEW, /<thead><tr><th>Học viên<\/th><th>Dạng<\/th><th>Trạng thái<\/th><th>Thao tác<\/th><\/tr><\/thead>/);
    assert.match(CSS, /\.ins-cell-meta \{[^}]*display: block;/);
  });
});

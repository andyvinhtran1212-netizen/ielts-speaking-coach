import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const students = read('app', '(authed-admin-students)', 'admin', 'students', 'admin-students-directory.tsx');
const classHomework = read('app', '(authed-admin-classes)', 'admin', 'classes', '[cohortId]', 'admin-class-homework.tsx');
const prompts = read('app', '(authed-admin-writing-prompts)', 'admin', 'writing', 'prompts', 'admin-writing-prompts.tsx');
const assignments = read('app', '(authed-admin-writing-assignments)', 'admin', 'writing', 'assignments', 'admin-writing-assignments.tsx');
const classBackend = read('..', 'backend', 'routers', 'admin_class_assignments.py');
const learnerWriting = read('app', '(authed-writing)', 'writing', 'dashboard', 'page-shell.tsx');

describe('Writing assignment handoff entry points', () => {
  test('student workspace keeps submit-on-behalf and assign-homework as distinct actions', () => {
    assert.match(students, /assignmentHref\(\{\}, \{ studentId: profile\.id \}\)[^\n]+Giao bài Writing/);
    assert.match(students, /\/admin\/writing\/new\?student_id=[^\n]+Gửi bài chấm/);
    assert.match(students, /assignmentHref\(\{\}, \{ studentId: student\.id \}\)[^\n]+aria-label=\{`Giao bài Writing cho \$\{student\.full_name\}`\}[^\n]+Giao bài Writing/);
    assert.match(students, /aria-label=\{`Gửi bài chấm cho \$\{student\.full_name\}`\}/);
    assert.match(students, /aria-label=\{`Sửa hồ sơ \$\{student\.full_name\}`\}/);
  });

  test('class workspace hands the exact cohort to the Writing ledger', () => {
    assert.match(classHomework, /assignmentHref\(\{\}, \{ cohortId \}\)[^\n]+Giao Writing cho lớp/);
    assert.match(classHomework, /Giao bài lớp/);
    assert.match(classBackend, /Writing is absent on purpose:[\s\S]+_TEST_SKILLS = \{"reading": "reading_tests", "listening": "listening_tests"\}/);
  });

  test('an active prompt can hand its canonical id to the assignment picker', () => {
    assert.match(prompts, /assignmentHref\(\{\}, \{ promptId: prompt\.id \}\)[^\n]+Giao đề này/);
    assert.match(assignments, /assignmentPrefill/);
    assert.match(assignments, /students\.some\(\(item\) => item\.id === prefill\.studentId\)/);
    assert.match(assignments, /cohorts\.some\(\(item\) => item\.id === prefill\.cohortId\)/);
    assert.match(assignments, /prompts\.some\(\(item\) => item\.id === prefill\.promptId\)/);
  });

  test('learner Writing remains the canonical inbox for Writing assignments', () => {
    assert.match(learnerWriting, /id="tab-assignments"/);
    assert.match(learnerWriting, /id="content-assignments"/);
    assert.match(learnerWriting, /Khi giảng viên giao đề, em sẽ thấy ở đây\./);
  });
});

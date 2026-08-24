import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canReturnSubmission, groupReportQuestions, normalizeEffort, normalizeStudentReport, normalizeTally, normalizeWriting } from '../lib/admin-class-submissions-model.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const UI = read('app', '(authed-admin-classes)', 'admin', 'classes', '[cohortId]', 'admin-class-submissions.tsx');
const DETAIL = read('app', '(authed-admin-classes)', 'admin', 'classes', '[cohortId]', 'admin-class-detail.tsx');
const HOMEWORK = read('app', '(authed-admin-classes)', 'admin', 'classes', '[cohortId]', 'admin-class-homework.tsx');
const CSS = read('public', 'css', 'admin-class-submissions-next.css');
const LEDGER = read('..', 'docs', 'ROUTE_LEDGER.md');
const WORKFLOW = read('..', '.github', 'workflows', 'parity-gate.yml');
const BROWSER = read('tooling', 'verify-admin-class-submissions-flow.mjs');

describe('admin class submissions model', () => {
  test('keeps canonical tally states and unknown scores distinct', () => {
    const out = normalizeTally({ assignment: { id: 'a1', title: 'Grammar 2', skill: 'course' }, sealed: true, homework_stale: true, sections_shape_unknown: true, students: [
      { student_id: 's1', status: 'missing', score: null, flags: [] },
      { student_id: 's2', status: 'submitted', score: '75', passed_at: null, verdicts: 0, retakes: 0, has_writing: true, flags: [{ severity: 'high', label: 'Cần xem', why: 'Lỗi chấm', action: 'Mở bài' }] },
    ], counts: { total: 2, submitted: 1, missing: 1, flagged: 1 } });
    assert.equal(out.students[0].score, null);
    assert.equal(out.students[1].score, 75);
    assert.equal(out.homework_stale, true);
    assert.equal(out.sections_shape_unknown, true);
    assert.equal(out.counts.submitted, 1);
  });

  test('keeps course learning outcome separate from operational hand-in state', () => {
    const out = normalizeTally({ assignment: { id: 'a1', title: 'Grammar 1', skill: 'course' }, students: [{
      student_id: 's1', status: 'pending', submitted_at: null, score: 70,
      course_state: 'near_pass', next_action: 'retake', pass_pct: 75, near_pass_pct: 65,
      sections_done: 1, sections_total: 2,
      missing_sections: [{ key: 'writing', label: 'Tự luận' }],
      flags: [],
    }], counts: { total: 1, submitted: 0, near_pass: 1, flagged: 0 } });
    assert.equal(out.students[0].status, 'pending');
    assert.equal(out.students[0].course_state, 'near_pass');
    assert.equal(out.students[0].missing_sections[0].label, 'Tự luận');
    assert.equal(out.students[0].flags.length, 0);
    assert.equal(out.counts.near_pass, 1);
  });

  test('normalizes effort without dropping unactivated or untouched students', () => {
    const out = normalizeEffort({ students: [{ student_id: 's1', user_id: null, state: 'untouched', stages_done: 0 }, { student_id: 's2', user_id: 'u2', state: 'stalled', stages_done: 2, questions: 4, correct: 2, accuracy: .5 }, { student_id: null, user_id: 'u-gone', state: 'done', stages_done: 8 }], axes: [{ axis: 'Nouns', wrong: 3 }] });
    assert.deepEqual(out.students.map((row) => row.state), ['untouched', 'stalled', 'done']);
    assert.equal(out.students[0].user_id, null);
    assert.equal(out.students[2].student_id, null);
    assert.equal(out.axes[0].wrong, 3);
  });

  test('preserves class misconception denominators and affected learners', () => {
    const out = normalizeEffort({ students: [], axes: [{
      axis: 'Linking verbs', wrong: 12, attempted: 20, wrong_rate: .6,
      affected_students: 8, student_sample: 13, affected_rate: .615,
      median_sec: 41, scope: 'first_attempt', sample_low: false,
    }] });
    assert.equal(out.axes[0].attempted, 20);
    assert.equal(out.axes[0].affected_students, 8);
    assert.equal(out.axes[0].student_sample, 13);
    assert.equal(out.axes[0].sample_low, false);
    const low = normalizeEffort({ students: [], axes: [{ axis: 'Articles', affected_students: 1, student_sample: 2 }] });
    assert.equal(low.axes[0].sample_low, true, 'frontend cũ/mới vẫn nhận ra mẫu nhỏ khi field chưa rollout');
  });

  test('keeps aggregate attempt count, duration and per-section scores', () => {
    const out = normalizeEffort({ students: [{
      student_id: 's1', user_id: 'u1', state: 'needs_retry', stages_done: 9,
      attempts: 2, combined_pct: 74.5, sections_done: 5, sections_total: 5,
      attempt_minutes: 42.3,
      section_results: [{ key: 'listening', label: 'Nghe hiểu', pct: 80, duration_sec: 360 }],
    }], axes: [] });
    assert.equal(out.students[0].attempts, 2);
    assert.equal(out.students[0].combined_pct, 74.5);
    assert.equal(out.students[0].attempt_minutes, 42.3);
    assert.deepEqual(out.students[0].section_results[0], {
      key: 'listening', label: 'Nghe hiểu', pct: 80, duration_sec: 360, carried: false,
    });
  });

  test('groups report questions by canonical axis and preserves mastery history', () => {
    const report = normalizeStudentReport({ questions: [{ qid: 'q1', item_key: 'Articles', is_correct: false }, { qid: 'q2', item_key: 'Articles', is_correct: true }], history: [{ number: 1, phase: 'full', pct: 70, next_action: 'retake' }], totals: { answered: 2, correct: 1, scope: 'baseline_quiz' }, summary: { pass_pct: 75, near_pass_pct: 65, latest_pct: 70, latest_action: 'retake', baseline_quiz_pct: 50, baseline_correct: 1, baseline_answered: 2 } });
    assert.equal(groupReportQuestions(report.questions)[0].wrong, 1);
    assert.equal(report.history[0].next_action, 'retake');
    assert.equal(report.summary.latest_pct, 70);
    assert.equal(report.summary.baseline_quiz_pct, 50);
  });

  test('preserves incomplete attempts and their section timing in student history', () => {
    const report = normalizeStudentReport({ questions: [], totals: {}, history: [{
      number: 1, phase: 'run', completed: false, pct: null, duration_sec: 900,
      sections: [{ key: 'quiz', label: 'Trắc nghiệm', pct: 85, duration_sec: 900 }],
    }] });
    assert.equal(report.history[0].completed, false);
    assert.equal(report.history[0].pct, null);
    assert.equal(report.history[0].duration_sec, 900);
    assert.equal(report.history[0].sections[0].pct, 85);
    assert.equal(report.history[0].sections[0].carried, false);
  });

  test('distinguishes no writing submission from an empty graded submission', () => {
    assert.equal(normalizeWriting({ student: { id: 's1' }, assignment: { id: 'a1' }, submission: null }).submission, null);
    assert.equal(normalizeWriting({ student: { id: 's1' }, assignment: { id: 'a1' }, submission: { items: [], clean: 0, total: 0 } }).submission.total, 0);
  });

  test('returns work only while a published assignment is still accepting submissions', () => {
    assert.equal(canReturnSubmission('archived', false), false);
    assert.equal(canReturnSubmission('published', false), true);
    assert.equal(canReturnSubmission('published', true), false);
  });
});

describe('admin class submissions integration contracts', () => {
  test('owns the native tally, effort, per-student report and writing reads', () => {
    assert.match(UI, /\/tally`/);
    assert.match(UI, /\/attempt-report\?assignment_id=/);
    assert.match(UI, /\/students\/\$\{encodeURIComponent\(userId\)\}\/report\?assignment_id=/);
    assert.match(UI, /\/writing\/\$\{encodeURIComponent\(studentId\)\}/);
    assert.match(UI, /\/return\/\$\{encodeURIComponent\(row\.student_id\)\}/);
    assert.doesNotMatch(HOMEWORK, /Nhận bài · legacy|markingHref/);
  });

  test('shows canonical attempt history with per-section score and duration', () => {
    assert.match(UI, /Từng lượt và từng phần/);
    assert.match(UI, /row\.sections\.map/);
    assert.match(UI, /row\.duration_sec/);
    assert.match(UI, /Điểm tổng chỉ có sau khi mọi phần bắt buộc hoàn thành/);
  });

  test('renders an outcome funnel, action queue and labelled score scopes', () => {
    assert.match(UI, /Tổng kết/);
    assert.match(UI, /Cần admin xem/);
    assert.match(UI, /Gần đạt · Revision/);
    assert.match(UI, /Điểm tổng gần nhất/);
    assert.match(UI, /Trắc nghiệm lượt đầu/);
    assert.match(UI, /Câu sai/);
    assert.match(UI, /affected_students/);
    assert.match(UI, /Mẫu nhỏ · chỉ tham khảo/);
    assert.match(UI, /Chưa xác định được các phần bắt buộc/);
  });

  test('deep-links an assignment natively and reloads canonical truth after return', () => {
    assert.match(DETAIL, /params\.get\('assignment_id'\)/);
    assert.match(DETAIL, /setTab\(assignmentId \? 'homework'/);
    assert.match(DETAIL, /url\.searchParams\.set\('assignment_id', assignment\.id\)/);
    assert.match(UI, /const canonical = await loadTally\(true\); await onMutation\(\)/);
    assert.match(UI, /audit_logged === false/);
  });

  test('rejects stale async report writes and retries the failed view', () => {
    assert.match(UI, /const requestId = \+\+sequence\.current;/);
    assert.match(UI, /requestId !== sequence\.current/);
    assert.match(UI, /if \(view === 'effort'\) return void loadEffort\(\)/);
    assert.match(UI, /if \(selected\) void openStudent\(/);
    assert.match(UI, /setEffort\(null\)/);
    assert.match(UI, /loadEffort\(true\)/);
  });

  test('keeps grader failures explicit and preserves the writing review semantics', () => {
    assert.match(UI, /ok == null \? <p className="acs-writing-unknown"/);
    assert.match(UI, /Chưa chấm được câu này/);
    assert.match(UI, /ISSUE_KIND/);
    assert.match(UI, /Đúng ngữ pháp, còn lỗi trình bày/);
    assert.match(UI, /function InlineMd/);
  });

  test('implements an accessible inner tab contract', () => {
    assert.match(UI, /aria-controls=\{view === 'tally' && !loading && !error \? 'acs-panel-tally' : undefined\}/);
    assert.match(UI, /role="tabpanel" aria-labelledby="acs-tab-tally"/);
    assert.match(UI, /tabIndex=\{view === 'tally' \? 0 : -1\}/);
    assert.match(UI, /event\.key === 'ArrowRight'/);
    assert.match(UI, /event\.key === 'Home'/);
  });

  test('does not fabricate an empty report from a failed backend read', () => {
    assert.match(UI, /report\.stale && !groups\.length/);
    assert.match(UI, /chưa thể kết luận học viên đúng, sai hay chưa có bài/);
    assert.match(UI, /<InlineMd text=\{question\.prompt/);
  });

  test('keeps independent reads visible and blocks impossible return-work actions', () => {
    assert.match(UI, /const failures: string\[\] = \[\]/);
    assert.match(UI, /failures\.push\(`Không đọc được phần tự luận/);
    assert.match(UI, /failures\.push\(`Không đọc được bài từng câu/);
    assert.match(UI, /row\.has_writing && canReturnWork/);
    assert.match(UI, /assignment\.status !== 'published' \? 'Mở lại bài trước khi trả bài'/);
    assert.match(UI, /if \(!canReturnWork\)/);
    assert.match(UI, /tally\.counts\.flagged/);
    assert.match(UI, /view === 'student' \? retryCurrent\(\)/);
  });

  test('ships responsive styling and updates route ownership truth', () => {
    assert.match(CSS, /@media \(max-width: 600px\)/);
    assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(LEDGER, /native detail \+ homework \+ assignment-centric marking \+ student-centric cross-assignment work-history ownership/);
    assert.match(LEDGER, /per-student history across every assigned item/);
    assert.match(WORKFLOW, /node tooling\/verify-admin-class-submissions-flow\.mjs/);
    assert.match(BROWSER, /unexpectedWrites/);
    assert.doesNotMatch(UI, /dangerouslySetInnerHTML|\.innerHTML|window\.confirm|alert\(/);
  });
});

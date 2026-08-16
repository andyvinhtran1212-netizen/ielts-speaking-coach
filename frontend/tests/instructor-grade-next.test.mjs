import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

import {
  instructorDeliveryPayload,
  instructorGradeCompareHref,
  instructorNotePayload,
  normalizeInstructorDeliverAck,
  normalizeInstructorGradeEssay,
  normalizeInstructorNoteAck,
  readInstructorGradeQuery,
  resolveInstructorGradeReview,
} from '../lib/instructor-grade-model.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = readFileSync(join(ROOT, 'app', '(authed-instructor-grade)', 'instructor', 'grade', 'page.tsx'), 'utf8');
const VIEW = readFileSync(join(ROOT, 'app', '(authed-instructor-grade)', 'instructor', 'grade', 'instructor-grade.tsx'), 'utf8');
const LAYOUT = readFileSync(join(ROOT, 'app', '(authed-instructor-grade)', 'layout.tsx'), 'utf8');
const DASHBOARD_MODEL = readFileSync(join(ROOT, 'lib', 'instructor-dashboard-model.mjs'), 'utf8');
const COMPARE_MODEL = readFileSync(join(ROOT, 'lib', 'instructor-compare-model.mjs'), 'utf8');
const WORKFLOW = readFileSync(join(ROOT, '..', '.github', 'workflows', 'parity-gate.yml'), 'utf8');

function essay() {
  return {
    id: 'essay-1',
    status: 'graded',
    task_type: 'task2',
    essay_text: '<script>not markup</script>',
    instructor_note: 'Keep this',
    delivered_at: null,
    is_flagged: false,
    student: { id: 'student-1', full_name: 'An', student_code: 'HV01', target_band: 7 },
    feedback: {
      version: 1,
      overall_band_score: 6.5,
      feedback_json: { mistakeAnalysis: [], criteriaFeedback: {} },
    },
  };
}

function queue() {
  return [{
    essay_id: 'essay-1',
    review: { id: 'review-1', status: 'claimed' },
    student_email: 'an@example.com',
    task_type: 'task2',
  }];
}

describe('/instructor/grade canonical model', () => {
  test('accepts exactly one essay identity and rejects duplicate query identities', () => {
    assert.deepEqual(readInstructorGradeQuery(new URLSearchParams('essay_id=e1&review_id=r1&as_instructor=i1')), {
      essayId: 'e1', requestedReviewId: 'r1', requestedInstructor: 'i1',
    });
    assert.throws(() => readInstructorGradeQuery(new URLSearchParams('essay_id=e1&essay_id=e2')), /nhiều essay_id/);
    assert.throws(() => readInstructorGradeQuery(new URLSearchParams('essay_id=e1&review_id=r1&review_id=r2')), /nhiều review_id/);
    assert.throws(() => readInstructorGradeQuery(new URLSearchParams('essay_id=e1&as_instructor=i1&as_instructor=i2')), /nhiều as_instructor/);
  });

  test('normalizes a canonical essay and rejects identity, status, band, or feedback drift', () => {
    const normalized = normalizeInstructorGradeEssay(essay(), 'essay-1');
    assert.equal(normalized.essayText, '<script>not markup</script>');
    assert.equal(normalized.feedback.overallBandScore, 6.5);
    assert.equal(normalized.student.targetBand, 7);
    assert.equal(normalizeInstructorGradeEssay(essay(), 'essay-2'), null);
    assert.equal(normalizeInstructorGradeEssay({ ...essay(), status: 'mystery' }, 'essay-1'), null);
    assert.equal(normalizeInstructorGradeEssay({ ...essay(), feedback: { ...essay().feedback, overall_band_score: 10 } }, 'essay-1'), null);
    assert.equal(normalizeInstructorGradeEssay({ ...essay(), feedback: { ...essay().feedback, feedback_json: null } }, 'essay-1'), null);
  });

  test('binds review and essay identity, while allowing inference after compare navigation', () => {
    assert.equal(resolveInstructorGradeReview(queue(), 'essay-1', 'review-1').review.reviewId, 'review-1');
    assert.equal(resolveInstructorGradeReview(queue(), 'essay-1', null).review.reviewId, 'review-1');
    assert.equal(resolveInstructorGradeReview(queue(), 'essay-1', 'review-other').mismatch, true);
    assert.equal(resolveInstructorGradeReview({}, 'essay-1', null), null);
  });

  test('builds exact note/delivery bodies and validates mutation acknowledgements', () => {
    assert.deepEqual(instructorNotePayload('Good'), { instructor_note: 'Good' });
    assert.deepEqual(instructorDeliveryPayload('essay-1', 'Good'), { essay_id: 'essay-1', instructor_note: 'Good' });
    assert.throws(() => instructorNotePayload('x'.repeat(5001)), /instructor-note-invalid/);
    assert.equal(normalizeInstructorNoteAck({ essay_id: 'essay-1', instructor_note: 'Good', status: 'reviewed' }, 'essay-1', 'Good'), true);
    assert.equal(normalizeInstructorDeliverAck({ id: 'review-1', essay_id: 'essay-1', status: 'delivered' }, 'essay-1', 'review-1'), true);
    assert.equal(normalizeInstructorDeliverAck({ id: 'review-2', essay_id: 'essay-1', status: 'delivered' }, 'essay-1', 'review-1'), false);
    assert.equal(instructorGradeCompareHref('essay/a', 'teacher/b'), '/instructor/compare?essay_id=essay%2Fa&as_instructor=teacher%2Fb');
  });
});

describe('/instructor/grade native route contracts', () => {
  test('owns App Router UI, shared renderers, canonical links and no browser confirm', () => {
    assert.match(PAGE, /InstructorGrade/);
    assert.match(LAYOUT, /chrome="none"/);
    assert.match(LAYOUT, /writing-renderers\.css/);
    assert.match(LAYOUT, /writing-highlight\.css/);
    assert.match(LAYOUT, /instructor-grade-next\.css/);
    assert.match(VIEW, /window\.WritingRenderers/);
    assert.match(VIEW, /window\.WritingHighlight/);
    assert.doesNotMatch(VIEW, /\bconfirm\s*\(/);
    assert.match(DASHBOARD_MODEL, /return `\/instructor\/grade\?\$\{params\.toString\(\)\}`/);
    assert.match(COMPARE_MODEL, /return `\/instructor\/grade\?\$\{params\.toString\(\)\}`/);
  });

  test('role-gates before owner reads and only honors impersonation for admins', () => {
    const roleGuard = VIEW.indexOf("['instructor', 'admin'].includes(profile.role)");
    const ownerRead = VIEW.indexOf('const next = await readCanonical(query.essayId');
    assert.ok(roleGuard >= 0 && ownerRead > roleGuard);
    assert.match(VIEW, /normalizeInstructorProfile\(await window\.api\.get<unknown>\('\/auth\/me'\)\)/);
    assert.match(VIEW, /profile\.role === 'admin' \? query\.requestedInstructor : null/);
    assert.match(VIEW, /instructorApiPath\(`\/instructor\/essays\/\$\{encodeURIComponent\(id\)\}`/);
  });

  test('saves before delivery, binds both ids, reads canonical state and never auto-replays POST', () => {
    const noteWrite = VIEW.indexOf('instructorNotePayload(submitted)');
    const deliverWrite = VIEW.indexOf('instructorDeliveryPayload(essayId, submitted)');
    assert.ok(noteWrite >= 0 && deliverWrite > noteWrite);
    assert.match(VIEW, /normalizeInstructorDeliverAck\(ack, essayId, reviewId\)/);
    assert.match(VIEW, /next\.essay\.status === 'delivered'/);
    assert.match(VIEW, /hệ thống không tự gửi lại mutation/);
    assert.match(VIEW, /needsReconcile/);
    assert.doesNotMatch(VIEW, /while\s*\([^)]*\)[\s\S]{0,300}window\.api\.post/);
  });

  test('keeps degraded version/queue truth visible and pins backend changes to G1', () => {
    assert.match(VIEW, /Không xác định được ngân sách phiên bản/);
    assert.match(VIEW, /Chưa xác nhận được review từ hàng chờ/);
    for (const path of [
      "frontend/app/(authed-instructor-grade)/**",
      'frontend/lib/instructor-grade-model.mjs',
      'frontend/public/css/instructor-grade-next.css',
      'backend/routers/instructor.py',
      'backend/services/instructor_workflow.py',
    ]) assert.match(WORKFLOW, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('/\\*\\*', '/.*')));
  });
});

// MOCKORG-0086 T032: Kỳ thi list and setup model (FR-140…FR-144).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  audienceSummary,
  buildCreateBody,
  buildPatchBody,
  examHref,
  filterCounts,
  filterOrgExams,
  formFromExam,
  isoToVnLocal,
  modeLine,
  newExamCode,
  nextStepCopy,
  normalizeAudience,
  normalizeOrgExam,
  normalizeOrgExamList,
  notReadyMissing,
  scheduleMissing,
  setupStep,
  toggleSkill,
  vnLocalToIso,
  whenCopy,
} from '../lib/mock-exam-org-model.mjs';

const row = (over = {}) => ({
  id: 'e1', code: 'X', title: 'Thi thử cuối khoá', status: 'draft', exam_mode: 'sequential', exam_mode_v2: 'live',
  is_open: false, active_section: 'not_started', created_at: '2026-11-20T01:00:00Z', review_eligible: false,
  display_state: 'draft', audience_count: 3, ...over,
});

describe('list rows', () => {
  test('reads the new fields and the v2 mode name', () => {
    const exam = normalizeOrgExam(row({ skills: ['reading', 'listening'], exam_mode: 'retake', exam_mode_v2: 'self_paced' }));
    assert.equal(exam.mode, 'self_paced');
    assert.deepEqual(exam.skills, ['listening', 'reading']);
    assert.equal(exam.audienceCount, 3);
    assert.equal(exam.state, 'draft');
  });

  test('an exam before 445 sits all four skills; unknown state and count stay null', () => {
    const exam = normalizeOrgExam(row({ skills: null, display_state: null, audience_count: null }));
    assert.deepEqual(exam.skills, ['listening', 'reading', 'writing', 'speaking']);
    assert.equal(exam.state, null);
    assert.equal(exam.audienceCount, null);
    assert.equal(nextStepCopy(exam), 'Tải lại để xem trạng thái');
  });

  test('malformed rows are counted, not drawn', () => {
    const list = normalizeOrgExamList({ exams: [row(), { id: '', status: 'draft' }, row({ id: 'e2', status: 'weird' })] });
    assert.equal(list.rows.length, 1);
    assert.equal(list.malformed, 2);
    assert.equal(normalizeOrgExamList({}), null);
  });

  test('"Đang diễn ra" holds running live rooms and open self-paced exams', () => {
    const rows = normalizeOrgExamList({ exams: [
      row({ id: 'a', display_state: 'running', status: 'published' }),
      row({ id: 'b', display_state: 'open', status: 'published', exam_mode_v2: 'self_paced' }),
      row({ id: 'c', display_state: 'scheduled', status: 'published' }),
      row({ id: 'd', display_state: null, status: 'published' }),
    ] }).rows;
    assert.deepEqual(filterOrgExams(rows, 'running').map((r) => r.id), ['a', 'b']);
    assert.equal(filterCounts(rows).all, 4);
    assert.equal(filterCounts(rows).scheduled, 1);
  });

  test('when, next step and link', () => {
    const live = normalizeOrgExam(row({ status: 'published', display_state: 'scheduled', starts_at: '2026-11-25T13:00:00Z' }));
    assert.equal(whenCopy(live), '20:00 25/11/2026');
    assert.equal(nextStepCopy(live), 'Chờ giờ mở phòng');
    assert.equal(examHref(live), '/admin/mock-tests?view=console&tab=live&exam_id=e1');
    const self = normalizeOrgExam(row({ exam_mode_v2: 'self_paced', open_from: '2026-11-25T01:00:00Z', open_until: '2026-11-27T16:59:00Z' }));
    assert.equal(whenCopy(self), '08:00 25/11/2026 – 23:59 27/11/2026');
    assert.equal(examHref(self), '/admin/mock-tests/e1/setup');
    assert.equal(whenCopy(normalizeOrgExam(row())), 'Chưa có ngày giờ');
    const grading = normalizeOrgExam(row({ status: 'published', display_state: 'grading' }));
    assert.equal(examHref(grading), '/admin/mock-tests?view=console&tab=review&exam_id=e1');
  });
});

describe('setup form', () => {
  test('step ids and skill toggles keep order', () => {
    assert.equal(setupStep('mode'), 'mode');
    assert.equal(setupStep('x'), 'papers');
    assert.deepEqual(toggleSkill(['writing'], 'listening'), ['listening', 'writing']);
    assert.deepEqual(toggleSkill(['listening', 'writing'], 'listening'), ['writing']);
  });

  test('Vietnam local time round-trips', () => {
    assert.equal(vnLocalToIso('2026-11-25T20:00'), '2026-11-25T20:00:00+07:00');
    assert.equal(isoToVnLocal('2026-11-25T13:00:00Z'), '2026-11-25T20:00');
    assert.equal(vnLocalToIso(''), null);
    assert.equal(isoToVnLocal(null), '');
  });

  test('create carries papers only for sat skills, a hidden code and the draft step', () => {
    const form = { ...formFromExam(null), title: ' Thi thử ', skills: ['listening', 'reading'], listeningTestId: 'L1', readingTestId: 'R1', writingTask1PromptId: 'W1' };
    const built = buildCreateBody(form, 'KT20261123-ABCD', 'audience');
    assert.equal(built.ok, true);
    assert.deepEqual(built.value, {
      code: 'KT20261123-ABCD', private_content_copy: true, draft_state: { step: 'audience' }, title: 'Thi thử',
      skills: ['listening', 'reading'], exam_mode: 'live', listening_test_id: 'L1', reading_test_id: 'R1',
      allow_early_advance: false, listening_is_public: false, reading_is_public: false,
    });
    assert.equal(buildCreateBody({ ...form, title: '' }, 'c').ok, false);
    assert.equal(buildCreateBody({ ...form, skills: [] }, 'c').ok, false);
  });

  test('patch sends only what changed', () => {
    const exam = normalizeOrgExam(row({ skills: ['listening', 'reading', 'writing', 'speaking'], starts_at: '2026-11-25T13:00:00Z', draft_state: { step: 'papers' } }));
    const form = formFromExam(exam);
    assert.deepEqual(buildPatchBody(form, exam, 'papers').value, {});
    const changed = { ...form, skills: ['listening', 'reading'], mode: 'self_paced', openUntil: '2026-11-27T23:59' };
    assert.deepEqual(buildPatchBody(changed, exam, 'mode').value, {
      skills: ['listening', 'reading'], exam_mode: 'self_paced', open_until: '2026-11-27T23:59:00+07:00', draft_state: { step: 'mode' },
    });
  });

  test('patch refuses to clear a saved active time that the API cannot remove', () => {
    const exam = normalizeOrgExam(row({ starts_at: '2026-11-25T13:00:00Z' }));
    const form = formFromExam(exam);
    assert.deepEqual(buildPatchBody({ ...form, startsAt: '' }, exam, 'mode'), {
      ok: false,
      error: 'Không thể bỏ giờ bắt đầu đã lưu. Chọn giá trị mới để lưu.',
    });
  });

  test('self-paced mode line counts the chosen parts', () => {
    const exam = normalizeOrgExam(row({ reading_minutes: 60, writing_minutes: 60 }));
    assert.equal(modeLine({ ...formFromExam(exam), mode: 'self_paced', skills: ['listening', 'reading'] }, exam), 'Người thi cần một quãng liền khoảng 92 phút.');
    assert.match(modeLine({ ...formFromExam(exam), mode: 'self_paced', skills: ['reading', 'speaking'] }, exam), /60 phút, chưa tính Speaking/);
    assert.equal(modeLine({ ...formFromExam(exam), mode: 'live' }, exam), null);
  });

  test('Listening counts its real seat clock (CR #2640 deviation 4)', () => {
    const exam = normalizeOrgExam(row({ reading_minutes: 60, listening_seconds: 2520 }));
    const form = { ...formFromExam(exam), mode: 'self_paced', skills: ['listening', 'reading'] };
    assert.equal(exam.listeningSeconds, 2520);
    assert.equal(modeLine(form, exam), 'Người thi cần một quãng liền khoảng 102 phút.');
    assert.equal(modeLine(form, exam, 40 * 60 + 120), 'Người thi cần một quãng liền khoảng 102 phút.');
    assert.equal(modeLine(form, exam, 20 * 60 + 120), 'Người thi cần một quãng liền khoảng 82 phút.');
    const unknown = normalizeOrgExam(row({ reading_minutes: 60 }));
    assert.equal(modeLine({ ...form }, unknown), 'Người thi cần một quãng liền khoảng 92 phút.');
  });

  test('machine code is stable in shape', () => {
    assert.match(newExamCode(Date.parse('2026-11-23T12:00:00Z'), () => 0.5), /^KT20261123-[0-9A-Z]{4}$/);
  });
});

describe('audience and schedule', () => {
  const audience = normalizeAudience({ items: [
    { student_id: 's1', user_id: 'u1', name: 'An', source: { kind: 'cohort', label: 'Lớp A' }, skills: ['listening'], selected: true },
    { student_id: 's2', user_id: null, name: 'Bình', source: { kind: 'learner', label: 'Học viên lẻ' }, skills: ['listening'], selected: false },
    { student_id: '', name: 'bad' },
  ], practice_overlap: null });

  test('rows and summary', () => {
    assert.equal(audience.items.length, 2);
    const s = audienceSummary(audience.items);
    assert.equal(s.selected, 1);
    assert.equal(s.line, '1 người được chọn trong 2 người của danh sách · Lớp A (1) · Học viên lẻ (1)');
  });

  test('schedule says every missing piece, like the service', () => {
    const exam = normalizeOrgExam(row({ skills: ['listening', 'speaking'] }));
    assert.deepEqual(scheduleMissing(exam, null), ['listening_paper', 'speaking_paper', 'audience', 'starts_at']);
    const ready = normalizeOrgExam(row({ skills: ['listening'], listening_test_id: 'L1', exam_mode_v2: 'self_paced', open_until: '2026-11-27T16:59:00Z' }));
    assert.deepEqual(scheduleMissing(ready, audience), []);
  });

  test('422 not_ready is read from the thrown error', () => {
    const error = Object.assign(new Error('x'), { status: 422, detail: { code: 'not_ready', missing: ['audience', 1] } });
    assert.deepEqual(notReadyMissing(error), ['audience']);
    assert.equal(notReadyMissing(new Error('x')), null);
  });
});

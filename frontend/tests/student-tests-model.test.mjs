// LEARNERCORE-0063 T16 part 2b (amendment 1, FR-080…FR-084): pure logic of the
// Thi thử page over `GET /api/student/tests` (#2603, models/student_tests.py).
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SELF_TESTS, examAction, examModeLabel, examSelfPacedLine, examSkillsLine, examStateLabel,
  normalizeStudentTests, resultKindLabel, resultOverallCopy, resultScoreCopy, safePath, shortOfCredits,
  vnDateCopy, vnDateTimeCopy,
} from '../lib/student-tests-model.mjs';

const page = (over = {}) => ({ assigned_exams: [], results: [], results_next_cursor: null, credits: null, degraded: [], ...over });
const exam = (over = {}) => ({
  exam_id: 'e1', title: 'Mock tháng 11', mode: null, state: 'open', opens_at: null, closes_at: null,
  skills: ['listening', 'reading', 'writing', 'speaking'], total_minutes: null, has_sitting_in_progress: false,
  href: '/mock-exam?code=NOV', ...over,
});
const result = (over = {}) => ({
  kind: 'listening_full', id: 'a1', title: 'Cam 18 Test 1', submitted_at: '2026-11-22T17:30:00Z',
  state: null, band: 7, correct: null, total: null, pending_skills: null, overall: null, href: '/listening/result?id=a1', ...over,
});

test('only the contract passes the boundary', () => {
  assert.equal(normalizeStudentTests(null), null);
  assert.equal(normalizeStudentTests([]), null);
  assert.equal(normalizeStudentTests({ results: [] }), null);
  const empty = normalizeStudentTests(page());
  assert.deepEqual(empty.assigned, []);
  assert.deepEqual(empty.results, []);
  assert.equal(empty.credits, null);
  assert.equal(empty.nextCursor, null);
  assert.deepEqual([...normalizeStudentTests(page({ degraded: ['results', 'other'] })).degraded], ['results']);
  // A row outside the contract is dropped, not drawn half.
  const odd = normalizeStudentTests(page({
    assigned_exams: [exam({ state: 'paused' }), exam({ href: 'https://evil.example' }), exam()],
    results: [result({ kind: 'quiz' }), result({ kind: 'mock', state: null }), result()],
  }));
  assert.equal(odd.assigned.length, 1);
  assert.equal(odd.results.length, 1);
});

test('links are same-origin paths only', () => {
  assert.equal(safePath('/mock/result?sitting=s1'), '/mock/result?sitting=s1');
  for (const bad of ['https://evil.example/x', '//evil.example', 'javascript:alert(1)', '/\\evil', '', null]) {
    assert.equal(safePath(bad), null, String(bad));
  }
});

test('FR-081: five states in words, mode line, "Gồm" only without four skills, the self-paced sentence from total_minutes only', () => {
  assert.deepEqual(['upcoming', 'open', 'submitted', 'released', 'closed_missed'].map(examStateLabel), [
    'Sắp diễn ra', 'Đang mở', 'Đã thi, chờ kết quả', 'Đã có kết quả', 'Đã đóng, bạn chưa thi',
  ]);
  assert.equal(examModeLabel('live'), 'Thi cùng giờ');
  assert.equal(examModeLabel('self_paced'), 'Bắt đầu lúc nào cũng được trong thời gian mở');
  assert.equal(examModeLabel(null), null);
  assert.equal(examSkillsLine(['listening', 'reading', 'writing', 'speaking']), null);
  assert.equal(examSkillsLine(['listening', 'reading', 'writing']), 'Gồm: Listening, Reading, Writing');
  const [selfPaced] = normalizeStudentTests(page({ assigned_exams: [exam({ mode: 'self_paced', total_minutes: 160 })] })).assigned;
  assert.equal(examSelfPacedLine(selfPaced), 'Làm liền một mạch khoảng 160 phút. Đã bắt đầu thì không dừng giữa các phần.');
  const [noMinutes] = normalizeStudentTests(page({ assigned_exams: [exam({ mode: 'self_paced' })] })).assigned;
  assert.equal(examSelfPacedLine(noMinutes), null);
  const [live] = normalizeStudentTests(page({ assigned_exams: [exam({ mode: 'live', total_minutes: 160 })] })).assigned;
  assert.equal(examSelfPacedLine(live), null);
});

test('FR-081: "Vào thi" / "Làm tiếp" only while open, "Xem kết quả" once released, nothing otherwise', () => {
  const rows = normalizeStudentTests(page({
    assigned_exams: [
      exam({ exam_id: 'a' }), exam({ exam_id: 'b', has_sitting_in_progress: true, href: '/mock-exam?sitting=s1' }),
      exam({ exam_id: 'c', state: 'released', href: '/mock/result?sitting=s2' }),
      exam({ exam_id: 'd', state: 'upcoming' }), exam({ exam_id: 'e', state: 'submitted' }), exam({ exam_id: 'f', state: 'closed_missed' }),
    ],
  })).assigned;
  assert.deepEqual(rows.map((row) => examAction(row)?.label ?? null), ['Vào thi', 'Làm tiếp', 'Xem kết quả', null, null, null]);
  assert.equal(examAction(rows[1]).href, '/mock-exam?sitting=s1');
  assert.equal(examAction(rows[0]).fullTest, true);
  assert.equal(examAction(rows[2]).fullTest, false);
});

test('FR-082: kind, band only from the API, mini "Đúng a trên b câu" only when b > 0, "Đang chấm" for Writing/Speaking', () => {
  assert.equal(resultKindLabel('listening_full'), 'Full test Listening');
  assert.equal(resultKindLabel('reading_mini'), 'Mini test Reading');
  assert.equal(resultKindLabel('mock'), 'Mock test');
  const rows = normalizeStudentTests(page({
    results: [
      result({ id: '1', band: 7 }), result({ id: '2', band: 6.5, kind: 'reading_full' }),
      result({ id: '3', band: null }),                                               // 38 questions: no band
      result({ id: '4', kind: 'listening_mini', band: null, correct: 12, total: 20 }),
      result({ id: '5', kind: 'reading_mini', band: null, correct: 0, total: 0 }),   // never "0 trên 0"
      result({ id: '6', kind: 'speaking_full', band: null }), result({ id: '7', kind: 'writing_full', band: null }),
      result({ id: '8', kind: 'speaking_full', band: 6 }),
    ],
  })).results;
  assert.deepEqual(rows.map(resultScoreCopy), [
    'Band 7.0', 'Band 6.5', null, 'Đúng 12 trên 20 câu', null, 'Đang chấm', 'Đang chấm', 'Band 6.0',
  ]);
  assert.ok(rows.every((row) => resultOverallCopy(row) === null));
});

test('FR-082 HOLD: an unreleased mock shows only "Đang chờ công bố", even if the payload carried a score', () => {
  const rows = normalizeStudentTests(page({
    results: ['submitted', 'grading', 'reviewing'].map((state, i) => result({
      id: `m${i}`, kind: 'mock', state, band: 7, overall: 7, pending_skills: ['speaking'], href: '/mock/result?sitting=s',
    })),
  })).results;
  for (const row of rows) {
    assert.equal(resultScoreCopy(row), 'Đang chờ công bố');
    assert.equal(resultOverallCopy(row), null);
    assert.equal(row.band, null);
    assert.equal(row.overall, null);
    assert.equal(row.pendingSkills, null);
  }
});

test('FR-082: a released mock carries Overall or "Chưa có Overall: còn chờ chấm <kỹ năng>"; no band column', () => {
  const [done, waiting, three] = normalizeStudentTests(page({
    results: [
      result({ id: 'r1', kind: 'mock', state: 'released', band: 8, overall: 6.5 }),
      result({ id: 'r2', kind: 'mock', state: 'released', overall: null, pending_skills: ['speaking'] }),
      result({ id: 'r3', kind: 'mock', state: 'released', overall: null }),
    ],
  })).results;
  assert.equal(resultScoreCopy(done), null);
  assert.equal(done.band, null);
  assert.equal(resultOverallCopy(done), '6.5');
  assert.equal(resultOverallCopy(waiting), 'Chưa có Overall: còn chờ chấm Speaking');
  assert.equal(resultOverallCopy(three), null);
});

test('FR-080: block 1 lists full and mini per skill, never a four-skill self-chosen test', () => {
  assert.deepEqual(SELF_TESTS.map((row) => row.title), [
    'Full test Listening', 'Mini test Listening', 'Full test Reading', 'Mini test Reading', 'Full test Speaking', 'Full test Writing',
  ]);
  assert.deepEqual(SELF_TESTS.slice(0, 4).map((row) => row.href), ['/listening/tests', '/listening/mini-test', '/reading/test', '/reading/mini-test']);
  assert.ok(SELF_TESTS.every((row) => !/4 kỹ năng|bốn kỹ năng/i.test(row.title)));
});

test('FR-084: Writing needs 2 credits, Speaking 3; Listening/Reading and null credits never short', () => {
  const by = Object.fromEntries(SELF_TESTS.map((row) => [row.id, row]));
  assert.equal(shortOfCredits(by.writing_full, { total: 1 }), true);
  assert.equal(shortOfCredits(by.writing_full, { total: 2 }), false);
  assert.equal(shortOfCredits(by.speaking_full, { total: 2 }), true);
  assert.equal(shortOfCredits(by.speaking_full, { total: 3 }), false);
  assert.equal(shortOfCredits(by.listening_full, { total: 0 }), false);
  assert.equal(shortOfCredits(by.reading_mini, { total: 0 }), false);
  assert.equal(shortOfCredits(by.writing_full, null), false);
});

test('dates and times are Vietnam time', () => {
  assert.equal(vnDateCopy('2026-11-22T17:30:00Z'), '23/11/2026');
  assert.equal(vnDateTimeCopy('2026-11-25T13:00:00Z'), '20:00 25/11/2026');
  assert.equal(vnDateCopy('nope'), null);
  assert.equal(vnDateTimeCopy(null), null);
});

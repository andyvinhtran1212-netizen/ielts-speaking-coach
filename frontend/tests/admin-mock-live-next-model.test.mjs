import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  clockSeconds,
  filterLiveStudents,
  gapBarHeight,
  liveStudentNeedsAttention,
  nextConfiguredSection,
  normalizeLiveSnapshot,
  normalizePacing,
  normalizePublishedExams,
} from '../lib/admin-mock-live-model.mjs';

const ROOT = join(import.meta.dirname, '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');

const livePayload = () => ({
  exam: {
    id: 'exam-1', code: 'FT-1', title: 'Full Test 1', exam_mode: 'sequential', status: 'published',
    is_open: true, active_section: 'listening', collected_section: null,
    section_started_at: '2026-08-16T08:00:00Z', section_duration_seconds: 1800,
    section_time_left_seconds: 600, configured_sections: ['listening', 'reading', 'writing'], cohort_id: 'cohort-1',
  },
  roster: { expected: 2, started: 1, not_started: ['Bình'], off_roster: [] },
  sections: {
    listening: { submitted: 0, working: 1, absent: 1, missed: 0, expected: 2 },
    reading: { submitted: 0, working: 0, absent: 1, missed: 0, expected: 2 },
    writing: { submitted: 0, working: 0, absent: 1, missed: 0, expected: 2 },
  },
  students: [
    {
      user_id: 'user-1', student_name: 'An', sitting_id: 'sit-1', status: 'lrw_in_progress', started: true,
      in_roster: true, assigned_skills: null, needs_retest: false,
      sections: {
        listening: { state: 'working', answered: 0, total: 40, submitted_at: null, last_activity_at: null, live: true, stalled: false },
        reading: { state: 'waiting', answered: null, total: 40, submitted_at: null, last_activity_at: null, live: true, stalled: false },
        writing: { state: 'waiting', answered: null, total: null, submitted_at: null, last_activity_at: null, live: true, stalled: false },
      },
      speaking: { required: true, count: 1, completed_at: null },
      integrity: { blur_count: 1, blur_seconds: 20, offline_events: 0, resumes: 1 },
    },
    {
      user_id: 'user-2', student_name: 'Bình', sitting_id: null, status: 'chưa vào', started: false,
      in_roster: true, sections: {
        listening: { state: 'absent', answered: null, total: 40, submitted_at: null, last_activity_at: null, live: true },
        reading: { state: 'absent', answered: null, total: 40, submitted_at: null, last_activity_at: null, live: true },
        writing: { state: 'absent', answered: null, total: null, submitted_at: null, last_activity_at: null, live: true },
      },
      speaking: { required: true, count: 0, completed_at: null }, integrity: {},
    },
  ],
  server_time: '2026-08-16T08:20:00Z',
});

test('published picker is strict and never admits draft rows', () => {
  assert.deepEqual(normalizePublishedExams({ exams: [
    { id: 'p', code: 'P', status: 'published', exam_mode: 'sequential', is_open: true },
    { id: 'd', code: 'D', status: 'draft' },
  ] }), [{ id: 'p', code: 'P', title: '', examMode: 'sequential', isOpen: true }]);
  assert.equal(normalizePublishedExams({ items: [] }), null);
});

test('live snapshot preserves unknown roster and rejects partial/malformed students', () => {
  const normalized = normalizeLiveSnapshot(livePayload());
  assert.equal(normalized.exam.id, 'exam-1');
  assert.equal(normalized.students[0].sections.listening.answered, 0);
  const unknown = livePayload();
  unknown.roster.expected = null;
  assert.equal(normalizeLiveSnapshot(unknown).roster.expected, null);
  const malformed = livePayload();
  malformed.students[1].sections.listening.state = 'mystery';
  assert.equal(normalizeLiveSnapshot(malformed), null);
});

test('attention filters include absent, blank, stalled and missed persisted states', () => {
  const students = normalizeLiveSnapshot(livePayload()).students;
  assert.equal(liveStudentNeedsAttention(students[0]), true);
  assert.equal(filterLiveStudents(students, 'absent')[0].studentName, 'Bình');
  assert.equal(filterLiveStudents(students, 'working')[0].studentName, 'An');
  assert.equal(filterLiveStudents(students, 'problem').length, 2);
});

test('section progression follows only configured papers and clock is locally interpolated', () => {
  const exam = normalizeLiveSnapshot(livePayload()).exam;
  assert.equal(nextConfiguredSection(exam), 'reading');
  assert.equal(clockSeconds({ seconds: 600, at: 1_000 }, 11_500), 589);
  assert.equal(clockSeconds({ seconds: 3, at: 1_000 }, 9_000), 0);
});

test('pacing keeps clears as activity, derives long gaps and requires backend caveats', () => {
  const raw = {
    sitting_id: 'sit-1', exam_id: 'exam-1', student_name: 'An', exam_code: 'FT-1', status: 'released',
    caveats: { answered_at_is_last_touch: true, gap_is_time_since_previous_answer: true },
    sections: {
      listening: {
        started_at: '2026-08-16T08:00:00Z', ended_at: '2026-08-16T08:30:00Z', answered: 1, total: 40,
        timeline: [
          { q_num: 1, at: '2026-08-16T08:00:30Z', gap_seconds: 30, is_answered: true },
          { q_num: 2, at: '2026-08-16T08:03:30Z', gap_seconds: 180, is_answered: false },
        ],
        answers_in_final_minutes: 0, idle_tail_seconds: 1590, worked_in_paper_order: true,
      },
      writing: { started_at: null, ended_at: null, tasks: [{ task: 'task1', word_count: 123, last_saved_at: '2026-08-16T09:00:00Z' }] },
    },
  };
  const normalized = normalizePacing(raw);
  assert.equal(normalized.sections.listening.timeline[1].isAnswered, false);
  assert.equal(normalized.sections.listening.longGapCount, 1);
  assert.equal(normalized.sections.writing.tasks[0].wordCount, 123);
  raw.caveats.answered_at_is_last_touch = false;
  assert.equal(normalizePacing(raw), null);
  assert.equal(gapBarHeight(600), 80);
});

test('native routes own auth, exact identities, irreversible guards and accessible void dialog', () => {
  const live = read('app', '(authed-admin-mock-live)', 'admin', 'mock-live', 'admin-mock-live.tsx');
  const dialog = read('app', '(authed-admin-mock-live)', 'admin', 'mock-live', 'void-sitting-dialog.tsx');
  const pacing = read('app', '(authed-admin-mock-live)', 'admin', 'mock-pacing', 'admin-mock-pacing.tsx');
  const livePage = read('app', '(authed-admin-mock-live)', 'admin', 'mock-live', 'page.tsx');
  const pacingPage = read('app', '(authed-admin-mock-live)', 'admin', 'mock-pacing', 'page.tsx');
  const cockpitModel = read('lib', 'admin-mock-tests-model.mjs');
  for (const path of [
    ['app', '(authed-admin-mock-live)', 'admin', 'mock-live', 'page.tsx'],
    ['app', '(authed-admin-mock-live)', 'admin', 'mock-pacing', 'page.tsx'],
    ['public', 'css', 'admin-mock-live-next.css'],
  ]) assert.ok(existsSync(join(ROOT, ...path)), path.join('/'));
  assert.match(livePage, /AdminAccessGate/);
  assert.match(pacingPage, /AdminAccessGate/);
  for (const token of ['normalizePublishedExams', 'normalizeLiveSnapshot', 'accountRef.current', 'requestRef.current', 'selectedRef.current', 'from_section', 'collectedSection', 'loadSnapshot(examId)', 'Không thao tác lại', '5_000']) assert.ok(live.includes(token), token);
  assert.doesNotMatch(live, /prompt\s*\(/);
  assert.match(dialog, /import \{ Dialog \}/);
  assert.match(dialog, /<Dialog/);
  assert.match(pacing, /normalizePacing/);
  assert.match(pacing, /lần sửa cuối cùng/);
  assert.match(cockpitModel, /return `\/admin\/mock-live\?exam_id=/);
  assert.doesNotMatch(cockpitModel, /pages\/admin\/mock-live\/index\.html\?exam_id/);
});

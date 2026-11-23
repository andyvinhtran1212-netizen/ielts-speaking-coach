// MOCKORG-0086 T034 PR 1: the exam record model (FR-145, FR-146, FR-149, FR-151).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  RECORD_TABS,
  answeredCopy,
  canAddTime,
  candidateRows,
  clockCopy,
  liveAlerts,
  makeupTargets,
  normalizeEvents,
  normalizeMonitor,
  normalizeRoster,
  proctorSnapshot,
  proctorState,
  sameProctorSnapshot,
  recordHref,
  recordTab,
  retestFlagsBody,
  selfPacedCounts,
} from '../lib/mock-exam-record-model.mjs';

const NOW = Date.parse('2026-11-25T13:30:00Z');
const live = (over = {}, students = []) => ({
  exam: { id: 'e1', title: 'Thi tháng 11', exam_mode: 'sequential', exam_mode_v2: 'live', is_open: true,
    active_section: 'reading', configured_sections: ['listening', 'reading', 'writing'], section_time_left_seconds: 600, ...over },
  students,
  server_time: '2026-11-25T13:30:00Z',
  idle_threshold_minutes: 5,
});
const working = (over = {}) => ({ state: 'working', answered: 12, total: 40, last_activity_at: '2026-11-25T13:29:00Z', live: true, stalled: false, ...over });

describe('tabs (FR-145)', () => {
  test('seven tabs in order; the default follows the state; a known ?tab= wins', () => {
    assert.deepEqual(RECORD_TABS.map((t) => t.label), ['Đề', 'Thí sinh', 'Theo dõi', 'Chấm', 'Phân tích', 'Trả kết quả', 'Nhật ký']);
    assert.equal(recordTab(null, 'draft'), 'de');
    assert.equal(recordTab(null, 'scheduled'), 'de');
    assert.equal(recordTab(null, 'running'), 'theo-doi');
    assert.equal(recordTab(null, 'open'), 'theo-doi');
    assert.equal(recordTab(null, 'grading'), 'cham');
    assert.equal(recordTab(null, 'released'), 'phan-tich');
    assert.equal(recordTab(null, null), 'de');
    assert.equal(recordTab('nhat-ky', 'running'), 'nhat-ky');
    assert.equal(recordTab('bogus', 'running'), 'theo-doi');
    assert.equal(recordHref('e 1', 'thi-sinh'), '/admin/mock-tests/e%201?tab=thi-sinh');
  });
});

describe('monitor (FR-146)', () => {
  test('normalizes the live read and rejects other shapes', () => {
    assert.equal(normalizeMonitor(null), null);
    assert.equal(normalizeMonitor({ exam: {}, students: [] }), null);
    const m = normalizeMonitor(live({}, [{ sitting_id: 's1', user_id: 'u1', student_name: 'An', started: true, sections: { reading: working(), bogus: {} } }]), NOW);
    assert.equal(m.exam.mode, 'live');
    assert.deepEqual(Object.keys(m.students[0].sections), ['reading']);
    assert.equal(answeredCopy(m.students[0].sections.reading), '12/40');
    assert.equal(m.students[0].selfPaced, null);
    assert.equal(m.idleMinutes, 5);
  });

  test('alerts: offline, idle past the threshold, not in after the start', () => {
    const m = normalizeMonitor(live({}, [
      { sitting_id: 's1', student_name: 'An', started: true, sections: { reading: working({ live: false }) } },
      { sitting_id: 's2', student_name: 'Bình', started: true, sections: { reading: working({ last_activity_at: '2026-11-25T13:20:00Z' }) } },
      { user_id: 'u3', student_name: 'Chi', started: false, sections: {} },
      { sitting_id: 's4', student_name: 'Dũng', started: true, sections: { reading: working() } },
    ]), NOW);
    assert.deepEqual(liveAlerts(m, NOW), { offline: ['An'], idle: ['Bình'], absent: ['Chi'] });
  });

  test('proctor bar: collect asks, start waits for the sweep, stale locks', () => {
    const running = normalizeMonitor(live(), NOW);
    let bar = proctorState(running, false);
    assert.equal(bar.next, 'writing');
    assert.equal(bar.collect.enabled, true);
    assert.equal(bar.collect.label, 'Thu bài và sang phần sau…');
    assert.equal(bar.start.enabled, false);
    bar = proctorState(normalizeMonitor(live({ collected_section: 'reading' }), NOW), false);
    assert.equal(bar.collecting, true);
    assert.equal(bar.start.enabled, false);
    bar = proctorState(normalizeMonitor(live({ collected_section: 'reading', collection_sweep_completed_section: 'reading' }), NOW), false);
    assert.equal(bar.start.enabled, true);
    assert.equal(bar.start.label, 'Bắt đầu phần Writing');
    bar = proctorState(running, true);
    assert.deepEqual([bar.open.enabled, bar.start.enabled, bar.collect.enabled], [false, false, false]);
    const a = proctorSnapshot(running);
    assert.equal(sameProctorSnapshot(a, proctorSnapshot(normalizeMonitor(live(), NOW + 5000))), true);
    assert.equal(sameProctorSnapshot(a, proctorSnapshot(normalizeMonitor(live({ active_section: 'listening' }), NOW))), false);
    assert.equal(sameProctorSnapshot(a, proctorSnapshot(normalizeMonitor(live({ collected_section: 'reading' }), NOW))), false);
    assert.equal(sameProctorSnapshot(a, null), false);
    assert.equal(clockCopy(3725), '1:02:05');
    assert.equal(clockCopy(null), '—');
  });
});

describe('self-paced (FR-151)', () => {
  const sp = (students) => live({ exam_mode: 'retake', exam_mode_v2: 'self_paced', active_section: 'not_started' }, students);

  test('four states from the server, else derived; extra time only for someone working', () => {
    const m = normalizeMonitor(sp([
      { sitting_id: 's1', student_name: 'An', self_paced_state: 'in_progress', current_section: 'reading', section_time_left_seconds: 900, sections: { reading: working() } },
      { user_id: 'u2', student_name: 'Bình', self_paced_state: 'not_started', sections: {} },
      { sitting_id: 's3', student_name: 'Chi', sections: { reading: { state: 'submitted' } } },
      { sitting_id: 's4', student_name: 'Dũng', self_paced_state: 'missed', sections: {} },
    ]), NOW);
    assert.deepEqual(selfPacedCounts(m), { not_started: 1, in_progress: 1, submitted: 1, missed: 1 });
    assert.equal(m.students[2].selfPaced.fromServer, false);
    assert.deepEqual(m.students.map(canAddTime), [true, false, false, false]);
    assert.deepEqual(liveAlerts(m, NOW), { offline: [], idle: [], absent: [] });
  });
});

describe('candidates (FR-149)', () => {
  test('rows join the monitor, the audience source and the roster flags', () => {
    const m = normalizeMonitor(live({}, [
      { sitting_id: 's1', user_id: 'u1', student_name: 'An', started: true, assigned_skills: ['reading'], sections: {} },
      { user_id: 'u2', student_name: 'Bình', started: false, in_roster: false, sections: {} },
    ]), NOW);
    const roster = normalizeRoster({ roster: [{ sitting_id: 's1', review_id: 'r1', retest_flags: { reading: true, writing: false }, retest_skills: ['reading', 'writing', 'bogus'] }, { review_id: 'x' }] });
    assert.equal(normalizeRoster({}), null);
    const rows = candidateRows(m, [{ userId: 'u1', source: 'Lớp A', skills: ['reading'] }], roster);
    assert.deepEqual(rows.map((r) => [r.name, r.source, r.retestFlags, r.retestAllowed, r.canFlag]), [
      ['An', 'Lớp A', ['reading'], ['reading', 'writing'], true],
      ['Bình', 'Ngoài danh sách', [], [], false],
    ]);
    assert.deepEqual(retestFlagsBody(['reading', 'writing'], ['writing']), { retest_flags: { reading: false, writing: true } });
  });

  test('make-up targets are other published self-paced exams', () => {
    const rows = [
      { id: 'e1', status: 'published', mode: 'self_paced' },
      { id: 'm1', status: 'published', mode: 'self_paced' },
      { id: 'm2', status: 'draft', mode: 'self_paced' },
      { id: 'm3', status: 'published', mode: 'live' },
    ];
    assert.deepEqual(makeupTargets(rows, 'e1').map((r) => r.id), ['m1']);
    assert.deepEqual(makeupTargets(null, 'e1'), []);
  });
});

describe('timeline', () => {
  test('events carry a Vietnamese label, the actor and a payload line', () => {
    assert.equal(normalizeEvents({}), null);
    const out = normalizeEvents({ items: [
      { id: 'v1', kind: 'extra_time', payload: { section: 'reading', seconds: 600, reason: 'mất điện' }, actor_name: 'Andy', created_at: '2026-11-25T13:00:00Z' },
      { id: 'v2', kind: 'released', payload: {}, actor_id: null },
      { kind: 'room_opened' },
    ] });
    assert.deepEqual(out.map((e) => [e.label, e.actor, e.detail]), [
      ['Cộng giờ', 'Andy', 'Reading · +10 phút · lý do: mất điện'],
      ['Trả kết quả', 'Hệ thống', ''],
    ]);
  });
});

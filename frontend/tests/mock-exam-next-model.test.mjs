import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  canDiscardWritingDrafts,
  chooseWritingDraft,
  configuredMockSections,
  formatMockTime,
  isMockSubmitSettled,
  mockExamParams,
  mockExamView,
  mockPlayerHref,
  normalizeMockExamState,
  parseLocalWritingDraft,
} from '../lib/mock-exam-model.mjs';

const ROOT = join(import.meta.dirname, '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');

const payload = (overrides = {}) => ({
  sitting: {
    id: 'sitting-1', mock_exam_id: 'exam-1', user_id: 'user-1', status: 'lrw_in_progress', sealed: true,
    listening_attempt_id: 'listen-1', reading_attempt_id: 'read-1', listening_submitted_at: null,
    reading_submitted_at: null, writing_submitted_at: null,
    writing_submission: { task1: { text: 'server', submitted_at: '2026-08-17T00:00:00Z' }, task2: { text: '' } },
  },
  exam: {
    listening_test_id: 'listen-test', reading_test_code: 'READ-1', reading_title: 'Mock 1',
    writing_task1: { id: 'w1', title: 'Task 1', prompt_text: 'Write.', prompt_image_url: null },
    writing_task2: { id: 'w2', title: 'Task 2', prompt_text: 'Discuss.', prompt_image_url: null },
    speaking_topic_set: { part1: ['General'] }, review_sla_days: 3,
  },
  exam_mode: 'sequential', assigned_skills: null, active_section: 'reading',
  collected_section: null, section_time_left_seconds: 120, section_duration_seconds: 3600,
  ...overrides,
});

test('mock query and sitting identity fail closed', () => {
  assert.deepEqual(mockExamParams('code=M1'), { code: 'M1', sittingId: null });
  assert.deepEqual(mockExamParams('sitting=s1'), { code: null, sittingId: 's1' });
  assert.throws(() => mockExamParams(''), /missing-mock-exam-identity/);
  assert.throws(() => normalizeMockExamState(payload(), 'other'), /identity-mismatch/);
  assert.throws(() => normalizeMockExamState(payload({ active_section: 'invented' })), /invalid-mock-state/);
});

test('route state respects canonical status, collect pause and retake assignment', () => {
  const open = normalizeMockExamState(payload());
  assert.equal(mockExamView(open), 'section');
  assert.deepEqual(configuredMockSections(open), ['listening', 'reading', 'writing']);
  const paused = normalizeMockExamState(payload({ collected_section: 'reading' }));
  assert.equal(mockExamView(paused), 'waiting');
  const retake = normalizeMockExamState(payload({
    exam_mode: 'retake', assigned_skills: ['writing', 'bad'], active_section: 'not_started',
  }));
  assert.deepEqual(configuredMockSections(retake), ['writing']);
  assert.equal(mockExamView(retake), 'retake-menu');
});

test('reviewed sitting remains a valid submitted state while awaiting release', () => {
  const reviewed = normalizeMockExamState(payload({
    active_section: 'not_started',
    sitting: { ...payload().sitting, status: 'reviewed' },
  }));
  assert.equal(mockExamView(reviewed), 'submitted');
});

test('player launch uses stable Gate E admission and preserves mock identity', () => {
  const state = normalizeMockExamState(payload());
  assert.equal(mockPlayerHref(state, 'listening'), '/core-player/launch?surface=listening_test&id=listen-test&sitting_id=sitting-1&mock_embed=1&from=mock');
  assert.equal(mockPlayerHref(state, 'reading'), '/core-player/launch?surface=reading_exam&test_id=READ-1&sitting_id=sitting-1&mock_embed=1&from=mock');
});

test('writing recovery prefers an explicitly unsynced local deletion and otherwise compares copies', () => {
  const unsyncedEmpty = parseLocalWritingDraft(JSON.stringify({ text: '', ts: 1, synced: false }));
  assert.deepEqual(chooseWritingDraft({ text: 'server', submittedAt: '2026-08-17T00:00:00Z' }, unsyncedEmpty), { text: '', localWon: true });
  const oldLocal = parseLocalWritingDraft(JSON.stringify({ text: 'old', ts: 1, synced: null }));
  assert.deepEqual(chooseWritingDraft({ text: 'new', submittedAt: '2026-08-17T00:00:00Z' }, oldLocal), { text: 'new', localWon: false });
});

test('collection never discards a newer Writing draft that the server did not acknowledge', () => {
  const server = {
    task1: { text: 'older server copy' },
    task2: { text: 'same copy' },
  };
  const unsynced = {
    task1: parseLocalWritingDraft(JSON.stringify({ text: 'newer local copy', ts: 2, synced: false })),
    task2: parseLocalWritingDraft(JSON.stringify({ text: 'same copy', ts: 2, synced: false })),
  };
  assert.equal(canDiscardWritingDrafts(server, unsynced), false);
  assert.equal(canDiscardWritingDrafts(server, {
    ...unsynced,
    task1: parseLocalWritingDraft(JSON.stringify({ text: 'older server copy', ts: 2, synced: false })),
  }), true);
  assert.equal(canDiscardWritingDrafts(server, {
    ...unsynced,
    task1: parseLocalWritingDraft(JSON.stringify({ text: 'acknowledged copy', ts: 2, synced: true })),
  }), false);
});

test('submit reconciliation treats Writing collect as settled only after its stamp', () => {
  const collectedWriting = normalizeMockExamState(payload({ active_section: 'writing', collected_section: 'writing' }));
  assert.equal(isMockSubmitSettled(collectedWriting, 'writing'), false);
  const movedWithoutStamp = normalizeMockExamState(payload({ active_section: 'done', section_time_left_seconds: 0 }));
  assert.equal(isMockSubmitSettled(movedWithoutStamp, 'writing'), false);
  const stamped = normalizeMockExamState(payload({
    active_section: 'writing', collected_section: 'writing',
    sitting: { ...payload().sitting, writing_submitted_at: '2026-08-17T01:00:00Z' },
  }));
  assert.equal(isMockSubmitSettled(stamped, 'writing'), true);
  assert.equal(formatMockTime(3661), '1:01:01');
});

test('native route owns the clean path and both Next child players expose a same-origin flush bridge', () => {
  assert.ok(existsSync(join(ROOT, 'app', '(authed-mock-exam)', 'mock-exam', 'page.tsx')));
  const parent = read('app', '(authed-mock-exam)', 'mock-exam', 'mock-exam-runner.tsx');
  const reading = read('app', '(authed-reading-player)', 'reading', 'exam', 'session', 'reading-exam-session.tsx');
  const listening = read('app', '(authed-listening-player)', 'listening', 'test', 'session', 'listening-test-session.tsx');
  for (const token of ['mock-embed-unsaved-answers', 'finalWritingBodyRef', 'window.location.origin', 'SpeakingDebt']) {
    assert.ok(parent.includes(token), token);
  }
  for (const child of [reading, listening]) {
    assert.match(child, /event\.origin !== window\.location\.origin/);
    assert.match(child, /type: 'mock-flushed'/);
  }
  assert.doesNotMatch(parent, /dangerouslySetInnerHTML|pages\/mock-exam\.html|pages\/practice\.html/);
});

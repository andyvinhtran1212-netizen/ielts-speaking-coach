// EXAMROOM-0066 FR-022: examRoomEnabled reads the build-time surfaces list; the
// ?exam_room override works only outside production (unknown env = production).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { examRoomEnabled, examRoomOverride, parseExamRoomSurfaces } from '../lib/exam-room/flags.mjs';

test('false when the runtime config is null or has no surfaces', () => {
  assert.equal(examRoomEnabled('reading', { config: null, search: '' }), false);
  assert.equal(examRoomEnabled('reading', { config: undefined, search: '?exam_room=on' }), false);
  assert.equal(examRoomEnabled('reading', { config: { environment: 'staging' }, search: '' }), false);
  assert.equal(examRoomEnabled('reading', { config: { environment: 'staging', examRoomSurfaces: [] }, search: '' }), false);
});

test('true only for listed, known surfaces', () => {
  const config = { environment: 'production', examRoomSurfaces: ['reading', 'Writing ', 'bogus'] };
  assert.equal(examRoomEnabled('reading', { config, search: '' }), true);
  assert.equal(examRoomEnabled('writing', { config, search: '' }), true);
  assert.equal(examRoomEnabled('listening', { config, search: '' }), false);
  assert.equal(examRoomEnabled('bogus', { config, search: '' }), false);
  assert.deepEqual(parseExamRoomSurfaces(['mock', 'mock', 7, 'drill']), ['mock', 'drill']);
  assert.deepEqual(parseExamRoomSurfaces('reading'), []);
});

test('override is ignored in production and when the environment is unknown', () => {
  const off = { examRoomSurfaces: ['reading'] };
  assert.equal(examRoomEnabled('reading', { config: { ...off, environment: 'production' }, search: '?exam_room=off' }), true);
  assert.equal(examRoomEnabled('listening', { config: { environment: 'production' }, search: '?exam_room=on' }), false);
  assert.equal(examRoomEnabled('listening', { config: { environment: null }, search: '?exam_room=on' }), false);
});

test('override works on staging in both directions', () => {
  assert.equal(examRoomEnabled('listening', { config: { environment: 'staging' }, search: '?exam_room=on' }), true);
  assert.equal(examRoomEnabled('reading', { config: { environment: 'staging', examRoomSurfaces: ['reading'] }, search: '?test_id=1&exam_room=off' }), false);
  assert.equal(examRoomEnabled('reading', { config: { environment: 'staging', examRoomSurfaces: ['reading'] }, search: '?exam_room=yes' }), true);
  assert.equal(examRoomOverride(new URLSearchParams('exam_room=on')), 'on');
  assert.equal(examRoomOverride('?exam_room=ON'), null);
});

test('reads browser globals when nothing is injected', () => {
  const saved = globalThis.window;
  globalThis.window = { __AVER_RUNTIME_CONFIG__: { environment: 'staging', examRoomSurfaces: [] }, location: { search: '?exam_room=on' } };
  try {
    assert.equal(examRoomEnabled('reading'), true);
  } finally {
    if (saved === undefined) delete globalThis.window; else globalThis.window = saved;
  }
});

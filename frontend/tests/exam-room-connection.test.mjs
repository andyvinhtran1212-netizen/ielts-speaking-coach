// EXAMROOM-0066 FR-014, FR-033: connection banner state machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { blocksManualSubmit, connectionBanner, connectionReducer, initialConnectionState } from '../lib/exam-room/connection-state.mjs';
import { EXAM_ROOM_STRINGS_EN as EN } from '../lib/exam-room/strings-en.mjs';

function run(events, state = initialConnectionState()) {
  const durations = [];
  for (const e of events) {
    const r = connectionReducer(state, e);
    state = r.state;
    if (r.offlineDurationS != null) durations.push(r.offlineDurationS);
  }
  return { state, durations };
}

test('offline → syncing → back online for 5 s → online, with the offline duration', () => {
  let r = run([{ type: 'offline', at: 1000 }]);
  assert.equal(r.state.status, 'offline');
  assert.equal(blocksManualSubmit(r.state), true);
  assert.equal(connectionBanner(r.state, EN, '10:42').text, 'Connection lost. Your work was saved up to 10:42. You can keep working; it will be saved again when you are back online.');
  r = run([{ type: 'online', at: 31_400, unsaved: 2 }], r.state);
  assert.deepEqual(r.durations, [30]);
  assert.equal(r.state.status, 'syncing');
  assert.equal(connectionBanner(r.state, EN, '10:42').tone, 'warning', 'no "saved" message before the queue drains');
  assert.equal(blocksManualSubmit(r.state), true);
  r = run([{ type: 'queue-drained', at: 32_000 }], r.state);
  assert.equal(r.state.status, 'back-online');
  assert.equal(connectionBanner(r.state, EN, null).text, 'Back online. Your work has been saved.');
  assert.equal(blocksManualSubmit(r.state), false);
  r = run([{ type: 'tick', at: 36_999 }], r.state);
  assert.equal(r.state.status, 'back-online');
  r = run([{ type: 'tick', at: 37_000 }], r.state);
  assert.equal(r.state.status, 'online');
  assert.equal(connectionBanner(r.state, EN, null), null);
});

test('nothing unsaved: straight to back online; a failed save counts as offline', () => {
  const r = run([{ type: 'save-network-failure', at: 0 }, { type: 'offline', at: 500 }, { type: 'online', at: 4000, unsaved: 0 }]);
  assert.equal(r.state.status, 'back-online');
  assert.deepEqual(r.durations, [4], 'repeated offline events keep the first time');
});

test('online and drain events out of order are ignored', () => {
  const r = run([{ type: 'online', at: 0 }, { type: 'queue-drained', at: 1 }, { type: 'tick', at: 99_999 }]);
  assert.equal(r.state.status, 'online');
  assert.deepEqual(r.durations, []);
  assert.equal(initialConnectionState(false).status, 'offline');
});

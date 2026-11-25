// A P1/P3 take that the server did not save (persist failure) or rejected as too
// short (422 audio_too_short) must land back on the recorder with the take kept.
// The recorder lives in the 'prep' screen; 'recording' is only a sub-state of it.
// Before the fix both paths called showState('recording'): the Next player's
// controller threw RangeError (unknown-speaking-player-state:recording) and the
// legacy page hid every screen, so the learner lost the retry.
//
// These tests run the real practice.js functions against the real
// SpeakingPlayerController, so they fail on the old code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { SpeakingPlayerController } from '../lib/speaking-player-controller.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const js = readFileSync(path.join(here, '..', 'public', 'js', 'practice.js'), 'utf8');

function slice(start, end) {
  const from = js.indexOf(start);
  const to = js.indexOf(end, from + 1);
  assert.ok(from >= 0 && to > from, `slice ${start} … ${end}`);
  return js.slice(from, to);
}

const SOURCE = [
  slice('  function showState(name) {', '  function showError(msg) {'),
  slice('  function _handlePersistFailure(detail) {', '  // audit #3.4'),
  slice('  function _handleAudioTooShort(detail) {', '  // ── STATE: Feedback'),
].join('\n');

function sandbox({ native, part = 1 }) {
  const calls = [];
  const screens = new Map();
  const doc = {
    getElementById(id) {
      if (!id.startsWith('state-')) return null;
      if (!screens.has(id)) {
        const classes = new Set();
        screens.set(id, {
          classList: {
            add: (c) => classes.add(c),
            remove: (c) => classes.delete(c),
            toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
            contains: (c) => classes.has(c),
          },
        });
      }
      return screens.get(id);
    },
  };
  const controller = native ? new SpeakingPlayerController({ document: doc }) : null;
  const ALL = ['loading', 'error', 'mode-choice', 'prep', 'p2a', 'p2b', 'p2c', 'processing', 'feedback', 'test-results', 'completion', 'sheet'];
  const make = new Function(
    'window', '$', '_ALL_STATES', '_getNativePlayer', 'deps',
    `var _playerActive = true, _playerGeneration = 1, _currentState = null;
     var _processingTimer = null;
     var _sessionData = deps.session;
     var _clearManagedEffect = deps.noop, _showP2SubmissionRetry = deps.rec('p2retry'),
         _clearP2SubmissionRetry = deps.noop, _resetRecorder = deps.rec('reset'),
         _showRecSub = deps.rec('sub'), _renderRecordedPlayback = deps.rec('playback'),
         _renderRecordedLengthHint = deps.rec('hint'), _showRecError = deps.rec('error');
     ${SOURCE}
     return { _handlePersistFailure, _handleAudioTooShort, state: function () { return _currentState; } };`,
  );
  const api = make(
    { alert: () => calls.push(['alert']) },
    (id) => doc.getElementById(id),
    ALL,
    () => controller,
    {
      session: { part },
      noop: () => {},
      rec: (name) => (...args) => calls.push([name, ...args]),
    },
  );
  const active = () => [...screens.entries()].filter(([, el]) => el.classList.contains('active')).map(([id]) => id);
  return { api, calls, controller, active };
}

for (const native of [true, false]) {
  const label = native ? 'Next player' : 'legacy page';

  test(`${label}: persist failure on Part 1 returns to the recorder with the take`, () => {
    const { api, calls, controller, active } = sandbox({ native });
    assert.doesNotThrow(() => api._handlePersistFailure({ message: 'Lỗi lưu.' }));
    assert.equal(api.state(), 'prep');
    if (native) assert.equal(controller.getStateSnapshot(), 'prep');
    assert.deepEqual(active(), ['state-prep']);
    assert.deepEqual(calls.find((c) => c[0] === 'sub'), ['sub', 'recorded']);
    assert.ok(calls.some((c) => c[0] === 'playback'));
    assert.ok(calls.some((c) => c[0] === 'error' && /Gửi/.test(c[1])));
  });

  test(`${label}: 422 too short on Part 3 returns to the recorder with the take`, () => {
    const { api, calls, active } = sandbox({ native, part: 3 });
    assert.doesNotThrow(() => api._handleAudioTooShort({ part: 3, duration_seconds: 12.4, min_seconds: 25 }));
    assert.equal(api.state(), 'prep');
    assert.deepEqual(active(), ['state-prep']);
    assert.deepEqual(calls.find((c) => c[0] === 'sub'), ['sub', 'recorded']);
    assert.ok(calls.some((c) => c[0] === 'hint'));
    assert.ok(!calls.some((c) => c[0] === 'reset'), 'the P1/P3 take is kept');
  });

  test(`${label}: Part 2 paths are unchanged`, () => {
    const persist = sandbox({ native, part: 2 });
    persist.api._handlePersistFailure({ message: 'x' });
    assert.ok(persist.calls.some((c) => c[0] === 'p2retry'));
    const short = sandbox({ native, part: 2 });
    short.api._handleAudioTooShort({ part: 2, duration_seconds: 40, min_seconds: 80 });
    assert.equal(short.api.state(), 'p2a');
  });
}

test('no practice.js path asks for a screen called "recording"', () => {
  assert.doesNotMatch(js, /showState\(\s*['"]recording['"]\s*\)/);
});

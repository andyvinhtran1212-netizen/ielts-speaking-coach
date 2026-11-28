// EXAMSPEAK-0072 edge case "Micro bị rút giữa lúc ghi" (R139, G08-T19b): when
// the audio track ends while recording, the room stops the take, keeps it
// through the usual recorded path (the length gate decides if it can be sent),
// says "Mất kết nối micro" and starts the next take at "Không tìm thấy micro".
// The room helpers of practice.js run for real in a sandbox.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const JS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'js', 'practice.js'), 'utf8');
const start = JS.indexOf('  // ── Exam room (EXAMSPEAK-0072)');
const end = JS.indexOf('  function _hasUnsentWork() {');
assert.ok(start !== -1 && end > start);
const ROOM = JS.slice(start, end);

function track(state = 'live') {
  return { readyState: state, muted: false };
}

function sandbox({ on = true, state = 'prep', sub = 'recording', recorderState = 'recording', audio = track() } = {}) {
  const views = [];
  const log = [];
  const intervals = [];
  const recorder = { recorder: { state: recorderState }, stream: { getAudioTracks: () => [audio] } };
  const env = {
    navigator: {},
    MediaRecorder: function () {},
    window: {},
    _updateNativeView: (section, patch) => { views.push([section, patch]); return true; },
    _getNativeRecorder: () => recorder,
    _startManagedInterval: (key, fn) => { intervals.push({ key, fn }); return key; },
    _clearManagedEffect: (key) => { log.push(['clear', key]); return true; },
    stopRecording: () => { log.push(['stopRecording']); return true; },
    _stopP2SpeakingInternal: () => log.push(['stopP2']),
    _stopWaveform: () => log.push(['stopWaveform']),
  };
  const api = new Function(...Object.keys(env), `
    var _examRoomMode = ${on ? 'true' : 'false'};
    var _roomMicState = 'granted', _ROOM_LEVEL_MS = 200, _roomLevelTimer = null, _roomMicLostDone = false, _roomMicLostShown = false;
    var _roomDialogKind = null, _roomLeaveHref = '', _roomLeaving = false, _roomConfirmed = false, _ROOM_LEAVE_RESET_MS = 4000;
    var _playerGeneration = 1, _playerActive = true, _analyser = null, _recorder = null, _stream = null;
    var _currentState = ${JSON.stringify(state)}, _recSubState = ${JSON.stringify(sub)};
    var _timerId = 'elapsed', _p2SpeakTimerId = 'p2';
    ${ROOM}
    return { startLevel: _startRoomLevel, stopLevel: _stopRoomLevel, mic: (s) => _roomMic(s), micState: () => _roomMicState, timerId: () => _timerId };
  `)(...Object.values(env));
  const tick = () => intervals.at(-1).fn();
  const micViews = () => views.filter(([s]) => s === 'mic').map(([, p]) => p);
  return { api, views, log, intervals, tick, micViews, audio, recorder };
}

describe('flag on: the microphone is unplugged while recording', () => {
  test('P1/P3: the take is stopped once, kept by the recorded path, and the mic reads lost', () => {
    const { api, log, tick, micViews, audio } = sandbox();
    api.startLevel();
    tick();
    assert.deepEqual(micViews(), [], 'a live track changes nothing');
    audio.readyState = 'ended';
    tick();
    tick();
    assert.deepEqual(micViews(), [{ state: 'not_found', lost: true }]);
    assert.equal(api.micState(), 'not_found', 'the next take starts at "Không tìm thấy micro"');
    assert.deepEqual(log.filter(([k]) => k === 'stopRecording'), [['stopRecording']]);
  });

  test('a recorder that already stopped by itself is not stopped again (its onstop keeps the take)', () => {
    const { api, log, tick, micViews } = sandbox({ recorderState: 'inactive', audio: track('ended') });
    api.startLevel();
    tick();
    assert.deepEqual(micViews(), [{ state: 'not_found', lost: true }]);
    assert.ok(!log.some(([k]) => k === 'stopRecording'), 'stopping an inactive recorder would report a failure and drop the take');
    assert.ok(log.some(([k, key]) => k === 'clear' && key === 'recording-elapsed'));
    assert.ok(log.some(([k]) => k === 'stopWaveform'));
  });

  test('the recorder stopped itself before the next tick: the stop path still says lost (real Chromium order)', () => {
    const { api, log, micViews, audio } = sandbox({ recorderState: 'inactive' });
    api.startLevel();
    audio.readyState = 'ended';
    // MediaRecorder onstop → _handleRecordedBlob → _stopWaveform → _stopRoomLevel
    api.stopLevel();
    assert.deepEqual(micViews(), [{ state: 'not_found', lost: true }]);
    assert.ok(!log.some(([k]) => k === 'stopRecording' || k === 'stopWaveform'));
  });

  test('Part 2 stopped by itself: the countdown is cleared so its end does not stop again', () => {
    const { api, log, micViews, audio } = sandbox({ state: 'p2c', sub: 'idle', recorderState: 'inactive' });
    api.startLevel();
    audio.readyState = 'ended';
    api.stopLevel();
    assert.deepEqual(micViews(), [{ state: 'not_found', lost: true }]);
    assert.ok(log.some(([k, key]) => k === 'clear' && key === 'p2-speak-countdown'));
    assert.ok(!log.some(([k]) => k === 'stopP2'));
  });

  test('a normal stop with a live track says nothing new', () => {
    const { api, micViews } = sandbox({ recorderState: 'inactive' });
    api.startLevel();
    api.stopLevel();
    assert.deepEqual(micViews(), []);
  });

  test('Part 2: the speaking countdown stops and the take goes to the Part 2 recorded path', () => {
    const { api, log, tick } = sandbox({ state: 'p2c', sub: 'idle', audio: track('ended') });
    api.startLevel();
    tick();
    assert.ok(log.some(([k, key]) => k === 'clear' && key === 'p2-speak-countdown'));
    assert.ok(log.some(([k, key]) => k === 'clear' && key === 'p2-thank-you-delay'));
    assert.deepEqual(log.filter(([k]) => k === 'stopP2'), [['stopP2']]);
  });

  test('Part 2 with a recorder that already stopped: no second stop, no later "Thank you" stop', () => {
    const { api, log, tick } = sandbox({ state: 'p2c', sub: 'idle', recorderState: 'inactive', audio: track('ended') });
    api.startLevel();
    tick();
    assert.ok(!log.some(([k]) => k === 'stopP2'));
    assert.ok(log.some(([k, key]) => k === 'clear' && key === 'p2-speak-countdown'));
  });

  test('legacy recorder stopped by itself: the P1/P3 elapsed timer is cleared too', () => {
    const { api, log, audio } = sandbox({ recorderState: 'inactive' });
    api.startLevel();
    audio.readyState = 'ended';
    api.stopLevel();
    assert.ok(log.some(([k, key]) => k === 'clear' && key === 'recording-elapsed'));
    assert.equal(api.timerId(), null);
  });

  test('an error on a later "Thử lại" keeps "Mất kết nối micro" until the mic works again', () => {
    const { api, tick, micViews } = sandbox({ audio: track('ended') });
    api.startLevel();
    tick();
    api.mic('pending');
    api.mic('busy');
    assert.deepEqual(micViews().slice(-2), [{ state: 'pending', lost: true }, { state: 'busy', lost: true }]);
    api.mic('denied');
    assert.deepEqual(micViews().at(-1), { state: 'denied', lost: true });
    api.mic('granted');
    assert.deepEqual(micViews().at(-1), { state: 'granted', lost: false });
    api.mic('busy');
    assert.deepEqual(micViews().at(-1), { state: 'busy', lost: false }, 'a later, unrelated error says nothing about a lost mic');
  });

  test('a new take clears "lost" and can report a second unplug', () => {
    const { api, tick, micViews, audio } = sandbox({ audio: track('ended') });
    api.startLevel();
    tick();
    api.mic('granted');
    assert.deepEqual(micViews().at(-1), { state: 'granted', lost: false });
    audio.readyState = 'live';
    api.startLevel();
    audio.readyState = 'ended';
    tick();
    assert.deepEqual(micViews().at(-1), { state: 'not_found', lost: true });
  });
});

test('flag off: no level tick, so nothing new happens when the track ends', () => {
  const { api, intervals, views, log } = sandbox({ on: false, audio: track('ended') });
  api.startLevel();
  assert.equal(intervals.length, 0);
  assert.deepEqual(views, []);
  assert.deepEqual(log, []);
});

// Andy's block on #2711 (79bbbef1): a Part 2 take long enough to send used to
// go straight on (Full Test: next part; practice: grading) before the learner
// could see "Mất kết nối micro", which the room only draws on the cue card.
// The real _handleP2RecordedBlob and retryP2Submission run with the room block.
function slice(from, to) {
  const a = JS.indexOf(from);
  const b = JS.indexOf(to, a + 1);
  assert.ok(a !== -1 && b > a, `practice.js slice ${from}`);
  return JS.slice(a, b);
}
const P2_RECORDED = slice('  function _handleP2RecordedBlob(blob, elapsed) {', '  async function _startP2Speaking() {');
const P2_RETRY = slice('  function retryP2Submission() {', '  function discardP2SubmissionRetry() {');

function part2({ on = true, mode = 'test_full', lost = true } = {}) {
  const log = [];
  const views = [];
  const audio = track('live');
  const recorder = { recorder: { state: 'inactive' }, stream: { getAudioTracks: () => [audio] } };
  const env = {
    navigator: {}, MediaRecorder: function () {}, window: {}, audio,
    _updateNativeView: (section, patch) => { views.push([section, patch]); return true; },
    _getNativeRecorder: () => recorder,
    _startManagedInterval: (key, fn) => key,
    _clearManagedEffect: () => true,
    stopRecording: () => true, _stopP2SpeakingInternal: () => {},
    _stopWaveform: () => {},
    _checkRecordedLength: () => false,
    _showP2SubmissionRetry: (message) => log.push(['heldOnCue', message]),
    _clearP2SubmissionRetry: () => log.push(['clearHeld']),
    _submitGradingEager: (sid, qid, blob) => log.push(['eager', qid, blob]),
    _advanceTestMode: () => log.push(['advance']),
    _startProcessing: (blob, qid) => log.push(['grade', qid, blob]),
    discardP2SubmissionRetry: () => log.push(['discard']),
    showError: (m) => log.push(['error', m]),
  };
  const api = new Function(...Object.keys(env), `
    var _examRoomMode = ${on ? 'true' : 'false'};
    var _roomMicState = 'granted', _ROOM_LEVEL_MS = 200, _roomLevelTimer = 'level', _roomMicLostDone = false, _roomMicLostShown = false;
    var _roomDialogKind = null, _roomLeaveHref = '', _roomLeaving = false, _roomConfirmed = false, _ROOM_LEAVE_RESET_MS = 4000;
    var _playerGeneration = 1, _playerActive = true, _analyser = null, _recorder = null, _stream = null;
    var _currentState = 'p2c', _recSubState = 'idle', _timerId = null, _p2SpeakTimerId = 'p2';
    var _testMode = ${JSON.stringify(mode)}, _sessionId = 'S', _currentQ = { id: 'Q2' };
    var _recordedBlob = null, _elapsedSecs = 0, _recordingDirty = false, _p2RetryQuestionId = null;
    ${ROOM}
    ${P2_RECORDED}
    ${P2_RETRY}
    return {
      // MediaRecorder onstop, after the track ended: the take arrives here.
      recorded: (blob) => { _handleP2RecordedBlob(blob, 95); },
      // What _showP2SubmissionRetry would store for the cue card's buttons.
      cueHolds: () => { _p2RetryQuestionId = 'Q2'; },
      send: () => retryP2Submission(),
      dirty: () => _recordingDirty,
      endTrack: () => { audio.readyState = 'ended'; _stopRoomLevel(); },
    };
  `)(...Object.values(env));
  if (lost) api.endTrack();
  return { api, log, views };
}

describe('Part 2: a long enough take cut by a lost microphone is shown before it is sent', () => {
  test('Full Test: held on the cue card with the warning, not sent and not moved on', () => {
    const { api, log, views } = part2();
    api.recorded('BLOB');
    assert.deepEqual(views.filter(([s]) => s === 'mic').map(([, p]) => p), [{ state: 'not_found', lost: true }]);
    assert.equal(log.length, 1);
    assert.equal(log[0][0], 'heldOnCue');
    assert.match(log[0][1], /^Mất kết nối micro/);
    assert.equal(api.dirty(), true, 'the leave box counts the held take');
  });

  test('Full Test: "Gửi lại bản ghi" sends the held take as an uncut one would go, then moves on', () => {
    const { api, log } = part2();
    api.recorded('BLOB');
    api.cueHolds();
    api.send();
    assert.deepEqual(log.slice(1), [['clearHeld'], ['eager', 'Q2', 'BLOB'], ['advance']]);
    assert.equal(api.dirty(), false);
  });

  test('practice: held on the cue card; sending it goes to grading', () => {
    const { api, log } = part2({ mode: 'practice' });
    api.recorded('BLOB');
    assert.equal(log[0][0], 'heldOnCue');
    api.cueHolds();
    api.send();
    assert.deepEqual(log.slice(1), [['grade', 'Q2', 'BLOB']]);
  });

  test('a take with a live microphone still goes straight on (unchanged)', () => {
    const { api, log } = part2({ lost: false });
    api.recorded('BLOB');
    assert.deepEqual(log, [['eager', 'Q2', 'BLOB'], ['advance']]);
  });

  test('flag off: an ended track changes nothing (unchanged)', () => {
    const { api, log } = part2({ on: false });
    api.recorded('BLOB');
    assert.deepEqual(log, [['eager', 'Q2', 'BLOB'], ['advance']]);
  });
});

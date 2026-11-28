// EXAMSPEAK-0072 FR-002, FR-003, FR-004, FR-005, FR-012 (G08-T18): practice.js
// sends the new `mic` / `recording.level` / `tooShort` view events only when the
// Next bootstrap says `examRoomMode: true`; with the flag off nothing new is
// sent and Part 2 keeps its old alert. The slices of practice.js run for real
// in a sandbox with a fake view, recorder and microphone.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const JS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'js', 'practice.js'), 'utf8');

function slice(from, to) {
  const start = JS.indexOf(from);
  const end = JS.indexOf(to, start + 1);
  assert.ok(start !== -1 && end > start, `practice.js slice ${from}`);
  return JS.slice(start, end);
}

const ROOM = slice('  // ── Exam room (EXAMSPEAK-0072)', '  function _hasUnsentWork() {');
const NATIVE_START = slice('  async function _startNativeRecording(', '  async function startRecording() {');
const P2_START = slice('  async function _startP2Speaking() {', '  function _renderP2SpeakTimer() {');
const TOO_SHORT = slice('  function _handleAudioTooShort(detail) {', '  // ── STATE: Feedback');

/** A sandbox of the room helpers plus `extra` slices; `on` is the flag. */
function sandbox({ on, navigator = {}, recorder = null, extra = '', MediaRecorder = function () {} }) {
  const views = [];
  const alerts = [];
  const errors = [];
  const intervals = [];
  const env = {
    navigator,
    MediaRecorder,
    window: { alert: (m) => alerts.push(m) },
    _updateNativeView: (section, patch) => { views.push([section, patch]); return true; },
    _getNativeRecorder: () => recorder,
    _startManagedInterval: (key, fn) => { intervals.push({ key, fn }); return key; },
    _clearManagedEffect: () => true,
    _showRecError: (m) => errors.push(m),
    showError: (m) => errors.push(`screen:${m}`),
    _handleP2RecordedBlob: () => {},
    _renderTimer: () => {},
    _startWaveform: () => {},
    _showRecSub: () => {},
    _handleRecordedBlob: () => {},
    _sheetActive: () => false,
    _clearP2SubmissionRetry: () => {},
    _resetRecorder: () => {},
    showState: () => {},
    _renderRecordedPlayback: () => {},
    _renderRecordedLengthHint: () => {},
  };
  const api = new Function(...Object.keys(env), `
    var _examRoomMode = ${on ? 'true' : 'false'};
    var _roomMicState = 'unknown';
    var _ROOM_LEVEL_MS = 200;
    var _roomLevelTimer = null, _roomMicLostDone = false, _roomMicLostShown = false, _roomWriteRight = true;
    var _playerGeneration = 1, _playerActive = true;
    var _audioChunks = [], _recordedBlob = null, _elapsedSecs = 0, _analyser = null;
    var _recorder = null, _stream = null;
    var _sessionData = { part: 2 };
    var MAX_RECORD_SEC = { 1: 90, 2: 120, 3: 90 };
    var _sheet = null;
    ${ROOM}
    ${extra}
    return {
      detect: _roomDetectMic, request: requestMicrophone, startLevel: _startRoomLevel,
      stopLevel: _stopRoomLevel, level: _roomLevel, mic: () => _roomMicState,
      setAnalyser: (a) => { _analyser = a; }, setPart: (p) => { _sessionData = { part: p }; },
      native: typeof _startNativeRecording === 'function' ? _startNativeRecording : null,
      p2Start: typeof _startP2Speaking === 'function' ? _startP2Speaking : null,
      tooShort: typeof _handleAudioTooShort === 'function' ? _handleAudioTooShort : null,
    };
  `)(...Object.values(env));
  return { api, views, alerts, errors, intervals };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
const micStates = (views) => views.filter(([s]) => s === 'mic').map(([, p]) => p.state);

function deferredMic() {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  const stopped = [];
  const navigator = { mediaDevices: { getUserMedia: () => promise } };
  return { navigator, resolve: () => resolve({ getTracks: () => [{ stop: () => stopped.push(1) }] }), reject, stopped };
}

const deniedRecorder = () => ({
  start: async () => { const e = new Error('Bạn đã từ chối quyền microphone.'); e.code = 'permission_denied'; throw e; },
  isStarting: () => false, getAnalyser: () => null, reset: () => {},
});

describe('flag off: practice.js sends nothing new', () => {
  test('every helper returns before touching the view', async () => {
    const mic = deferredMic();
    const { api, views, intervals } = sandbox({ on: false, navigator: mic.navigator });
    api.detect();
    assert.equal(await api.request(), false);
    api.setAnalyser({ fftSize: 4, getByteTimeDomainData: () => {} });
    api.startLevel();
    api.stopLevel();
    assert.deepEqual(views, []);
    assert.deepEqual(intervals, []);
  });

  test('native start emits no mic event and keeps the old error text', async () => {
    const recorder = {
      start: async () => { const e = new Error('Bạn đã từ chối quyền microphone.'); e.code = 'permission_denied'; throw e; },
      isStarting: () => false, getAnalyser: () => null, reset: () => {},
    };
    const { api, views, errors } = sandbox({ on: false, recorder, extra: NATIVE_START });
    assert.equal(await api.native(recorder), false);
    assert.deepEqual(views, []);
    assert.deepEqual(errors, ['Bạn đã từ chối quyền microphone.']);
  });

  test('Part 2 mic failure still goes to the error screen (old branch unchanged)', async () => {
    const recorder = deniedRecorder();
    const { api, views, errors } = sandbox({ on: false, recorder, extra: P2_START });
    await api.p2Start();
    assert.deepEqual(views, []);
    assert.deepEqual(errors, ['screen:Bạn đã từ chối quyền microphone.']);
  });

  test('Part 2 too short still uses the alert (old branch unchanged)', () => {
    const { api, views, alerts } = sandbox({ on: false, extra: TOO_SHORT });
    api.tooShort({ part: 2, duration_seconds: 40.2, min_seconds: 80 });
    assert.equal(alerts.length, 1);
    assert.deepEqual(views, []);
  });
});

describe('flag on: microphone cases (FR-003)', () => {
  test('no getUserMedia or MediaRecorder → unsupported', () => {
    const { api, views } = sandbox({ on: true, navigator: {}, MediaRecorder: undefined });
    api.detect();
    assert.deepEqual(micStates(views), ['unsupported']);
  });

  test('permissions granted skips the first step', async () => {
    const navigator = {
      mediaDevices: { getUserMedia: () => Promise.reject(new Error('unused')) },
      permissions: { query: async () => ({ state: 'granted' }) },
    };
    const { api, views } = sandbox({ on: true, navigator });
    api.detect();
    await flush();
    assert.deepEqual(micStates(views), ['prompt', 'granted']);
  });

  test('no navigator.permissions starts at "before asking"', () => {
    const { api, views } = sandbox({ on: true, navigator: { mediaDevices: { getUserMedia: () => {} } } });
    api.detect();
    assert.deepEqual(micStates(views), ['prompt']);
  });

  test('"Cho phép micro" shows pending BEFORE the browser answers, then granted and lets go of the device', async () => {
    const mic = deferredMic();
    const { api, views } = sandbox({ on: true, navigator: mic.navigator });
    const asked = api.request();
    assert.deepEqual(micStates(views), ['pending']);
    assert.equal(await api.request(), false, 'a second click while pending does nothing');
    mic.resolve();
    assert.equal(await asked, true);
    assert.deepEqual(micStates(views), ['pending', 'granted']);
    assert.equal(mic.stopped.length, 1);
  });

  for (const [name, state] of [
    ['NotAllowedError', 'denied'], ['PermissionDeniedError', 'denied'],
    ['NotFoundError', 'not_found'], ['DevicesNotFoundError', 'not_found'], ['NotReadableError', 'busy'],
  ]) {
    test(`${name} → ${state}`, async () => {
      const navigator = { mediaDevices: { getUserMedia: async () => { const e = new Error('x'); e.name = name; throw e; } } };
      const { api, views } = sandbox({ on: true, navigator });
      await api.request();
      assert.deepEqual(micStates(views), ['pending', state]);
    });
  }

  test('recorder start: pending first, then granted on success', async () => {
    let release;
    const recorder = {
      start: () => new Promise((resolve) => { release = resolve; }),
      isStarting: () => false, getAnalyser: () => null, reset: () => {},
    };
    const { api, views } = sandbox({ on: true, recorder, extra: NATIVE_START });
    const started = api.native(recorder);
    await flush();
    assert.deepEqual(micStates(views), ['pending']);
    release(true);
    assert.equal(await started, true);
    assert.deepEqual(micStates(views), ['pending', 'granted']);
  });

  test('recorder start: permission_denied → denied, old error text kept', async () => {
    const recorder = {
      start: async () => { const e = new Error('Bạn đã từ chối quyền microphone.'); e.code = 'permission_denied'; throw e; },
      isStarting: () => false, getAnalyser: () => null, reset: () => {},
    };
    const { api, views, errors } = sandbox({ on: true, recorder, extra: NATIVE_START });
    assert.equal(await api.native(recorder), false);
    assert.deepEqual(micStates(views), ['pending', 'denied']);
    assert.equal(errors.length, 1);
  });

  test('Part 2: a denied mic stays on the preparation screen with the recovery steps', async () => {
    const recorder = deniedRecorder();
    const { api, views, errors } = sandbox({ on: true, recorder, extra: P2_START });
    await api.p2Start();
    assert.deepEqual(micStates(views), ['pending', 'denied']);
    assert.deepEqual(errors, [], 'no error screen: the p2b mic box holds "Thử lại"');
  });

  test('Part 2: an unknown start failure keeps the old error screen', async () => {
    const recorder = {
      start: async () => { throw new Error('boom'); },
      isStarting: () => false, getAnalyser: () => null, reset: () => {},
    };
    const { api, views, errors } = sandbox({ on: true, recorder, extra: P2_START });
    await api.p2Start();
    assert.deepEqual(micStates(views), ['pending', 'unknown']);
    assert.deepEqual(errors, ['screen:boom']);
  });

  test('a cancelled start puts the mic back to "before asking"', async () => {
    const recorder = { start: async () => false, isStarting: () => true, getAnalyser: () => null, reset: () => {} };
    const { api, views } = sandbox({ on: true, recorder, extra: NATIVE_START });
    assert.equal(await api.native(recorder), false);
    assert.deepEqual(micStates(views), ['pending', 'prompt']);
  });
});

describe('flag on: recording level (FR-004)', () => {
  test('RMS of |b − 128| / 128', () => {
    const { api } = sandbox({ on: true });
    const flat = { getByteTimeDomainData: (b) => b.fill(128) };
    assert.equal(api.level(flat, new Uint8Array(8)), 0);
    const loud = { getByteTimeDomainData: (b) => { for (let i = 0; i < b.length; i++) b[i] = i % 2 ? 0 : 255; } };
    assert.ok(api.level(loud, new Uint8Array(8)) > 0.99);
    assert.equal(api.level(null, null), null);
  });

  test('ticks on an interval while recording and clears to null on stop', () => {
    const { api, views, intervals } = sandbox({ on: true });
    api.setAnalyser({ fftSize: 4, getByteTimeDomainData: (b) => b.fill(128) });
    api.startLevel();
    assert.equal(intervals[0].key, 'recording-level');
    intervals[0].fn();
    const levels = views.filter(([s, p]) => s === 'recording' && 'level' in p).map(([, p]) => p.level);
    assert.deepEqual(levels, [0, 0]);
    api.stopLevel();
    assert.deepEqual(views.at(-1), ['recording', { level: null, paused: false }]);
  });

  test('no analyser → level null (the room never reports silence)', () => {
    const { api, views } = sandbox({ on: true });
    api.startLevel();
    assert.equal(views[0][1].level, null);
  });

  test('muted track → paused', () => {
    const recorder = { recorder: { state: 'recording' }, stream: { getAudioTracks: () => [{ muted: true }] } };
    const { api, views } = sandbox({ on: true, recorder });
    api.startLevel();
    assert.equal(views[0][1].paused, true);
  });
});

describe('flag on: too short in words (FR-005, FR-012)', () => {
  test('Part 2: no alert; the reason data goes to part2 with the server minimum', () => {
    const { api, views, alerts } = sandbox({ on: true, extra: TOO_SHORT });
    api.tooShort({ part: 2, duration_seconds: 40.2, min_seconds: 80 });
    assert.equal(alerts.length, 0);
    assert.deepEqual(views, [['part2', { tooShort: { part: 2, durationSeconds: 40.2, minSeconds: 80 } }]]);
  });

  test('Part 1: the reason replaces the old error banner', () => {
    const { api, views, errors } = sandbox({ on: true, extra: TOO_SHORT });
    api.setPart(1);
    api.tooShort({ part: 1, duration_seconds: 12, min_seconds: 15 });
    assert.deepEqual(errors, []);
    assert.deepEqual(views, [['recording', { tooShort: { part: 1, durationSeconds: 12, minSeconds: 15 } }]]);
  });
});

describe('the flag is decided in one place (FR-002)', () => {
  test('practice.js reads only bootstrap.examRoomMode, from the Next bootstrap', () => {
    assert.match(JS, /_examRoomMode = bootstrap\.examRoomMode === true;/);
    assert.doesNotMatch(JS, /__AVER_RUNTIME_CONFIG__/);
    assert.doesNotMatch(JS, /exam_room/);
    assert.equal((JS.match(/_examRoomMode = /g) || []).length, 3, 'declared off, reset in init, set from the bootstrap');
  });

  test('the boot passes examRoomEnabled("speaking") once', () => {
    const boot = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'app', '(authed-practice)', 'practice', 'session', 'practice-session-boot.tsx'), 'utf8');
    assert.equal((boot.match(/examRoomEnabled\(/g) || []).length, 1);
    assert.match(boot, /examRoomMode,/);
  });
});

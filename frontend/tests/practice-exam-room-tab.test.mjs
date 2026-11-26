// EXAMSPEAK-0072 edge case "Hai tab cùng phiên" (R149, G08-T19c): the room
// holds the EXAMROOM-0066 FR-017 lock and tells practice.js whether this tab
// may write. A read-only tab opens no microphone and uploads nothing; the
// hand-over flush is "secured" only with nothing recording, unsent or
// uploading, because takes live only in page memory (FR-009). The room helpers
// of practice.js run for real in a sandbox.
import { JSDOM } from 'jsdom';
import { installPracticePlayerController } from '../lib/practice-player-lifecycle.mjs';
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

function sandbox({ on = true, sub = 'idle', dirty = false, slots = null, fullTest = null, unsent = false, state = 'prep', p2Retry = null } = {}) {
  const env = {
    navigator: {},
    MediaRecorder: function () {},
    window: fullTest ? { PracticeFullTest: { getSnapshot: () => fullTest } } : {},
    _updateNativeView: () => true,
    _getNativeRecorder: () => null,
    _startManagedInterval: () => 1,
    _clearManagedEffect: () => true,
    _hasUnsentWork: () => unsent,
  };
  return new Function(...Object.keys(env), `
    var _examRoomMode = ${on ? 'true' : 'false'};
    var _roomMicState = 'granted', _ROOM_LEVEL_MS = 200, _roomLevelTimer = null, _roomMicLostDone = false, _roomMicLostShown = false;
    var _roomWriteRight = true, _roomResumeCompletionPending = false;
    var _roomDialogKind = null, _roomLeaveHref = '', _roomLeaving = false, _roomConfirmed = false, _ROOM_LEAVE_RESET_MS = 4000;
    var _playerGeneration = 1, _playerActive = true, _analyser = null, _recorder = null, _stream = null;
    var _p2RetryQuestionId = ${JSON.stringify(p2Retry)};
    var _currentState = ${JSON.stringify(state)}, _recSubState = ${JSON.stringify(sub)}, _recordingDirty = ${dirty ? 'true' : 'false'};
    var _sheet = ${slots ? JSON.stringify({ slots }) : 'null'};
    var _timerId = null, _p2SpeakTimerId = null;
    ${ROOM}
    return { setWriteRight: setWriteRight, readOnly: _roomReadOnly, flush: roomFlush, starting: _roomStarting, startLost: _roomStartLost };
  `)(...Object.values(env));
}

describe('flag on: the write right', () => {
  test('a tab writes until the room says another tab holds the right', () => {
    const api = sandbox();
    assert.equal(api.readOnly(), false);
    api.setWriteRight(false);
    assert.equal(api.readOnly(), true);
    api.setWriteRight(true);
    assert.equal(api.readOnly(), false);
  });
});

test('fully answered test_part resumes once the tab can write', async (t) => {
  const dom = new JSDOM('', { url: 'https://example.test/practice/session', runScripts: 'outside-only' });
  const browser = dom.window;
  const calls = [];
  browser.fetch = async () => ({ ok: false });
  browser.api = { patch: async (url) => { calls.push(url); } };
  const player = installPracticePlayerController(browser);
  t.after(() => {
    player.cleanup();
    dom.window.close();
  });
  browser.eval(JS);
  const sessionId = 'answered-session';
  await browser.PracticeApp.init({
    source: 'next-native-bootstrap-v1', rendererAffinity: 'next', examRoomMode: true,
    sessionId, sessionData: { mode: 'test_part', part: 1, responses: [{ question_id: 'q1' }] },
    questions: [{ id: 'q1' }], navigate: (url) => calls.push(url),
  });
  browser.PracticeApp.setWriteRight(false);
  assert.deepEqual(calls, []);
  browser.PracticeApp.setWriteRight(true);
  browser.PracticeApp.setWriteRight(true);
  assert.deepEqual(calls, ['/sessions/answered-session/complete', '/result?id=answered-session']);
});

describe('flag on: the hand-over flush', () => {
  test('nothing recording, unsent or uploading: secured, so the other tab may take over', async () => {
    assert.deepEqual(await sandbox().flush(), { secured: true, unsaved: 0 });
    assert.deepEqual(await sandbox({ slots: [{ state: 'graded' }, { state: 'idle' }] }).flush(), { secured: true, unsaved: 0 });
  });

  test('a take recording or not yet sent is never secured (it lives only in this page)', async () => {
    assert.deepEqual(await sandbox({ sub: 'recording' }).flush(), { secured: false, unsaved: 1 });
    assert.deepEqual(await sandbox({ dirty: true }).flush(), { secured: false, unsaved: 1 });
  });

  test('answer sheet: a take recording, uploading or waiting for a retry counts once each', async () => {
    const result = await sandbox({ slots: [{ state: 'recording' }, { state: 'grading' }, { state: 'failed', retryBlob: {} }, { state: 'graded' }] }).flush();
    assert.deepEqual(result, { secured: false, unsaved: 3 });
  });

  test('Full Test answers still uploading or waiting for a retry refuse the hand-over', async () => {
    assert.deepEqual(await sandbox({ fullTest: { pendingCount: 1, retryCount: 1 } }).flush(), { secured: false, unsaved: 2 });
  });

  test('Part 2 speaking, any take uploading, or a Part 2 take kept for a retry refuses (CR #2649 Codex P2)', async () => {
    assert.deepEqual(await sandbox({ state: 'p2c' }).flush(), { secured: false, unsaved: 1 });
    assert.deepEqual(await sandbox({ state: 'processing' }).flush(), { secured: false, unsaved: 1 });
    assert.deepEqual(await sandbox({ state: 'p2a', p2Retry: 'q-2' }).flush(), { secured: false, unsaved: 1 });
    assert.deepEqual(await sandbox({ state: 'p2a' }).flush(), { secured: true, unsaved: 0 });
  });

  test('a recorder still starting (microphone box open) refuses until the start settles (CR #2649)', async () => {
    const api = sandbox({ state: 'p2b' });
    let grant;
    const start = api.starting(() => new Promise((resolve) => { grant = resolve; }));
    assert.deepEqual(await api.flush(), { secured: false, unsaved: 1 });
    grant(true);
    assert.equal(await start, true);
    assert.deepEqual(await api.flush(), { secured: true, unsaved: 0 });
  });

  test('a start that fails still lets the hand-over go once it settles', async () => {
    const api = sandbox();
    await assert.rejects(api.starting(() => Promise.reject(new Error('NotAllowedError'))));
    await assert.rejects(api.starting(() => { throw new Error('sync'); }));
    assert.deepEqual(await api.flush(), { secured: true, unsaved: 0 });
  });

  test('a start that settles after the write right moved drops the microphone', () => {
    const api = sandbox();
    const recorder = { released: 0, release() { this.released += 1; } };
    assert.equal(api.startLost(recorder), false);
    api.setWriteRight(false);
    assert.equal(api.startLost(recorder), true);
    assert.equal(recorder.released, 1);
  });

  test('any other unsent work the leave guard knows about refuses too', async () => {
    assert.deepEqual(await sandbox({ unsent: true }).flush(), { secured: false, unsaved: 1 });
  });
});

test('flag off: the write right never changes, every tab writes as before', () => {
  const api = sandbox({ on: false });
  api.setWriteRight(false);
  assert.equal(api.readOnly(), false);
});

describe('every way to open the microphone or upload is closed to a read-only tab', () => {
  const guarded = [
    'async function requestMicrophone() {',
    'async function startRecording() {',
    'function submitRecording() {',
    'function retryP2Submission() {',
    'function startP2Prep() {',
    'async function _startP2Speaking() {',
    'function retryFullTestSubmissions() {',
    'function _sheetRetrySubmission(i) {',
    // Completing the session (CR #2649): "Nộp bài", "Hoàn thành", Full Test results.
    'async function _sheetSubmit() {',
    'async function finishSession() {',
    'function _finishTestAndShowResults() {',
  ];
  for (const head of guarded) {
    test(head, () => {
      const at = JS.indexOf(head);
      assert.ok(at !== -1, `${head} exists`);
      const body = JS.slice(at, at + 400);
      assert.match(body, /if \(_roomReadOnly\(\)\) return/, `${head} returns early when read-only`);
    });
  }

  test('answer sheet: a read-only tab may only stop the take it is recording', () => {
    const at = JS.indexOf('function _sheetToggleRec(');
    assert.ok(at !== -1);
    assert.match(JS.slice(at, at + 400), /if \(_roomReadOnly\(\) && _sheet\.recIdx !== i\) return;/);
  });

  test('a take recorded while this tab wrote is still delivered (no guard on the delivery path)', () => {
    const at = JS.indexOf('function _sheetSubmitBlob(');
    assert.ok(at !== -1);
    assert.doesNotMatch(JS.slice(at, at + 200), /_roomReadOnly/);
  });

  test('every recorder start waits through the room and checks the write right after it (CR #2649)', () => {
    assert.doesNotMatch(JS, /await nativeRecorder\.start\(/, 'native starts go through _roomStarting');
    assert.doesNotMatch(JS, /await navigator\.mediaDevices\.getUserMedia\(/, 'getUserMedia goes through _roomStarting');
    assert.equal((JS.match(/await _roomStarting\(/g) || []).length, 6);
    for (const head of ['async function _startNativeRecording(', 'async function startRecording() {', 'async function _startP2Speaking() {']) {
      const at = JS.indexOf(head);
      const next = JS.indexOf('\n  function ', at + head.length);
      const nextAsync = JS.indexOf('\n  async function ', at + head.length);
      const body = JS.slice(at, Math.min(...[next, nextAsync].filter((n) => n > 0)));
      assert.match(body, /_roomStartLost\(/, `${head} drops the microphone when the right moved`);
    }
  });

  test('practice.js exports the two calls the room makes', () => {
    assert.match(JS, /setWriteRight:\s+setWriteRight,/);
    assert.match(JS, /roomFlush:\s+roomFlush,/);
  });
});

describe('tab B presses "Nộp bài" while tab A still has an unsent take (CR #2649)', () => {
  const at = JS.indexOf('  async function _sheetSubmit() {');
  const stop = JS.indexOf('\n  function nextQuestion() {', at);
  assert.ok(at !== -1 && stop > at);
  const SUBMIT = JS.slice(at, stop);

  function submitSandbox({ writeRight }) {
    const calls = [];
    const env = {
      window: {},
      $: () => null,
      _updateNativeView: () => true,
      _roomDialog: (kind, n) => calls.push(['dialog', kind, n]),
      _releaseRecorderResources: () => calls.push(['release']),
      _completeSpeakingSession: async (id) => { calls.push(['complete', id]); },
      _roomExpired: () => false,
      _navigateTo: (url) => calls.push(['navigate', url]),
      _singleSessionResultUrl: (id) => `/speaking/result?session_id=${id}`,
    };
    const run = new Function(...Object.keys(env), `
      var _examRoomMode = true, _roomWriteRight = ${writeRight ? 'true' : 'false'}, _roomConfirmed = false;
      var _roomSignedOut = false;
      var _sheetSubmitting = false, _playerGeneration = 1, _playerActive = true, _sessionId = 's-1';
      function _roomUnsentCount() { return 0; }
      // Tab B's own sheet: the failed re-record lives only in tab A's memory.
      var _sheet = { slots: [{ state: 'graded' }, { state: 'graded' }] };
      function _roomReadOnly() { return _examRoomMode && _roomWriteRight === false; }
      function _roomAwaitCompletion(promise) { return promise; }
      ${SUBMIT}
      return _sheetSubmit;
    `)(...Object.values(env));
    return { run, calls };
  }

  test('read-only tab B: nothing is completed, nothing is released, no navigation', async () => {
    const { run, calls } = submitSandbox({ writeRight: false });
    await run();
    assert.deepEqual(calls, []);
  });

  test('control: the writing tab completes the session as before', async () => {
    const { run, calls } = submitSandbox({ writeRight: true });
    await run();
    assert.deepEqual(calls.map(([k]) => k), ['release', 'complete', 'navigate']);
  });
});

// Andy's block on #2712 (93347421): tab A pressed "Nộp bài" and waits for the
// server; tab B asks for the right in that window. The real _sheetSubmit and the
// real room block (roomFlush) run together.
describe('a "Nộp bài" still waiting keeps the right in tab A', () => {
  const at = JS.indexOf('  async function _sheetSubmit() {');
  const stop = JS.indexOf('\n  function nextQuestion() {', at);
  const SUBMIT = JS.slice(at, stop);

  function pendingSubmit({ on = true } = {}) {
    let answer;
    const calls = [];
    const env = {
      navigator: {}, MediaRecorder: function () {}, window: {}, $: () => null,
      _updateNativeView: () => true, _getNativeRecorder: () => null,
      _startManagedInterval: () => 1, _clearManagedEffect: () => true,
      _hasUnsentWork: () => false,
      _releaseRecorderResources: () => calls.push('release'),
      _completeSpeakingSession: () => new Promise((resolve, reject) => { answer = { resolve, reject }; }),
      _navigateTo: (url) => calls.push(`navigate ${url}`),
      _singleSessionResultUrl: (id) => `/speaking/result?session_id=${id}`,
    };
    const api = new Function(...Object.keys(env), `
      var _examRoomMode = ${on ? 'true' : 'false'};
      var _roomMicState = 'granted', _ROOM_LEVEL_MS = 200, _roomLevelTimer = null, _roomMicLostDone = false, _roomMicLostShown = false;
      var _roomWriteRight = true, _roomResumeCompletionPending = false;
      var _roomDialogKind = null, _roomLeaveHref = '', _roomLeaving = false, _roomConfirmed = false, _ROOM_LEAVE_RESET_MS = 4000;
      var _playerGeneration = 1, _playerActive = true, _analyser = null, _recorder = null, _stream = null;
      var _p2RetryQuestionId = null, _currentState = 'sheet', _recSubState = 'idle', _recordingDirty = false;
      var _sheet = { slots: [{ state: 'graded' }, { state: 'graded' }] };
      var _timerId = null, _p2SpeakTimerId = null;
      var _sheetSubmitting = false, _sessionId = 's-1';
      ${ROOM}
      ${SUBMIT}
      return { submit: _sheetSubmit, flush: roomFlush };
    `)(...Object.values(env));
    return { api, calls, answer: () => answer };
  }
  const tick = () => new Promise((resolve) => setImmediate(resolve));

  test('while the server has not answered, tab A refuses to hand over', async () => {
    const { api, answer } = pendingSubmit();
    assert.deepEqual(await api.flush(), { secured: true, unsaved: 0 }, 'before Nộp: nothing pending');
    const submitting = api.submit();
    await tick();
    assert.deepEqual(await api.flush(), { secured: false, unsaved: 1 }, 'tab B must not reload into a session that is closing');
    answer().resolve({});
    await submitting;
    assert.deepEqual(await api.flush(), { secured: true, unsaved: 0 }, 'after the answer the right can move');
  });

  test('a failed Nộp also gives the right back once it is known', async () => {
    const { api, answer } = pendingSubmit();
    const submitting = api.submit();
    await tick();
    assert.equal((await api.flush()).secured, false);
    answer().reject(new Error('503'));
    await submitting;
    assert.deepEqual(await api.flush(), { secured: true, unsaved: 0 });
  });

  test('finishSession waits through the same guard', () => {
    const from = JS.indexOf('  async function finishSession(');
    const fin = JS.slice(from, JS.indexOf('\n  }\n', from));
    assert.match(fin, /await _roomAwaitCompletion\(_completeSpeakingSession\(sessionId\)\)/);
  });
});

test('boot: with the room on, nothing records or sends until the tab lock answers (CR #2649)', () => {
  const at = JS.indexOf('_examRoomMode = bootstrap.examRoomMode === true;');
  assert.ok(at !== -1);
  assert.match(JS.slice(at, at + 400), /_roomWriteRight = !_examRoomMode;/);
});

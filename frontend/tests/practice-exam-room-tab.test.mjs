// EXAMSPEAK-0072 edge case "Hai tab cùng phiên" (R149, G08-T19c): the room
// holds the EXAMROOM-0066 FR-017 lock and tells practice.js whether this tab
// may write. A read-only tab opens no microphone and uploads nothing; the
// hand-over flush is "secured" only with nothing recording, unsent or
// uploading, because takes live only in page memory (FR-009). The room helpers
// of practice.js run for real in a sandbox.
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

function sandbox({ on = true, sub = 'idle', dirty = false, slots = null, fullTest = null, unsent = false } = {}) {
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
    var _roomWriteRight = true;
    var _roomDialogKind = null, _roomLeaveHref = '', _roomLeaving = false, _roomConfirmed = false, _ROOM_LEAVE_RESET_MS = 4000;
    var _playerGeneration = 1, _playerActive = true, _analyser = null, _recorder = null, _stream = null;
    var _currentState = 'prep', _recSubState = ${JSON.stringify(sub)}, _recordingDirty = ${dirty ? 'true' : 'false'};
    var _sheet = ${slots ? JSON.stringify({ slots }) : 'null'};
    var _timerId = null, _p2SpeakTimerId = null;
    ${ROOM}
    return { setWriteRight: setWriteRight, readOnly: _roomReadOnly, flush: roomFlush };
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
  ];
  for (const head of guarded) {
    test(head, () => {
      const at = JS.indexOf(head);
      assert.ok(at !== -1, `${head} exists`);
      const body = JS.slice(at, at + 220);
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

  test('practice.js exports the two calls the room makes', () => {
    assert.match(JS, /setWriteRight:\s+setWriteRight,/);
    assert.match(JS, /roomFlush:\s+roomFlush,/);
  });
});

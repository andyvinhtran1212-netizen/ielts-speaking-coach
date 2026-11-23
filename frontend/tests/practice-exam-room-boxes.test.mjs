// EXAMSPEAK-0072 FR-006, FR-007, FR-008, FR-010, FR-012 (G08-T19): with the
// exam room on, practice.js asks in the page (`view.dialog`) before dropping a
// take, leaving with unsent work or submitting over failed re-records, and keeps
// a 401 in the page. With the flag off every path is the old one, confirm and
// all. The slices of practice.js run for real in a sandbox.
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
const LEAVE = slice('  function _hasUnsentWork() {', '  function _startManagedInterval(');
const RESET = slice('  function resetRecording() {', '  function _resetRecorder() {');
const P2_DISCARD = slice('  function discardP2SubmissionRetry() {', '  function startP2Prep() {');
const SUBMIT = slice('  async function _sheetSubmit() {', '  function nextQuestion() {');
const COMPLETE = slice('  async function _completeSpeakingSession(sessionId) {', '  function _normalizeSubmissionResult(');

function sandbox({ on, blob = null, slots = null, complete = async () => ({}), native = null, confirm = () => true }) {
  const log = [];
  const views = [];
  const env = {
    navigator: {},
    MediaRecorder: function () {},
    window: { confirm: (m) => { log.push(['confirm', m]); return confirm(); }, location: { assign: (u) => log.push(['assign', u]) } },
    _updateNativeView: (section, patch) => { views.push([section, patch]); return true; },
    _getNativeRecorder: () => null,
    _getNativeSubmission: () => native,
    _startManagedInterval: () => 'id',
    _clearManagedEffect: () => true,
    _resetRecorder: () => log.push(['reset']),
    _clearRecError: () => {},
    _showRecSub: (s) => log.push(['sub', s]),
    _clearP2SubmissionRetry: () => log.push(['p2-clear']),
    _showP2Cue: () => log.push(['p2-cue']),
    _releaseRecorderResources: () => log.push(['release']),
    _navigateTo: (u) => log.push(['navigate', u]),
    _sheetRetrySubmission: (i) => log.push(['retry', i]),
    _completeSpeakingSession: (id) => { log.push(['complete', id]); return complete(id); },
    _singleSessionResultUrl: (id) => `/result?id=${id}`,
    $: () => null,
  };
  const api = new Function(...Object.keys(env), `
    var _examRoomMode = ${on ? 'true' : 'false'};
    var _roomMicState = 'unknown', _ROOM_LEVEL_MS = 200, _roomLevelTimer = null;
    var _roomDialogKind = null, _roomLeaveHref = '', _roomLeaving = false, _roomConfirmed = false;
    var _playerGeneration = 1, _playerActive = true, _sessionId = 'sess';
    var _navigate = function () {};
    var _recSubState = 'idle', _recordingDirty = false;
    var _recordedBlob = ${blob ? 'new Object()' : 'null'};
    var _sheet = ${slots ? JSON.stringify({ slots }) : 'null'};
    var _sheetSubmitting = false;
    ${ROOM}
    ${LEAVE}
    ${RESET}
    ${P2_DISCARD}
    ${SUBMIT}
    return {
      resetRecording, discardP2SubmissionRetry, confirmRerecord, requestLeave, confirmLeave,
      leaveConfirmed, confirmSubmitWithUnsent, canLeave: _canLeave, hasUnsent: _hasUnsentWork,
      submit: _sheetSubmit, expired: _roomExpired,
      dirty: (v) => { _recordingDirty = v; },
    };
  `)(...Object.values(env));
  const dialogs = () => views.filter(([s]) => s === 'dialog').map(([, p]) => p);
  return { api, log, views, dialogs };
}

const failedRerecord = [{ state: 'saved', retryBlob: {}, retryHadWork: 'saved' }, { state: 'saved', retryBlob: null }];

describe('flag off: every path is the old one', () => {
  test('"Ghi lại" drops the take at once and draws no box', () => {
    const { api, log, views } = sandbox({ on: false, blob: true });
    api.resetRecording();
    assert.deepEqual(log, [['reset'], ['sub', 'idle']]);
    assert.deepEqual(views, []);
  });

  test('leaving with unsent work still asks window.confirm', () => {
    const { api, log, views } = sandbox({ on: false });
    api.dirty(true);
    assert.equal(api.canLeave('/speaking'), true);
    assert.equal(log[0][0], 'confirm');
    assert.deepEqual(views, []);
    assert.equal(api.requestLeave('/speaking'), true, 'room commands do nothing');
    assert.equal(api.confirmLeave(true, '/x'), false);
  });

  test('submit over a failed re-record still asks window.confirm', async () => {
    const { api, log, views } = sandbox({ on: false, slots: failedRerecord });
    await api.submit();
    assert.equal(log[0][0], 'confirm');
    assert.deepEqual(log.slice(1), [['release'], ['complete', 'sess'], ['navigate', '/result?id=sess']]);
    assert.ok(!views.some(([s]) => s === 'dialog'));
  });

  test('complete is called exactly as before (no options)', async () => {
    const calls = [];
    const native = { submit() {}, destroy() {}, complete: (...args) => { calls.push(args); return 'ok'; } };
    const run = (on) => new Function('_getNativeSubmission', 'window', `var _examRoomMode = ${on}; ${COMPLETE}; return _completeSpeakingSession;`)(() => native, {});
    await run(false)('s1');
    await run(true)('s2');
    assert.deepEqual(calls, [['s1'], ['s2', { noRedirect: true }]]);
  });
});

describe('flag on: "Ghi lại" asks first (FR-006)', () => {
  test('an unsent take opens the box and keeps the take', () => {
    const { api, log, dialogs } = sandbox({ on: true, blob: true });
    api.resetRecording();
    assert.deepEqual(log, []);
    assert.deepEqual(dialogs(), [{ kind: 'rerecord', unsent: 1 }]);
    api.confirmRerecord(false);
    assert.deepEqual(log, [], '"Giữ bản ghi" keeps it');
    assert.deepEqual(dialogs().at(-1), { kind: null, unsent: 0 });
  });

  test('"Xoá và ghi lại" drops it once', () => {
    const { api, log } = sandbox({ on: true, blob: true });
    api.resetRecording();
    api.confirmRerecord(true);
    assert.deepEqual(log, [['reset'], ['sub', 'idle']]);
  });

  test('no take: no box', () => {
    const { api, log, dialogs } = sandbox({ on: true, blob: false });
    api.resetRecording();
    assert.deepEqual(dialogs(), []);
    assert.deepEqual(log, [['reset'], ['sub', 'idle']]);
  });

  test('Part 2 "Ghi lại" on a failed send asks the same way', () => {
    const { api, log, dialogs } = sandbox({ on: true, blob: true });
    api.discardP2SubmissionRetry();
    assert.deepEqual(dialogs(), [{ kind: 'rerecord-part2', unsent: 1 }]);
    api.confirmRerecord(true);
    assert.deepEqual(log, [['p2-clear'], ['reset'], ['p2-cue']]);
  });
});

describe('flag on: leaving (FR-007, FR-012)', () => {
  test('a link with unsent work opens the box; never window.confirm', () => {
    const { api, log, dialogs } = sandbox({ on: true });
    api.dirty(true);
    assert.equal(api.canLeave('/speaking'), false);
    assert.deepEqual(dialogs(), [{ kind: 'leave', unsent: 1 }]);
    assert.ok(!log.some(([k]) => k === 'confirm'));
  });

  test('"Ở lại" keeps the page and the take', () => {
    const { api, log } = sandbox({ on: true });
    api.dirty(true);
    api.requestLeave('/speaking');
    assert.equal(api.confirmLeave(false), false);
    assert.deepEqual(log, []);
    assert.equal(api.hasUnsent(), true);
  });

  test('"Bỏ bản ghi và thoát" navigates by code to where the learner was going', () => {
    const { api, log } = sandbox({ on: true });
    api.dirty(true);
    api.requestLeave('/speaking?tab=1');
    assert.equal(api.confirmLeave(true), true);
    assert.deepEqual(log, [['release'], ['navigate', '/speaking?tab=1']]);
    assert.equal(api.hasUnsent(), false, 'no browser beforeunload prompt after the choice');
    assert.equal(api.leaveConfirmed(), true);
  });

  test('"‹ Thoát" (no place) drops the takes and leaves the navigation to the bar', () => {
    const { api, log } = sandbox({ on: true });
    api.dirty(true);
    api.confirmLeave(true);
    assert.deepEqual(log, [['release']]);
  });

  test('nothing unsent: leave at once', () => {
    const { api, dialogs } = sandbox({ on: true });
    assert.equal(api.canLeave('/speaking'), true);
    assert.equal(api.requestLeave('/speaking'), true);
    assert.deepEqual(dialogs(), []);
  });
});

describe('flag on: submit with failed re-records (FR-008)', () => {
  test('Nộp opens the box with the count, and nothing is completed yet', async () => {
    const { api, log, dialogs } = sandbox({ on: true, slots: failedRerecord });
    await api.submit();
    assert.deepEqual(dialogs(), [{ kind: 'submit', unsent: 1 }]);
    assert.deepEqual(log, []);
  });

  test('"Gửi lại bản ghi" re-sends each unsent slot', async () => {
    const { api, log } = sandbox({ on: true, slots: failedRerecord });
    await api.submit();
    api.confirmSubmitWithUnsent('retry');
    assert.deepEqual(log, [['retry', 0]]);
  });

  test('"Vẫn nộp" completes with the saved answers', async () => {
    const { api, log } = sandbox({ on: true, slots: failedRerecord });
    await api.submit();
    await api.confirmSubmitWithUnsent('submit');
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(log, [['release'], ['complete', 'sess'], ['navigate', '/result?id=sess']]);
  });

  test('closing the box submits nothing', async () => {
    const { api, log } = sandbox({ on: true, slots: failedRerecord });
    await api.submit();
    api.confirmSubmitWithUnsent(false);
    assert.deepEqual(log, []);
  });
});

describe('flag on: 401 stays in the page (FR-010)', () => {
  test('complete answers 401: the sign-in box opens, nothing navigates', async () => {
    const complete = async () => { const e = new Error('x'); e.status = 401; throw e; };
    const { api, log, dialogs } = sandbox({ on: true, slots: [{ state: 'saved', retryBlob: null }], complete });
    await api.submit();
    assert.deepEqual(dialogs(), [{ kind: 'expired', unsent: 0 }]);
    assert.ok(!log.some(([k]) => k === 'navigate' || k === 'assign'));
  });

  test('upload auth_required with an unsent take counts it; signing in on this tab is the learner\'s choice', () => {
    const { api, log, dialogs } = sandbox({ on: true });
    api.dirty(true);
    assert.equal(api.expired({ code: 'auth_required' }), true);
    assert.deepEqual(dialogs(), [{ kind: 'expired', unsent: 1 }]);
    api.confirmLeave(true, '/login?next=%2Fpractice%2Fsession');
    assert.deepEqual(log, [['release'], ['assign', '/login?next=%2Fpractice%2Fsession']]);
  });

  test('other errors do not open it; flag off never does', () => {
    assert.equal(sandbox({ on: true }).api.expired({ status: 500 }), false);
    assert.equal(sandbox({ on: false }).api.expired({ status: 401 }), false);
  });
});

test('no window.confirm, alert or prompt is reached in the room branch of these paths (FR-012)', () => {
  // The only confirm calls left are behind `_examRoomMode` being false.
  for (const [name, body] of [['_canLeave', LEAVE], ['_sheetSubmit', SUBMIT]]) {
    const at = body.indexOf('window.confirm(');
    const guard = name === '_canLeave' ? 'if (_examRoomMode) return requestLeave(href);' : 'if (unsent && !_examRoomMode) {';
    assert.ok(body.indexOf(guard) !== -1 && body.indexOf(guard) < at, `${name}: confirm only after the room guard`);
  }
});

test('the full-test bridge lets the room\'s "leave" choice through without a browser prompt (FR-007)', () => {
  const bridge = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'app', '(authed-practice)', 'practice', 'session', 'practice-full-test-bridge.tsx'), 'utf8');
  const guard = bridge.indexOf('const warnBeforeUnload');
  assert.ok(guard !== -1);
  assert.match(bridge.slice(guard, guard + 400), /PracticeApp\?\.leaveConfirmed\?\.\(\) === true\) return;/);
});

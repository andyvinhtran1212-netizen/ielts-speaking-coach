/**
 * `startRecording()` phải NÓI ĐƯỢC nó có bắt đầu ghi hay không.
 *
 * Hàm này xử lý lỗi micro bên trong rồi `return false`, nên caller không thể
 * dùng `try/catch` để phân biệt. Phiếu làm bài (`_sheetToggleRec`) hoàn toàn
 * dựa vào giá trị trả về:
 *
 *     ok = await startRecording();
 *     if (!ok) → "Không ghi âm được. Kiểm tra quyền dùng micro rồi thử lại."
 *
 * PR #918 để `return true` rơi nhầm vào `_renderTimer()`, nên đường THÀNH CÔNG
 * trả `undefined` — học viên bị báo lỗi micro ở MỌI lần ghi, dù micro đã mở và
 * máy đang ghi thật. Ghim chữ không bắt được lỗi ấy: chữ vẫn nằm trong tệp,
 * chỉ là trong hàm khác. Nên phép kiểm dưới đây CHẠY hàm với micro giả.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SpeakingRecorderController } from '../lib/speaking-recorder-controller.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const JS = readFileSync(join(HERE, '..', 'public', 'js', 'practice.js'), 'utf8');

/** Chạy THẬT startRecording với micro giả. `mic` quyết định getUserMedia làm gì. */
async function run(mic, native = false, cancelPending = false, concurrentPending = false) {
  const start = JS.indexOf('  function _getNativeRecorder() {');
  const end = JS.indexOf('  // ── Recording: stop ─');
  assert.ok(start !== -1 && end > start, 'không tìm thấy khối startRecording');

  const shown = [];
  const states = [];
  const track = { stopCount: 0, stop() { this.stopCount += 1; } };
  const stream = { active: true, getTracks: () => [track] };
  let resolveMedia;
  const navigator = {
    mediaDevices: {
      getUserMedia: async () => {
        if (cancelPending || concurrentPending) {
          return new Promise((resolve) => { resolveMedia = resolve; });
        }
        if (mic) throw mic;
        return stream;
      },
    },
  };
  class MediaRecorder {
    static isTypeSupported() { return true; }
    constructor() { this.mimeType = 'audio/webm'; this.state = 'inactive'; }
    start() { this.state = 'recording'; }
  }
  const browserWindow = { AudioContext: function () { throw new Error('no audio ctx'); } };
  const env = {
    navigator, MediaRecorder,
    window: browserWindow,
    $: () => null,
    _showRecError: (m) => shown.push(m),
    _clearRecError: () => {},
    _stopAITts: () => {},
    _cancelSpeech: () => {},
    _showRecSub: (state) => states.push(state),
    _startWaveform: () => {},
    _renderTimer: () => {},
    _renderRecordedPlayback: () => {},
    _renderRecordedLengthHint: () => {},
    _updateNativeView: () => false,
    _sheetActive: () => cancelPending,
    _sheet: { recIdx: -1 },
    _sheetOnRecorded: () => {},
    stopRecording: () => {},
    _startManagedInterval: () => 1,
    _clearManagedEffect: () => true,
    _playerGeneration: 1,
    _playerActive: true,
    MAX_RECORD_SEC: { 1: 90 },
  };
  if (native) {
    browserWindow.PracticeRecorder = new SpeakingRecorderController({
      mediaDevices: navigator.mediaDevices,
      MediaRecorderCtor: MediaRecorder,
      AudioContextCtor: browserWindow.AudioContext,
      BlobCtor: Blob,
      setIntervalFn: () => 1,
      clearIntervalFn: () => {},
    });
  }
  const names = Object.keys(env);
  const fn = new Function(...names, `
    var _recSubState = 'idle', _stream = null, _recorder = null, _analyser = null;
    var _audioCtx = null, _audioChunks = [], _recordedBlob = null;
    var _timerId = null, _elapsedSecs = 0, _sessionData = { part: 1 };
    ${JS.slice(start, end)}
    return startRecording;
  `);
  const startRecordingForTest = fn(...names.map((n) => env[n]));
  const pending = startRecordingForTest();
  if (concurrentPending) {
    const second = await startRecordingForTest();
    resolveMedia(stream);
    return { ok: await pending, second, shown, states, track };
  }
  if (cancelPending) {
    browserWindow.PracticeRecorder.reset();
    resolveMedia(stream);
  }
  return { ok: await pending, shown, states, track };
}

describe('startRecording báo đúng thành công / thất bại', () => {
  test('micro mở được → trả về giá trị THẬT (truthy), không phải undefined', async () => {
    const { ok, shown } = await run(null);
    assert.deepEqual(shown, [], 'đường thành công không được hiện lỗi nào');
    assert.equal(ok, true,
      `phiếu làm bài đọc giá trị này; ${JSON.stringify(ok)} bị coi là hỏng micro`);
  });

  test('native controller mở được micro → practice.js cũng trả true', async () => {
    const { ok, shown } = await run(null, true);
    assert.equal(ok, true);
    assert.deepEqual(shown, []);
  });

  test('native controller từ chối quyền → false và hiện đúng lời nhắc', async () => {
    const err = new Error('denied'); err.name = 'NotAllowedError';
    const { ok, shown } = await run(err, true);
    assert.equal(ok, false);
    assert.match(shown[0] || '', /từ chối quyền microphone/);
  });

  test('native start bị huỷ khi đang xin quyền → im lặng và không bật trạng thái ghi', async () => {
    const { ok, shown, states, track } = await run(null, true, true);
    assert.equal(ok, false);
    assert.deepEqual(shown, []);
    assert.ok(!states.includes('recording'));
    assert.equal(track.stopCount, 1);
  });

  test('double-click lúc đang xin quyền → lượt hai im lặng, lượt đầu vẫn ghi', async () => {
    const { ok, second, shown, states } = await run(null, true, false, true);
    assert.equal(second, false);
    assert.equal(ok, true);
    assert.deepEqual(shown, []);
    assert.ok(states.includes('recording'));
  });

  test('học viên từ chối quyền → false, kèm đúng lời nhắc', async () => {
    const err = new Error('denied'); err.name = 'NotAllowedError';
    const { ok, shown } = await run(err);
    assert.equal(ok, false);
    assert.match(shown[0] || '', /từ chối quyền microphone/);
  });

  test('không có micro → false', async () => {
    const err = new Error('none'); err.name = 'NotFoundError';
    const { ok, shown } = await run(err);
    assert.equal(ok, false);
    assert.match(shown[0] || '', /Không tìm thấy microphone/);
  });
});

describe('Part 2 native start giữ dữ liệu và lỗi ở trạng thái trung thực', () => {
  test('xoá take cũ trước khi start và báo lỗi khi start trả false', async () => {
    const start = JS.indexOf('  async function _startP2Speaking() {');
    const end = JS.indexOf('  function _renderP2SpeakTimer() {');
    const shown = [];
    const recorder = {
      start: async () => false,
      isStarting: () => false,
      getAnalyser: () => null,
    };
    const runPart2 = new Function(
      '_getNativeRecorder', 'showError', '_handleP2RecordedBlob',
      '_playerGeneration', '_playerActive', `
      var _audioChunks = ['old-chunk'];
      var _recordedBlob = { old: true };
      var _elapsedSecs = 77;
      ${JS.slice(start, end)}
      return (async () => {
        await _startP2Speaking();
        return { chunks: _audioChunks, blob: _recordedBlob, elapsed: _elapsedSecs };
      })();
    `);

    const result = await runPart2(
      () => recorder,
      (message) => shown.push(message),
      () => {},
      1,
      true,
    );
    assert.deepEqual(result.chunks, []);
    assert.equal(result.blob, null);
    assert.equal(result.elapsed, 0);
    assert.match(shown[0] || '', /Không thể bắt đầu ghi âm/);
  });
});

/**
 * Hệ quả bậc hai của cùng một lỗi: khi phiếu đã nhả ô ra (`recIdx = -1`) mà máy
 * vẫn đang ghi, `_recorder.onstop` vẫn gọi `_sheetOnRecorded`. Đọc `slots[-1]`
 * là `undefined`, và gán `.state` lên đó làm NỔ trang giữa lúc học viên làm bài.
 */
describe('_sheetOnRecorded không nổ khi không còn ô nào nhận bản ghi', () => {
  function call(recIdx) {
    const start = JS.indexOf('  function _sheetOnRecorded(blob) {');
    const end = JS.indexOf('  async function _sheetSubmit() {');
    assert.ok(start !== -1 && end > start, 'không tìm thấy khối _sheetOnRecorded');

    let submitted = 0;
    const _sheet = { recIdx, slots: [{ q: {}, state: 'recording', band: null, error: null }] };
    const env = {
      _sheet,
      _renderSheet: () => {},
      _submitGradingEager: () => { submitted += 1; return Promise.resolve({}); },
      _sessionId: 'sid',
      _playerGeneration: 1,
      _playerActive: true,
    };
    const names = Object.keys(env);
    new Function(...names, `${JS.slice(start, end)} _sheetOnRecorded({});`)(
      ...names.map((n) => env[n]));
    return { submitted, sheet: _sheet };
  }

  test('có ô đang ghi → vẫn nộp câu ấy đi chấm', () => {
    const { submitted, sheet } = call(0);
    assert.equal(submitted, 1);
    assert.equal(sheet.slots[0].state, 'grading');
  });

  test('không còn ô nào (recIdx = -1) → bỏ qua, KHÔNG nổ', () => {
    const { submitted } = call(-1);
    assert.equal(submitted, 0, 'không có ô để gắn thì đừng gửi đi chấm');
  });
});

describe('phiếu: có thể huỷ lúc trình duyệt còn đang xin quyền micro', () => {
  test('bấm lại cùng ô khôi phục trạng thái và bỏ qua kết quả start trả về muộn', async () => {
    const start = JS.indexOf('  async function _sheetToggleRec(i) {');
    const end = JS.indexOf('  function _sheetOnRecorded(blob) {');
    assert.ok(start !== -1 && end > start, 'không tìm thấy _sheetToggleRec');

    let resolveStart;
    const pendingStart = new Promise((resolve) => { resolveStart = resolve; });
    let starting = true;
    let resets = 0;
    const recorder = {
      isStarting: () => starting,
      reset() { resets += 1; starting = false; },
    };
    const _sheet = { recIdx: -1, slots: [{ state: 'saved', error: null, hadWork: 'saved' }] };
    let renders = 0;
    const env = {
      _sheet,
      _analyser: null,
      _getNativeRecorder: () => recorder,
      startRecording: () => pendingStart,
      stopRecording: () => { throw new Error('pending start must reset, not stop'); },
      _renderSheet: () => { renders += 1; },
      _playerGeneration: 1,
      _playerActive: true,
      resolveStartForTest: resolveStart,
    };
    const names = Object.keys(env);
    const runToggle = new Function(...names, `
      ${JS.slice(start, end)}
      return (async () => {
        const first = _sheetToggleRec(0);
        await Promise.resolve();
        await _sheetToggleRec(0);
        resolveStartForTest(false);
        await first;
      })();
    `);

    await runToggle(...names.map((name) => env[name]));
    assert.equal(resets, 1);
    assert.equal(_sheet.recIdx, -1);
    assert.equal(_sheet.slots[0].state, 'saved');
    assert.equal(_sheet.slots[0].error, null);
    assert.ok(renders >= 2);
  });
});

describe('native stop lỗi không làm kẹt phễu hoặc phiếu', () => {
  async function runStopFailure(sheetActive) {
    const s1 = JS.indexOf('  function _showRecSub(name) {');
    const e1 = JS.indexOf('  // ── Header ─');
    const s2 = JS.indexOf('  function _getNativeRecorder() {');
    const e2 = JS.indexOf('  // ── Recording: reset (re-record)');
    const track = { stopCount: 0, stop() { this.stopCount += 1; } };
    const stream = { active: true, getTracks: () => [track] };
    class ThrowingStopRecorder {
      static isTypeSupported() { return true; }
      constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; }
      start() { this.state = 'recording'; }
      stop() { throw new Error('stop failed'); }
    }
    const controller = new SpeakingRecorderController({
      mediaDevices: { getUserMedia: async () => stream },
      MediaRecorderCtor: ThrowingStopRecorder,
      BlobCtor: Blob,
    });
    await controller.start();
    const shown = [];
    const sheet = {
      recIdx: sheetActive ? 0 : -1,
      slots: [{ state: 'recording', hadWork: 'saved', prevState: 'saved', error: null }],
    };
    const env = {
      window: { PracticeRecorder: controller },
      $: () => null,
      _stopWaveform: () => {},
      _sheetActive: () => sheetActive,
      _sheet: sheet,
      _renderSheet: () => {},
      _showRecError: (message) => shown.push(message),
      _updateNativeView: () => false,
      _releaseRecorderResources: () => controller.release(),
      clearInterval: () => {},
    };
    const names = Object.keys(env);
    const execute = new Function(...names, `
      var _recSubState = 'recording', _timerId = null, _recorder = null;
      ${JS.slice(s1, e1)}
      ${JS.slice(s2, e2)}
      return { stopped: stopRecording(), state: _recSubState };
    `);
    return {
      ...execute(...names.map((name) => env[name])),
      shown,
      sheet,
      track,
      controller,
    };
  }

  test('phễu trở về idle, hiện lỗi và nhả micro', async () => {
    const result = await runStopFailure(false);
    assert.equal(result.stopped, false);
    assert.equal(result.state, 'idle');
    assert.match(result.shown[0] || '', /Không dừng được ghi âm/);
    assert.equal(result.track.stopCount, 1);
    assert.equal(result.controller.isRecording(), false);
  });

  test('phiếu trả ô về trạng thái cũ và mở khoá các ô khác', async () => {
    const result = await runStopFailure(true);
    assert.equal(result.sheet.recIdx, -1);
    assert.equal(result.sheet.slots[0].state, 'saved');
    assert.match(result.sheet.slots[0].error || '', /Không dừng được ghi âm/);
    assert.deepEqual(result.shown, []);
  });
});

describe('nộp phiếu luôn nhả micro nhưng không huỷ controller', () => {
  test('PATCH lỗi vẫn tắt track và lần ghi tiếp theo mở lại được', async () => {
    const start = JS.indexOf('  async function _sheetSubmit() {');
    const end = JS.indexOf('  async function finishSession() {');
    assert.ok(start !== -1 && end > start, 'không tìm thấy submit + cleanup');
    const streams = [0, 1].map(() => {
      const track = { stopCount: 0, stop() { this.stopCount += 1; } };
      return { active: true, track, getTracks: () => [track] };
    });
    let streamIndex = 0;
    class MediaRecorder {
      static isTypeSupported() { return true; }
      constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; }
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; this.onstop?.(); }
    }
    const controller = new SpeakingRecorderController({
      mediaDevices: { getUserMedia: async () => streams[streamIndex++] },
      MediaRecorderCtor: MediaRecorder,
      BlobCtor: Blob,
    });
    await controller.start();

    const button = { disabled: false, textContent: 'Nộp bài' };
    const note = { textContent: '' };
    const env = {
      window: {
        api: { patch: async () => { throw new Error('mạng đứt'); } },
        confirm: () => true,
        location: { href: '' },
      },
      $: (id) => (id === 'btn-sheet-submit' ? button : note),
      _sessionId: 'session-1',
      _timerId: null,
      clearInterval: () => {},
      _stopWaveform: () => {},
      _clearP2SubmissionRetry: () => {},
      _sheet: { slots: [] },
      _sheetSubmitting: false,
      _updateNativeView: () => false,
      _getNativeRecorder: () => controller,
      _recorder: null,
      _stream: null,
      _audioCtx: null,
      _analyser: null,
      _playerGeneration: 1,
      _playerActive: true,
    };
    const names = Object.keys(env);
    const submit = new Function(...names, `
      ${JS.slice(start, end)}
      return _sheetSubmit;
    `)(...names.map((name) => env[name]));

    await submit();
    assert.equal(streams[0].track.stopCount, 1);
    assert.equal(controller.disposed, false);
    assert.equal(button.disabled, false);
    assert.match(note.textContent, /Chưa nộp được/);
    assert.equal(await controller.start(), true);
    assert.equal(streamIndex, 2);
  });

  test('không hoàn tất phiên khi còn bản ghi retry mà học viên chưa xác nhận', async () => {
    const start = JS.indexOf('  async function _sheetSubmit() {');
    const end = JS.indexOf('  async function finishSession() {');
    let patches = 0;
    let releases = 0;
    const env = {
      window: {
        api: { patch: async () => { patches += 1; } },
        confirm: () => false,
        location: { href: '' },
      },
      $: () => null,
      _sheet: { slots: [{ retryBlob: { type: 'audio/webm' } }] },
      _sheetSubmitting: false,
      _updateNativeView: () => true,
      _sessionId: 'session-1',
      _releaseRecorderResources: () => { releases += 1; },
      _playerGeneration: 1,
      _playerActive: true,
    };
    const names = Object.keys(env);
    const submit = new Function(...names, `
      ${JS.slice(start, end)}
      return _sheetSubmit;
    `)(...names.map((name) => env[name]));

    await submit();
    assert.equal(patches, 0);
    assert.equal(releases, 0);
  });

  test('trình duyệt thiếu confirm thì giải thích thay vì im lặng', async () => {
    const start = JS.indexOf('  async function _sheetSubmit() {');
    const end = JS.indexOf('  async function finishSession() {');
    const note = { textContent: '' };
    let patches = 0;
    const env = {
      window: {
        api: { patch: async () => { patches += 1; } },
        location: { href: '' },
      },
      $: (id) => (id === 'sheet-submit-note' ? note : null),
      _sheet: { slots: [{ retryBlob: { type: 'audio/webm' } }] },
      _sheetSubmitting: false,
      _updateNativeView: () => false,
      _sessionId: 'session-1',
      _releaseRecorderResources: () => {},
      _playerGeneration: 1,
      _playerActive: true,
    };
    const names = Object.keys(env);
    const submit = new Function(...names, `
      ${JS.slice(start, end)}
      return _sheetSubmit;
    `)(...names.map((name) => env[name]));

    await submit();
    assert.equal(patches, 0);
    assert.match(note.textContent, /Hãy gửi lại bản ghi trước khi nộp bài/);
  });
});

/**
 * codex #927: một lần ghi THÀNH CÔNG cũng làm hỏng lần sau.
 *
 * Nhánh phiếu trong `onstop` return sớm, không đi qua `_showRecSub('recorded')`
 * của luồng phễu — nên `_recSubState` kẹt ở 'recording' và chốt đầu
 * `startRecording()` chặn mọi lần ghi từ ô thứ hai. Vậy phép kiểm phải chạy
 * TRỌN chu trình ghi→dừng→ghi qua đúng các hàm thật (`_showRecSub` thật,
 * `stopRecording` thật, MediaRecorder giả có onstop) — một lần start đơn lẻ
 * không phân biệt được hai hành vi.
 */
describe('phiếu: ghi được NHIỀU câu liên tiếp, không chỉ câu đầu', () => {
  async function cycle(native = false) {
    const s1 = JS.indexOf('  function _showRecSub(name) {');
    const e1 = JS.indexOf('  // ── Header ─');
    const s2 = JS.indexOf('  function _getNativeRecorder() {');
    const e2 = JS.indexOf('  // ── Recording: reset (re-record)');
    assert.ok(s1 !== -1 && e1 > s1 && s2 !== -1 && e2 > s2, 'không tìm thấy các khối');

    const track = { stop() {} };
    const stream = { active: true, getTracks: () => [track] };
    class MediaRecorder {
      static isTypeSupported() { return true; }
      constructor() { this.mimeType = 'audio/webm'; this.state = 'inactive'; }
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; this.onstop(); }   // như trình duyệt: stop kích onstop
    }
    const handed = [];
    const browserWindow = { AudioContext: function () { throw new Error('no ctx'); } };
    const env = {
      navigator: { mediaDevices: { getUserMedia: async () => stream } },
      MediaRecorder,
      window: browserWindow,
      $: () => null,
      _showRecError: (m) => { throw new Error('không được hiện lỗi: ' + m); },
      _clearRecError: () => {}, _stopAITts: () => {}, _cancelSpeech: () => {},
      _startWaveform: () => {}, _stopWaveform: () => {},
      _renderTimer: () => {}, _renderRecordedPlayback: () => {},
      _renderRecordedLengthHint: () => {},
      _updateNativeView: () => false,
      _sheetActive: () => true,
      _sheetOnRecorded: (b) => handed.push(b),
      _startManagedInterval: () => 1, _clearManagedEffect: () => true,
      _playerGeneration: 1,
      _playerActive: true,
      MAX_RECORD_SEC: { 1: 90 },
      Blob: globalThis.Blob,
    };
    if (native) {
      browserWindow.PracticeRecorder = new SpeakingRecorderController({
        mediaDevices: env.navigator.mediaDevices,
        MediaRecorderCtor: MediaRecorder,
        AudioContextCtor: browserWindow.AudioContext,
        BlobCtor: Blob,
        setIntervalFn: () => 1,
        clearIntervalFn: () => {},
      });
    }
    const names = Object.keys(env);
    // _showRecSub THẬT được khai trong scope nên thắng mọi stub cùng tên.
    const fn = new Function(...names, `
      var _recSubState = 'idle', _stream = null, _recorder = null, _analyser = null;
      var _audioCtx = null, _audioChunks = [], _recordedBlob = null;
      var _timerId = null, _elapsedSecs = 0, _sessionData = { part: 1 };
      ${JS.slice(s1, e1)}
      ${JS.slice(s2, e2)}
      return (async () => {
        const r = [];
        r.push(await startRecording());   // câu 1: ghi
        stopRecording();                  //        dừng → onstop → nhánh phiếu
        r.push(await startRecording());   // câu 2: phải ghi được tiếp
        stopRecording();
        r.push(await startRecording());   // câu 3
        return r;
      })();
    `);
    return { starts: await fn(...names.map((n) => env[n])), handed };
  }

  test('ghi → dừng → ghi → dừng → ghi: cả ba lần đều bắt đầu được', async () => {
    const { starts, handed } = await cycle();
    assert.deepEqual(starts, [true, true, true],
      'lần nào false là ô ấy hiện "hỏng micro" dù micro vẫn ngon');
    assert.equal(handed.length, 2, 'hai bản ghi đã dừng phải tới tay phiếu');
  });

  test('native controller: ba chu trình thật đều đi qua đúng callback phiếu', async () => {
    const { starts, handed } = await cycle(true);
    assert.deepEqual(starts, [true, true, true]);
    assert.equal(handed.length, 2);
  });
});

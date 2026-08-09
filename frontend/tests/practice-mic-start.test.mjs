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

const HERE = dirname(fileURLToPath(import.meta.url));
const JS = readFileSync(join(HERE, '..', 'public', 'js', 'practice.js'), 'utf8');

/** Chạy THẬT startRecording với micro giả. `mic` quyết định getUserMedia làm gì. */
async function run(mic) {
  const start = JS.indexOf('  function _getNativeRecorder() {');
  const end = JS.indexOf('  // ── Recording: stop ─');
  assert.ok(start !== -1 && end > start, 'không tìm thấy khối startRecording');

  const shown = [];
  const track = { stop() {} };
  const stream = { active: true, getTracks: () => [track] };
  const navigator = {
    mediaDevices: { getUserMedia: async () => { if (mic) throw mic; return stream; } },
  };
  class MediaRecorder {
    static isTypeSupported() { return true; }
    constructor() { this.mimeType = 'audio/webm'; }
    start() {}
  }
  const env = {
    navigator, MediaRecorder,
    window: { AudioContext: function () { throw new Error('no audio ctx'); } },
    $: () => null,
    _showRecError: (m) => shown.push(m),
    _clearRecError: () => {},
    _stopAITts: () => {},
    _showRecSub: () => {},
    _startWaveform: () => {},
    _renderTimer: () => {},
    _renderRecordedPlayback: () => {},
    _renderRecordedLengthHint: () => {},
    _sheetActive: () => false,
    _sheetOnRecorded: () => {},
    stopRecording: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    MAX_RECORD_SEC: { 1: 90 },
  };
  const names = Object.keys(env);
  const fn = new Function(...names, `
    var _recSubState = 'idle', _stream = null, _recorder = null, _analyser = null;
    var _audioCtx = null, _audioChunks = [], _recordedBlob = null;
    var _timerId = null, _elapsedSecs = 0, _sessionData = { part: 1 };
    ${JS.slice(start, end)}
    return startRecording();
  `);
  return { ok: await fn(...names.map((n) => env[n])), shown };
}

describe('startRecording báo đúng thành công / thất bại', () => {
  test('micro mở được → trả về giá trị THẬT (truthy), không phải undefined', async () => {
    const { ok, shown } = await run(null);
    assert.deepEqual(shown, [], 'đường thành công không được hiện lỗi nào');
    assert.equal(ok, true,
      `phiếu làm bài đọc giá trị này; ${JSON.stringify(ok)} bị coi là hỏng micro`);
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
  async function cycle() {
    const s1 = JS.indexOf('  function _showRecSub(name) {');
    const e1 = JS.indexOf('  // ── Header ─');
    const s2 = JS.indexOf('  function _getNativeRecorder() {');
    const e2 = JS.indexOf('  // ── Recording: reset (re-record)');
    assert.ok(s1 !== -1 && e1 > s1 && s2 !== -1 && e2 > s2, 'không tìm thấy các khối');

    const track = { stop() {} };
    const stream = { active: true, getTracks: () => [track] };
    class MediaRecorder {
      static isTypeSupported() { return true; }
      constructor() { this.mimeType = 'audio/webm'; this.state = 'recording'; }
      start() {}
      stop() { this.state = 'inactive'; this.onstop(); }   // như trình duyệt: stop kích onstop
    }
    const handed = [];
    const env = {
      navigator: { mediaDevices: { getUserMedia: async () => stream } },
      MediaRecorder,
      window: { AudioContext: function () { throw new Error('no ctx'); } },
      $: () => null,
      _showRecError: (m) => { throw new Error('không được hiện lỗi: ' + m); },
      _clearRecError: () => {}, _stopAITts: () => {},
      _startWaveform: () => {}, _stopWaveform: () => {},
      _renderTimer: () => {}, _renderRecordedPlayback: () => {},
      _renderRecordedLengthHint: () => {},
      _sheetActive: () => true,
      _sheetOnRecorded: (b) => handed.push(b),
      setInterval: () => 1, clearInterval: () => {},
      MAX_RECORD_SEC: { 1: 90 },
      Blob: globalThis.Blob,
    };
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
});

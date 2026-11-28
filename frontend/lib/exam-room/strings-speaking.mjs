// @ts-check
// EXAMSPEAK-0072 FR-003, FR-004, FR-005, FR-011: words of the Speaking exam
// room. `practice` (luyện tập, test_part) is Vietnamese and says "bạn";
// `test` (test_full in a mock sitting, open question 1) is English. Both sets
// have the same keys. No HTTP code, error name or session id appears in any
// string, and no number of seconds is written here: the caller passes
// MIN_RECORD_SEC[part] or the server's `detail.min_seconds`.

/** @typedef {'practice' | 'test'} SpeakingRoomMode */

const VI = Object.freeze({
  lang: 'vi',
  micRegion: 'Micro',
  micPrompt: 'Cần micro để ghi âm câu trả lời.',
  micAllow: 'Cho phép micro',
  micPending: 'Hãy chọn Cho phép trong hộp của trình duyệt.',
  micPendingButton: 'Đang chờ trình duyệt…',
  micDeniedTitle: 'Trình duyệt đang chặn micro.',
  micDeniedSteps: Object.freeze([
    'Bấm biểu tượng ổ khoá trên thanh địa chỉ.',
    'Chọn Micro.',
    'Chọn Cho phép, rồi bấm Thử lại.',
  ]),
  micDeniedKept: 'Các câu bạn đã gửi vẫn được giữ.',
  micNotFound: 'Không tìm thấy micro. Hãy cắm micro rồi bấm Thử lại.',
  // Same words as the recorder's NotReadableError and unsupported messages today.
  micBusy: 'Microphone đang được dùng bởi ứng dụng khác. Hãy đóng ứng dụng đó và thử lại.',
  micUnsupported: 'Trình duyệt không hỗ trợ ghi âm. Hãy dùng Chrome, Firefox hoặc Edge phiên bản mới.',
  micRetry: 'Thử lại',
  recRegion: 'Trạng thái ghi âm',
  recReady: 'Sẵn sàng',
  recRecording: 'Đang ghi',
  recSilent: 'Không nghe thấy tiếng',
  recSilentHint: 'Hãy nói gần micro hơn, hoặc kiểm tra micro đang bật.',
  recPaused: 'Tạm dừng',
  recPausedHint: 'Micro đang bị tắt. Hãy bật lại micro để ghi tiếp.',
  recRecorded: 'Đã ghi',
  elapsed: 'Thời gian',
});

const EN = Object.freeze({
  lang: 'en',
  micRegion: 'Microphone',
  micPrompt: 'A microphone is needed to record your answer.',
  micAllow: 'Allow microphone',
  micPending: 'Choose Allow in the browser box.',
  micPendingButton: 'Waiting for the browser…',
  micDeniedTitle: 'The browser is blocking the microphone.',
  micDeniedSteps: Object.freeze([
    'Click the lock icon in the address bar.',
    'Choose Microphone.',
    'Choose Allow, then click Try again.',
  ]),
  micDeniedKept: 'Answers you have already sent are kept.',
  micNotFound: 'No microphone found. Plug in a microphone, then click Try again.',
  micBusy: 'Another app is using the microphone. Close that app and try again.',
  micUnsupported: 'This browser cannot record audio. Use a recent Chrome, Firefox or Edge.',
  micRetry: 'Try again',
  recRegion: 'Recording status',
  recReady: 'Ready',
  recRecording: 'Recording',
  recSilent: "We can't hear you",
  recSilentHint: 'Move closer to the microphone, or check that it is on.',
  recPaused: 'Paused',
  recPausedHint: 'The microphone is muted. Turn it back on to keep recording.',
  recRecorded: 'Recorded',
  elapsed: 'Time',
});

export const SPEAKING_ROOM_STRINGS_VI = VI;
export const SPEAKING_ROOM_STRINGS_EN = EN;

/**
 * @param {SpeakingRoomMode} mode
 */
export function speakingRoomStrings(mode) {
  return mode === 'test' ? EN : VI;
}

/**
 * Room mode of a Speaking session (FR-011): only a full test is `test`.
 * @param {string | null | undefined} sessionMode `sessions.mode`
 * @returns {SpeakingRoomMode}
 */
export function speakingRoomMode(sessionMode) {
  return sessionMode === 'test_full' ? 'test' : 'practice';
}

/**
 * Why a recording is too short, in words (FR-005). Whole seconds, rounded down,
 * so the page never says a take reached the minimum when it did not.
 * @param {number} durationSeconds
 * @param {number | string} part
 * @param {number} minSeconds MIN_RECORD_SEC[part] or the server's detail.min_seconds
 * @param {SpeakingRoomMode} [mode]
 * @returns {string}
 */
export function speakingTooShortReason(durationSeconds, part, minSeconds, mode = 'practice') {
  const took = Math.max(0, Math.floor(Number(durationSeconds) || 0));
  const need = Math.max(0, Math.ceil(Number(minSeconds) || 0));
  if (mode === 'test') {
    return `Your recording is ${took} ${took === 1 ? 'second' : 'seconds'}; Part ${part} needs at least ${need} seconds. Record again with a longer answer.`;
  }
  return `Bản ghi ${took} giây, Part ${part} cần ít nhất ${need} giây. Hãy ghi lại với câu trả lời dài hơn.`;
}

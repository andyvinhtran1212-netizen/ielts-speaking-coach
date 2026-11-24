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
  micLost: 'Mất kết nối micro.',
  // R149 (one writing tab, EXAMROOM-0066 FR-017); the spec's words for stuck.
  checkingTab: 'Đang kiểm tra tab…',
  otherTab: 'Bài này đang mở ở tab khác.',
  useThisTab: 'Dùng tab này',
  otherTabStuck: 'Bài này đang mở ở tab khác và còn bản ghi chưa gửi. Hãy gửi hoặc bỏ bản ghi ở tab đó.',
  reload: 'Tải lại',
  handoverRefused: 'Một tab khác muốn làm tiếp bài này. Bạn còn bản ghi chưa gửi nên vẫn làm ở tab này.',
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
  // T003 boxes (FR-006–FR-008, FR-010). No box promises to keep a recording
  // after a reload: unsent takes live only in this page (FR-009).
  close: 'Đóng',
  leaveTitle: 'Bạn có bản ghi chưa gửi',
  leaveBody: 'Nếu thoát bây giờ, bản ghi chưa gửi sẽ mất. Các câu bạn đã gửi vẫn được giữ.',
  leaveStay: 'Ở lại',
  leaveGo: 'Bỏ bản ghi và thoát',
  rerecordTitle: 'Xoá bản ghi này và ghi lại?',
  rerecordBody: 'Bản ghi này chưa được gửi. Xoá rồi thì không lấy lại được.',
  rerecordKeep: 'Giữ bản ghi',
  rerecordDiscard: 'Xoá và ghi lại',
  submitBody: 'Nộp bây giờ sẽ dùng bản cũ trên máy chủ và bỏ các bản ghi mới.',
  submitRetry: 'Gửi lại bản ghi',
  submitAnyway: 'Vẫn nộp',
  expiredTitle: 'Phiên đăng nhập đã hết hạn',
  expiredBody: 'Hãy đăng nhập lại để gửi tiếp.',
  expiredUnsent: 'Bản ghi chưa gửi chỉ còn trên trang này, nên trang này giữ nguyên. Hãy đăng nhập lại ở một tab khác, rồi quay lại đây bấm Gửi lại bản ghi. Nộp bài mở lại khi bản ghi đã gửi được.',
  expiredStay: 'Ở lại làm tiếp',
  expiredSignIn: 'Đăng nhập lại',
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
  micLost: 'The microphone was disconnected.',
  checkingTab: 'Checking for other tabs…',
  otherTab: 'This test is open in another tab.',
  useThisTab: 'Use this tab',
  otherTabStuck: 'This test is open in another tab with recordings not sent yet. Send or discard them in that tab.',
  reload: 'Reload',
  handoverRefused: 'Another tab asked to continue this test. You have recordings not sent yet, so you can keep working here.',
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
  close: 'Close',
  leaveTitle: 'You have unsent recordings',
  leaveBody: 'If you leave now, the unsent recordings will be lost. Answers you have already sent are kept.',
  leaveStay: 'Stay',
  leaveGo: 'Discard and leave',
  rerecordTitle: 'Delete this recording and record again?',
  rerecordBody: 'This recording has not been sent. Once deleted, it cannot be recovered.',
  rerecordKeep: 'Keep recording',
  rerecordDiscard: 'Delete and record again',
  submitBody: 'Submitting now uses the earlier answers on our server and drops the new recordings.',
  submitRetry: 'Send recordings again',
  submitAnyway: 'Submit anyway',
  expiredTitle: 'You have been signed out',
  expiredBody: 'Sign in again to keep sending answers.',
  expiredUnsent: 'Unsent recordings exist only on this page, so this page stays open. Sign in again in another tab, then come back here and click Send recordings again. Submit opens again once they are sent.',
  expiredStay: 'Stay',
  expiredSignIn: 'Sign in again',
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

/**
 * Title of the submit box when re-recorded takes failed to send (FR-008).
 * @param {number} count
 * @param {SpeakingRoomMode} [mode]
 * @returns {string}
 */
export function speakingUnsentSubmitTitle(count, mode = 'practice') {
  const n = Math.max(1, Math.floor(Number(count) || 0));
  if (mode === 'test') return `${n} new ${n === 1 ? 'recording' : 'recordings'} could not be sent`;
  return `Còn ${n} bản ghi mới chưa gửi được`;
}

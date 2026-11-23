// @ts-check
// EXAMROOM-0066 FR-002: the exam room in `practice` mode, Vietnamese, addressing
// the learner as "bạn". Same keys as strings-en.mjs (GOI-08 §5.3). Highlight,
// Note and Clear stay English in both modes. The leave dialog copy is
// FocusShell's FOCUS_WORDS.practice.leave (FR-011). No HTTP code, parameter
// name or attempt id appears in any string.

export const EXAM_ROOM_STRINGS_VI = Object.freeze({
  lang: 'vi',

  abandon: 'Bỏ bài',
  abandonTitle: 'Bỏ bài này?',
  abandonBody: 'Bài sẽ không được chấm và lượt này không hiện trong kết quả của bạn.',
  abandonKeep: 'Làm tiếp',

  timeUpChoiceTitle: 'Hết giờ',
  timeUpSend: 'Gửi chấm',
  timeUpDiscard: 'Bỏ lượt này',

  sectionDone: 'Đã nộp phần này',
  /** @param {string} section */
  nextUp: (section) => `Tiếp theo: ${section}`,
  selfPacedNotice: 'Đã bắt đầu thì các phần chạy liền nhau, không dừng giữa các phần.',

  timeRemaining: 'Còn lại',
  fiveLeft: 'Còn 5 phút',
  timeUp: 'Hết giờ',

  saving: 'Đang lưu…',
  /** @param {string} t */
  savedAt: (t) => `Đã lưu lúc ${t}`,
  notSaved: 'Chưa lưu được, đang thử lại',
  retry: 'Thử lưu lại',

  /** @param {number} n @param {number} total */
  answered: (n, total) => `Đã làm ${n} trên ${total} câu`,
  flag: 'Đánh dấu xem lại',
  flagged: 'đánh dấu',
  /** @param {number} n */
  qShort: (n) => `Câu ${n}`,
  /** @param {{ n: number, answered: boolean, flagged: boolean, current: boolean }} q */
  qLabel: ({ n, answered, flagged, current }) =>
    `Câu ${n}, ${answered ? 'đã trả lời' : 'chưa trả lời'}${flagged ? ', đánh dấu xem lại' : ''}${current ? ', câu đang làm' : ''}`,
  sectionKind: Object.freeze({ passage: 'Bài đọc', part: 'Phần', task: 'Task' }),
  /** @param {{ kind: string, index: number, answered: number, total: number }} s */
  sectionChip: ({ kind, index, answered, total }) => `${kind} ${index} · ${answered}/${total}`,
  /** @param {{ kind: string, index: number, answered: number, total: number, flagged: number, first: number, last: number }} s */
  sectionCollapsed: ({ kind, index, answered, total, flagged, first, last }) =>
    `${kind} ${index}: đã làm ${answered} trên ${total} câu, ${flagged} câu đánh dấu. Mở câu ${first}–${last}`,
  /** @param {{ q: number, total: number, section?: string }} p */
  position: ({ q, total, section }) => `Câu ${q} trên ${total}${section ? ` · ${section}` : ''}`,
  review: 'Xem lại',
  previous: 'Câu trước',
  next: 'Câu sau',

  submit: 'Nộp bài',
  submitTitle: 'Nộp bài?',
  submitBody: 'Nộp rồi thì không sửa được nữa.',
  warning: 'Cảnh báo',
  /** @param {number} n */
  submitBlankTitle: (n) => `Nộp bài khi còn ${n} câu chưa trả lời?`,
  /** @param {string} list */
  submitBlankBody: (list) => `${list} đang để trống. Nộp rồi thì không sửa được nữa.`,
  /** @param {string[]} shown @param {number} more */
  questionList: (shown, more) => {
    const head = shown.join(', ');
    if (more > 0) return `Câu ${head} và ${more} câu khác`;
    if (shown.length <= 1) return `Câu ${head}`;
    return `Câu ${shown.slice(0, -1).join(', ')} và ${shown[shown.length - 1]}`;
  },
  returnToTest: 'Quay lại làm tiếp',
  waitingConnection: 'Chờ kết nối',
  submitBusySaving: 'Đang lưu bài…',
  submitBusySubmitting: 'Đang nộp…',
  submitReadOnly: 'Bài này đang mở ở tab khác',

  /** @param {string | null} t */
  offline: (t) => t
    ? `Mất kết nối mạng. Bài của bạn đã lưu tới ${t}. Bạn vẫn có thể làm tiếp; bài sẽ được lưu lại khi có mạng.`
    : 'Mất kết nối mạng. Bạn vẫn có thể làm tiếp; bài sẽ được lưu khi có mạng.',
  online: 'Đã kết nối lại. Bài của bạn đã được lưu.',

  sessionExpiredTitle: 'Phiên đăng nhập đã hết hạn',
  /** @param {string | null} t */
  sessionExpiredBody: (t) => t
    ? `Hãy đăng nhập lại để tiếp tục. Bạn sẽ quay lại đúng trang này. Bài đã lưu tới ${t}.`
    : 'Hãy đăng nhập lại để tiếp tục. Bạn sẽ quay lại đúng trang này.',
  /** @param {string | null} t */
  sessionExpiredNoCopy: (t) => t
    ? `Trình duyệt không giữ được bản sao bài làm. Các câu sau ${t} có thể mất nếu bạn rời trang.`
    : 'Trình duyệt không giữ được bản sao bài làm. Các câu vừa làm có thể mất nếu bạn rời trang.',
  signInAgain: 'Đăng nhập lại',
  notCurrentDevice: 'Bài này đang mở ở thiết bị khác.',
  back: 'Quay lại',

  otherTab: 'Bài này đang mở ở tab khác.',
  useThisTab: 'Dùng tab này',
  otherTabStuck: 'Tab kia không phản hồi. Bạn đóng tab đó rồi bấm Tải lại.',
  reload: 'Tải lại',

  submitting: 'Đang nộp bài…',
  confirmed: 'Bài của bạn đã được lưu và nộp.',
  unconfirmed: 'Hết giờ. Chưa xác nhận được bài đã nộp. Bạn giữ trang này mở trong lúc hệ thống thử lại.',
  /** @param {string | null} t */
  unconfirmedManual: (t) => t
    ? `Chưa xác nhận được bài đã nộp. Máy chủ đã lưu bài của bạn tới ${t}.`
    : 'Chưa xác nhận được bài đã nộp.',
  tryAgain: 'Thử lại',
  /** @param {string} closedAt @param {string} [savedUpTo] */
  closedUnconfirmed: (closedAt, savedUpTo = closedAt) =>
    `Máy chủ đã đóng bài lúc ${closedAt}. Các câu sau ${savedUpTo} có thể chưa được ghi nhận.`,

  highlight: 'Highlight',
  note: 'Note',
  clear: 'Clear',
});

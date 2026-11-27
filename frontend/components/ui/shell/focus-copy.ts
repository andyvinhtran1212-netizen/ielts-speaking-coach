import type { ReactNode } from 'react';

export type FocusMode = 'practice' | 'exam';

/** Words of the leave box; each one can be replaced for a given page. */
export type FocusLeaveCopy = {
  title: string;
  /** Bold first sentence, e.g. the exam room's running-timer warning. */
  lead?: string;
  /** Empty in the exam room while work is unsaved (G08 passes the unsaved count). */
  body?: ReactNode;
  /** Muted line after the text, e.g. "Come back before 11:05 to continue." */
  note?: ReactNode;
  /** The way back: the primary button, focused when the box opens. */
  stayLabel: string;
  /** The way out. */
  leaveLabel: string;
};

/**
 * Practice is Vietnamese, the exam room is English; the two never mix labels
 * (ThanhPhanKhungTrang §6, FR-009). There is no "Save and exit" in the exam room.
 */
export const FOCUS_WORDS = {
  practice: {
    exit: 'Thoát',
    leaving: 'Đang lưu…',
    skip: 'Bỏ qua tới nội dung',
    close: 'Đóng',
    leave: {
      title: 'Thoát khi đang ghi âm?',
      body: 'Đoạn ghi âm đang dở sẽ bị bỏ. Các câu bạn đã ghi xong vẫn được giữ.',
      stayLabel: 'Ở lại ghi tiếp',
      leaveLabel: 'Bỏ đoạn ghi và thoát',
    },
  },
  exam: {
    exit: 'Leave test',
    leaving: 'Saving…',
    skip: 'Skip to test content',
    close: 'Close',
    abandon: 'Abandon test',
    leave: {
      title: 'Leave this test?',
      lead: 'The timer keeps running on our server while you are away.',
      body: 'Your answers so far are saved.',
      stayLabel: 'Stay in test',
      leaveLabel: 'Leave test',
    },
  },
} as const;

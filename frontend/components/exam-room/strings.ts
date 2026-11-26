// EXAMROOM-0066 FR-002: one string set per screen: English in `test`,
// Vietnamese in `practice`. The sets live in lib/exam-room (G08-T02); the few
// lines below are the shell's own (leave box with the unsaved count, submit
// error, flag toggle, elapsed time) and follow the same rule.
import { EXAM_ROOM_STRINGS_EN } from '@/lib/exam-room/strings-en.mjs';
import { EXAM_ROOM_STRINGS_VI } from '@/lib/exam-room/strings-vi.mjs';

import type { ExamRoomMode } from './types';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const SHELL_EN = {
  /** FR-011: replaces "Your answers so far are saved." while answers are unsaved. */
  leaveUnsaved: (n: number) =>
    `${n} ${plural(n, 'answer has', 'answers have')} not been saved yet. If you leave now, ${plural(n, 'it', 'they')} may be lost.`,
  leaveTitle: 'Leave this test?',
  leaveStay: 'Stay in test',
  leaveGo: 'Leave test',
  submitFailed: 'We could not submit your answers. Check your connection, then try again.',
  choiceFailed: 'That did not go through. Your work is kept. Try again.',
  unflag: 'Remove flag',
  timeElapsed: 'Time used',
  reviewTitle: 'Questions',
  closeReview: 'Close',
  /** FR-015 amendment 2: the only action when nothing is secured. */
  sessionStay: 'Stay',
  handoverRefused: 'Another tab asked to continue this test. Some answers are not saved yet, so you can keep working here.',
  /** FR-034 `unconfirmed` when time is not up (an untimed surface, or a submit before the end). */
  unconfirmedPending: 'We have not confirmed your submission yet. Keep this page open while we try again.',
} as const;

/** The Vietnamese set has the same keys and shapes, not the English literals. */
type ShellStrings = { [K in keyof typeof SHELL_EN]: (typeof SHELL_EN)[K] extends (...args: infer A) => string ? (...args: A) => string : string };

const SHELL_VI: ShellStrings = {
  leaveUnsaved: (n: number) => `Còn ${n} câu chưa lưu. Nếu thoát bây giờ, các câu này có thể mất.`,
  leaveTitle: 'Thoát bài luyện?',
  leaveStay: 'Ở lại làm tiếp',
  leaveGo: 'Thoát',
  submitFailed: 'Chưa nộp được bài. Bạn kiểm tra kết nối rồi thử lại.',
  choiceFailed: 'Chưa gửi được lựa chọn. Bài của bạn vẫn còn. Bạn thử lại nhé.',
  unflag: 'Bỏ đánh dấu',
  timeElapsed: 'Thời gian đã làm',
  reviewTitle: 'Danh sách câu',
  closeReview: 'Đóng',
  sessionStay: 'Ở lại làm tiếp',
  handoverRefused: 'Một tab khác muốn làm tiếp bài này. Vẫn còn câu chưa lưu nên bạn làm tiếp ở tab này.',
  unconfirmedPending: 'Chưa xác nhận được bài đã nộp. Bạn giữ trang này mở trong lúc hệ thống thử lại.',
};

export type ExamRoomStrings = typeof EXAM_ROOM_STRINGS_EN & { shell: ShellStrings };

export function examRoomStrings(mode: ExamRoomMode): ExamRoomStrings {
  return mode === 'test'
    ? { ...EXAM_ROOM_STRINGS_EN, shell: SHELL_EN }
    : ({ ...EXAM_ROOM_STRINGS_VI, shell: SHELL_VI } as unknown as ExamRoomStrings);
}

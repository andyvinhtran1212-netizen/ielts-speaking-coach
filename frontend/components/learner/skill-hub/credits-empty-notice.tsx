// "Hết lượt chấm AI" (LEARNERCORE-0063 FR-116, tờ HubKyNang màn 5). Shown only
// for a metered skill with a zero balance; the hub decides that with
// `creditsEmpty`. Grading stays blocked by the server (402) as today; the
// rest of the hub keeps working.
import { Notice } from '@/components/ui/notice';
import { liveHref } from '@/components/ui/shell/learner-sections';

const ACCOUNT = liveHref({ href: '/account', today: null });

export function CreditsEmptyNotice() {
  return (
    <Notice kind="warning" title="Bạn đã hết lượt chấm AI." live="status">
      Bài nộp để AI chấm cần lượt. Bạn vẫn xem kho bài, làm tiếp bài dở và xem lại kết quả cũ.
      {ACCOUNT ? <> <a href={ACCOUNT}>Xem khoá học và lượt AI</a>.</> : null}
    </Notice>
  );
}

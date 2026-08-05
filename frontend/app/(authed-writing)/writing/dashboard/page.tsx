// Trang Bài viết trên Next — `/writing/dashboard`.
//
// TÍNH NGUYÊN TỬ: tạo route này và gỡ rewrite
// `{ source: '/writing/dashboard', destination: '/pages/writing-dashboard.html' }`
// trong `next.config.ts` PHẢI cùng một commit — cổng route-ownership chặn trạng
// thái nửa vời (một URL không thể vừa là route Next vừa là rewrite sang legacy).
//
// Bản legacy `/pages/writing-dashboard.html` VẪN trả 200 và đó là CỐ Ý: cổng
// parity G1 chỉ so được khi cả hai vế còn sống. Gỡ bản legacy thuộc Phase 7.
//
// HỢP ĐỒNG GHI CÓ TRƯỚC TRANG NÀY (#947). `tooling/write-flows/writing-submit.mjs`
// được viết và làm-cho-xanh trên trang LEGACY trước khi có dòng React nào, đúng
// để nó không chỉ mô tả lại thứ tôi vừa viết. Bốn đường ghi bị ghim cả thân
// request: `/start`, `/draft` (`draft_text`), `/paste-log` (`blocked` +
// `char_count`), `/submit` (`essay_text` NGUYÊN VĂN — backend lấy bản nháp cũ
// khi thiếu trường này, nên một bản port quên gửi sẽ nộp bài THIẾU đoạn học
// viên vừa dán mà không cổng tĩnh nào thấy).
//
// "PORT XONG" = cùng bản khai đó xanh trên CẢ HAI vế, tức `nextPending` đã gỡ.
import type { Metadata } from 'next';

import { WritingShell } from './page-shell';
import { WritingBehavior } from './writing-behavior';

export const metadata: Metadata = {
  // Byte-faithful với <title> của bản legacy
  title: 'Bài viết của em — Aver Learning',
  robots: { index: false, follow: false },
};

export default function WritingDashboardPage() {
  return (
    <>
      {/* Chrome chung. Layout chỉ NẠP script; phần tử phải do từng trang dựng —
          bài học PR #897: thiếu dòng này là mất toàn bộ điều hướng mà build vẫn xanh. */}
      {/* @ts-ignore */}
      <aver-chrome active="writing" />
      <WritingShell />
      <WritingBehavior />
    </>
  );
}

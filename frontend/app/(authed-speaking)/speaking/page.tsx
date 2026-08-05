// Trang Speaking trên Next — CANONICAL tại `/speaking` (cutover 2026-08-05).
//
// CUTOVER Ở DỰ ÁN NÀY: đổi canonical + đổi mọi điều hướng nội bộ, KHÔNG gỡ bản
// legacy. `/pages/speaking.html` vẫn trả 200 và đó là CỐ Ý — cổng parity G1 chỉ
// so được khi cả hai vế còn sống. Gỡ bản legacy thuộc Phase 7.
//
// TÍNH NGUYÊN TỬ: đổi route (`speaking-preview/` → `speaking/`) và gỡ rewrite
// `{ source: '/speaking', … }` PHẢI cùng một commit — cổng route-ownership chặn
// trạng thái nửa vời.
//
// BA LỚP BẰNG CHỨNG TRƯỚC CUTOVER (ADR-013-A1 — cổng, không phải đồng hồ):
//   1. Parity tĩnh: 2 cặp authed × 2 bề rộng, 0 phát hiện.
//   2. Kiểm luồng trong CI (`tooling/verify-speaking-flow.mjs`): 13/13 — bấm
//      nút gửi ĐÚNG `{mode, part, topic}` và điều hướng kèm `session_id`.
//   3. Luồng THẬT trên staging: phiên được tạo trong DB với đúng thuộc tính.
//
// LỚP 2 và 3 tồn tại vì cổng parity so TRẠNG THÁI TĨNH — nó không phân biệt
// được "nút có nhãn đúng" với "nút làm đúng việc". Ba lỗi trong đợt port này
// đều thuộc loại đó.
//
// PHỦ SÓNG CÒN THIẾU: G1 KHÔNG thấy nội dung trong `<canvas>` ⇒ hai biểu đồ
// Chart.js nằm ngoài tầm parity vĩnh viễn; lớp che của chúng là
// `tests/speaking-charts.test.mjs`.
import type { Metadata } from 'next';

import { SpeakingBehavior } from './speaking-behavior';
import { SpeakingStats } from './speaking-stats';
import { SpeakingShell } from './page-shell';

export const metadata: Metadata = {
  // Byte-faithful với <title> của bản legacy
  title: 'Speaking — AverLearning',
  robots: { index: false, follow: false },
};

export default function SpeakingPage() {
  return (
    <>
      {/* Chrome chung. Layout chỉ NẠP script; phần tử phải do từng trang dựng —
          bài học PR #897: thiếu dòng này là mất toàn bộ điều hướng mà build vẫn xanh. */}
      {/* @ts-ignore */}
      <aver-chrome active="speaking" role-source="page" />
      <SpeakingShell />
      <SpeakingBehavior />
      <SpeakingStats />
    </>
  );
}

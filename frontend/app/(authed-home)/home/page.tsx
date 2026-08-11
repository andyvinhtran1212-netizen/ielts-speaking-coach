// Trang chủ học viên trên Next — CANONICAL tại `/home` (cutover 2026-08-05).
//
// CUTOVER Ở DỰ ÁN NÀY NGHĨA LÀ: đổi canonical + đổi mọi điều hướng nội bộ.
// KHÔNG gỡ bản legacy. `/pages/home.html` vẫn trả 200 và đó là CỐ Ý —
// cổng parity G1 chỉ so được khi CẢ HAI vế còn sống. Redirect bản legacy sang
// `/home` sẽ khiến hai vế cùng dừng ở một URL, chốt `same-final-url` từ chối,
// và trang chủ MẤT LUÔN lớp parity. Gỡ bản legacy thuộc Phase 7.
// Đây đúng là tiền lệ pilot 2: `/pages/grammar-article.html` vẫn trả 200 tới
// hôm nay, nhiều ngày sau cutover.
//
// TÍNH NGUYÊN TỬ: việc đổi route (`home-preview/` → `home/`) và việc gỡ rewrite
// `{ source: '/home', destination: '/pages/home.html' }` trong `next.config.ts`
// PHẢI nằm cùng một commit. Cổng route-ownership chặn trạng thái nửa vời — đã
// thấy nó báo đúng ("app route /home is SHADOWED by config source /home") khi
// tôi đổi route trước và gỡ rewrite sau.
//
// BẰNG CHỨNG TRƯỚC CUTOVER (theo ADR-013-A1 — cổng, không phải đồng hồ):
// cổng parity authed trên PR #930 cho `1 cặp · 0 cặp lệch nghiêm trọng ·
// 0 phát hiện mức cao` ở CẢ hai bề rộng 1280x900 và 375x812, với phiên đăng
// nhập thật (tài khoản probe). Lượt `full` cùng lúc: 149 cặp × 2 bề rộng, 0
// phát hiện.
//
// TRANG NÀY GỒM: vỏ tĩnh (`page-shell.tsx`, Server Component — bearer token
// không đi qua ranh giới RSC, ADR-003 §3) + tầng hành vi (`home-behavior.tsx`,
// port `public/js/home.js`) gọi 3 API cần đăng nhập:
// `/api/student/home-summary`, `/api/student/permissions`,
// `/api/class/me?summary=true`, cộng `/api/mock-exams/my-sittings` cho ô kết
// quả thi thử.
import type { Metadata } from 'next';

import { HomeBehavior } from './home-behavior';
import { HomeShell } from './page-shell';

export const metadata: Metadata = {
  title: 'Trang chủ — Aver Learning',
  robots: { index: false, follow: false },
};

export default function HomePage() {
  return (
    <>
      {/* Chrome chung. Layout chỉ NẠP script; phần tử phải do từng trang dựng —
          bài học PR #897, thiếu dòng này là mất toàn bộ điều hướng mà build vẫn xanh. */}
      {/* @ts-ignore */}
      <aver-chrome active="home" />
      <HomeShell />
      <HomeBehavior />
    </>
  );
}

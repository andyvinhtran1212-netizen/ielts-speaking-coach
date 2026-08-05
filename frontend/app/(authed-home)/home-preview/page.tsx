// Trang chủ học viên trên Next — dark-launch tại `/home-preview`.
//
// VÌ SAO KHÔNG DỰNG THẲNG Ở `/home`: `next.config.ts:56` đã có rewrite
// `{ source: '/home', destination: '/pages/home.html' }`. Dựng route Next ở
// `/home` sẽ bị rewrite che, và cổng route-ownership chặn đúng ca đó
// ("app route /home is SHADOWED by config source /home"). Gỡ rewrite trong
// cùng một thay đổi thì đó là CUTOVER, không còn là dark-launch. Nên đi đúng
// khuôn pilot 3: dựng ở đường riêng, cutover sau khi vỏ + hành vi đã xong.
//
// TRẠNG THÁI: DARK-LAUNCH, ĐÃ CÓ VỎ + HÀNH VI. `home-behavior.tsx` port
// `public/js/home.js` và gọi đúng 3 API cần đăng nhập của bản legacy:
// `/api/student/home-summary`, `/api/student/permissions`,
// `/api/class/me?summary=true`. KHÔNG trang nào trỏ tới route này và
// `/pages/home.html` vẫn là canonical cho tới khi cutover (gỡ rewrite
// `next.config.ts:56` trong cùng một thay đổi).
//
// VÌ SAO TÁCH LÀM HAI BƯỚC: giữ diff đủ nhỏ để đọc được — markup và logic là
// hai loại lỗi khác nhau, gộp một PR thì chúng lẫn vào nhau.
//
// ĐÍNH CHÍNH (đo 2026-08-05): bản đầu của chú thích này nói "vỏ kiểm được bằng
// cổng parity G1". SAI. `pages/home.html` có auth gate ở cuối trang —
// `window.location.href = '../login.html'` khi không có phiên — nên trình duyệt
// ẩn danh KHÔNG BAO GIỜ dừng lại ở trang đó. Đo thật: sau khi JS chạy, URL là
// `/login.html` và `.mock-start` không tồn tại.
//
// ⇒ G1 hiện cho `/home` **con số không**, không phải "chỉ so được vỏ". Muốn có
// bất kỳ phủ sóng parity nào cho trang này thì phải dựng **authed-G1** (tiêm
// phiên Supabase vào context trình duyệt trước khi điều hướng). Từ `/home` trở
// đi mọi trang lưu lượng cao đều cần đăng nhập, nên đây không phải ca cá biệt.
import type { Metadata } from 'next';

import { HomeBehavior } from './home-behavior';
import { HomeShell } from './page-shell';

export const metadata: Metadata = {
  title: 'Trang chủ — AverLearning',
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

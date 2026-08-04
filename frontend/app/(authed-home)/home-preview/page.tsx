// Trang chủ học viên trên Next — dark-launch tại `/home-preview`.
//
// VÌ SAO KHÔNG DỰNG THẲNG Ở `/home`: `next.config.ts:56` đã có rewrite
// `{ source: '/home', destination: '/pages/home.html' }`. Dựng route Next ở
// `/home` sẽ bị rewrite che, và cổng route-ownership chặn đúng ca đó
// ("app route /home is SHADOWED by config source /home"). Gỡ rewrite trong
// cùng một thay đổi thì đó là CUTOVER, không còn là dark-launch. Nên đi đúng
// khuôn pilot 3: dựng ở đường riêng, cutover sau khi vỏ + hành vi đã xong.
//
// TRẠNG THÁI: DARK-LAUNCH, MỚI CÓ VỎ. Chưa có tầng hành vi (`home.js` bản legacy
// gọi 3 API cần đăng nhập: `/api/student/home-summary`,
// `/api/student/permissions`, `/api/class/me?summary=true`). Route này hiện
// render vỏ tĩnh với các ô "…"; KHÔNG trang nào trỏ tới nó và `/pages/home.html`
// vẫn là canonical.
//
// VÌ SAO TÁCH LÀM HAI BƯỚC: vỏ kiểm được bằng cổng parity G1 (so chữ, link,
// khối) — làm xong bước này thì mọi sai lệch markup lộ ra TRƯỚC khi động vào
// phần logic. Gộp cả hai vào một PR thì lỗi markup và lỗi logic lẫn vào nhau.
//
// GIỚI HẠN CỦA G1 Ở ĐÂY, nói trước: trang này cần đăng nhập, nên bản ẩn danh
// chỉ render VỎ — G1 so được bố cục/chrome/link/nội dung tĩnh, KHÔNG so được số
// liệu do API trả về. Từ `/home` trở đi mọi trang lưu lượng cao đều như vậy.
import type { Metadata } from 'next';

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
    </>
  );
}

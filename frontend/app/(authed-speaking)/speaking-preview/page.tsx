// Trang Speaking trên Next — dark-launch tại `/speaking-preview`.
//
// VÌ SAO KHÔNG DỰNG THẲNG Ở `/speaking`: `next.config.ts` đã có rewrite
// `{ source: '/speaking', destination: '/pages/speaking.html' }`. Dựng route
// Next ở `/speaking` sẽ bị rewrite che, và cổng route-ownership chặn đúng ca đó.
// Gỡ rewrite trong cùng một thay đổi thì đó là CUTOVER, không còn là dark-launch.
// Đi đúng khuôn `/home`: dựng ở đường riêng, cutover sau khi vỏ + hành vi xong.
//
// TRẠNG THÁI: MỚI CÓ VỎ (PR 1/3). Hành vi legacy là 1736 dòng JS nội tuyến —
// chia làm hai PR sau: phần lõi (chọn part, sinh câu hỏi, điều hướng sang
// practice) rồi phần thống kê (2 biểu đồ Chart.js + lịch sử).
//
// LƯU Ý PHỦ SÓNG: cổng parity G1 so CHỮ, LINK, KHỐI — nó KHÔNG thấy nội dung
// bên trong `<canvas>`. Hai biểu đồ Chart.js của trang này vì vậy nằm NGOÀI tầm
// parity, và phải nói rõ điều đó ở PR cutover thay vì để người đọc suy ra "cổng
// xanh nghĩa là mọi thứ khớp".
import type { Metadata } from 'next';

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
    </>
  );
}

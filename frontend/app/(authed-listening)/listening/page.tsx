// Trang Listening (trang chính) trên Next — `/listening`.
//
// Nhóm trang CHỈ-ĐỌC: KHÔNG port hành vi. Logic nằm trong ES module legacy
// `/js/listening-landing.js` và bản Next nạp ĐÚNG tệp đó — cùng một tệp cho cả hai vế.
//
// THỨ TỰ CASCADE ở đây là bản sao chính xác của trang legacy:
//   tokens → components (khung) → listening.css (layout) → tailwind → CSS trang
// Tailwind phải đứng TRƯỚC CSS của trang. Bốn shelf trong cùng nhóm thì ngược
// lại — chúng KHÔNG nạp tailwind — nên hai thứ này là việc của TỪNG TRANG chứ
// không đặt được ở layout dùng chung.
import type { Metadata } from 'next';

import { ListeningLandingShell } from './page-shell';

export const metadata: Metadata = {
  // Byte-faithful với <title> của bản legacy
  title: 'Listening — Aver Learning',
  robots: { index: false, follow: false },
};

export default function ListeningLandingPage() {
  return (
    <>
      <link rel="stylesheet" href="/css/tailwind.build.css" />
      {/* Chrome chung. Layout chỉ NẠP script; phần tử phải do từng trang dựng. */}
      {/* @ts-ignore */}
      <aver-chrome active="listening" />
      <ListeningLandingShell />
      {/* CHÍNH tệp bản legacy dùng. */}
      <script type="module" src="/js/listening-landing.js" />
    </>
  );
}

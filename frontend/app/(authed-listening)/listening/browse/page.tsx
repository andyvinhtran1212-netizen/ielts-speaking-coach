// Trang Kho bài nghe trên Next — `/listening/browse`.
//
// Nhóm trang CHỈ-ĐỌC: KHÔNG port hành vi. Logic nằm trong ES module legacy
// `/js/listening-browse.js` và bản Next nạp ĐÚNG tệp đó — cùng một tệp cho cả hai vế.
//
// THỨ TỰ CASCADE ở đây là bản sao chính xác của trang legacy:
//   tokens → components (khung) → listening.css (layout) → tailwind → CSS trang
// Tailwind phải đứng TRƯỚC CSS của trang. Bốn shelf trong cùng nhóm thì ngược
// lại — chúng KHÔNG nạp tailwind — nên hai thứ này là việc của TỪNG TRANG chứ
// không đặt được ở layout dùng chung.
import type { Metadata } from 'next';
import HydratedSignal from '@/components/hydrated-signal';
import LegacyModule from '@/components/legacy-module';
import { watchdogScript } from '@/lib/watchdog-script';

import { ListeningBrowseShell } from './page-shell';

export const metadata: Metadata = {
  // Byte-faithful với <title> của bản legacy
  title: 'Kho bài nghe — Aver Learning',
  robots: { index: false, follow: false },
};

export default function ListeningBrowsePage() {
  return (
    <>
      <link rel="stylesheet" href="/css/tailwind.build.css" />
      <link rel="stylesheet" href="/css/listening-browse.css" />
      {/* Chrome chung. Layout chỉ NẠP script; phần tử phải do từng trang dựng. */}
      <HydratedSignal />
      {/* @ts-ignore */}
      <aver-chrome active="listening" />
      <ListeningBrowseShell />
      {/* CHÍNH tệp bản legacy dùng. */}
      <LegacyModule src="/js/listening-browse.js" />
      {/* Duong lui khi chunk React hong han: useEffect khong chay thi script
          khong duoc chen va trang dung im vinh vien. Script nay chay NGOAI
          React va chi dieu huong, khong dung DOM. */}
      <script dangerouslySetInnerHTML={{ __html: watchdogScript('/pages/listening-browse.html') }} />
    </>
  );
}

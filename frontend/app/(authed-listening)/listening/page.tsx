// Trang Listening (trang chính) trên Next — `/listening`.
//
// THỨ TỰ CASCADE ở đây là bản sao chính xác của trang legacy:
//   tokens → components (khung) → listening.css (layout) → tailwind → CSS trang
// Tailwind phải đứng TRƯỚC CSS của trang. Bốn shelf trong cùng nhóm thì ngược
// lại — chúng KHÔNG nạp tailwind — nên hai thứ này là việc của TỪNG TRANG chứ
// không đặt được ở layout dùng chung.
import type { Metadata } from 'next';

import { ListeningLandingShell } from './page-shell';
import { ListeningLandingBehavior } from './listening-landing-behavior';

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
      <ListeningLandingShell>
        <ListeningLandingBehavior />
      </ListeningLandingShell>
    </>
  );
}

// Trang Kho bài nghe trên Next — `/listening/browse`.
//
// THỨ TỰ CASCADE ở đây là bản sao chính xác của trang legacy:
//   tokens → components (khung) → listening.css (layout) → tailwind → CSS trang
// Tailwind phải đứng TRƯỚC CSS của trang. Bốn shelf trong cùng nhóm thì ngược
// lại — chúng KHÔNG nạp tailwind — nên hai thứ này là việc của TỪNG TRANG chứ
// không đặt được ở layout dùng chung.
import type { Metadata } from 'next';

import { ListeningBrowseBehavior } from './listening-browse-behavior';
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
      {/* @ts-ignore */}
      <aver-chrome active="listening" />
      <ListeningBrowseShell>
        <ListeningBrowseBehavior />
      </ListeningBrowseShell>
    </>
  );
}

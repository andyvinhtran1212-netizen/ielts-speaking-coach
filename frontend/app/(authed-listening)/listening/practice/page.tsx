// Trang Luyện nhanh trên Next — `/listening/practice`.
//
// Nhóm trang CHỈ-ĐỌC: KHÔNG có tầng hành vi. Logic nằm trong ES module legacy
// `/js/listening-practice.js` và bản Next nạp ĐÚNG tệp đó — không chép dòng nào, nên hai vế không
// thể lệch, và sửa một chỗ là cả hai cùng đổi.
//
// CSS RIÊNG của trang nhả ở ĐÂY chứ không ở layout: bốn trang trong nhóm định
// nghĩa lại cùng những selector, nạp chung thì tệp cuối thắng. Nó đứng SAU
// `listening.css` của layout — đúng thứ tự bản legacy.
//
// `/pages/listening-practice.html` vẫn trả 200 và đó là CỐ Ý: cổng parity chỉ so được khi
// cả hai vế còn sống.
import type { Metadata } from 'next';

import { ListeningPracticeShell } from './page-shell';

export const metadata: Metadata = {
  // Byte-faithful với <title> của bản legacy
  title: 'Luyện nhanh — Aver Learning',
  robots: { index: false, follow: false },
};

export default function ListeningPracticePage() {
  return (
    <>
      <link rel="stylesheet" href="/css/listening-practice.css" />
      {/* Chrome chung. Layout chỉ NẠP script; phần tử phải do từng trang dựng. */}
      {/* @ts-ignore */}
      <aver-chrome active="listening" />
      <ListeningPracticeShell />
      {/* CHÍNH tệp bản legacy dùng. `type="module"` nên nó hoãn tới sau khi parse
          — cùng thời điểm với bản legacy, vốn đặt thẻ này cuối <body>. */}
      <script type="module" src="/js/listening-practice.js" />
    </>
  );
}

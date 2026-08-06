// Trang Cambridge IELTS Full Tests trên Next — `/listening/tests`.
//
// Nhóm trang CHỈ-ĐỌC: KHÔNG có tầng hành vi. Toàn bộ logic nằm trong ES module
// legacy `/js/listening-tests-list.js` và bản Next nạp ĐÚNG tệp đó — không chép một dòng nào, nên
// không có cơ hội hai vế lệch nhau, và sửa một chỗ là cả hai cùng đổi.
//
// `/pages/listening-tests.html` vẫn trả 200 và đó là CỐ Ý: cổng parity chỉ so được khi
// cả hai vế còn sống. Gỡ bản legacy thuộc Phase 7.
import type { Metadata } from 'next';

import { ListeningTestsShell } from './page-shell';

export const metadata: Metadata = {
  // Byte-faithful với <title> của bản legacy
  title: 'Cambridge IELTS Full Tests — Aver Learning',
  robots: { index: false, follow: false },
};

export default function ListeningTestsPage() {
  return (
    <>
      {/* Chrome chung. Layout chỉ NẠP script; phần tử phải do từng trang dựng. */}
      {/* @ts-ignore */}
      <aver-chrome active="listening" />
      <ListeningTestsShell />
      {/* CHÍNH tệp bản legacy dùng. `type="module"` nên nó hoãn tới sau khi
          parse xong — cùng thời điểm với bản legacy, vốn đặt thẻ này cuối <body>. */}
      <script type="module" src="/js/listening-tests-list.js" />
    </>
  );
}

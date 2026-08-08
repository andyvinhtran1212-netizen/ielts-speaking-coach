// Trang Mini Tests trên Next — `/reading/mini-test`.
//
// Nhóm trang CHỈ-ĐỌC: KHÔNG có tầng hành vi. Toàn bộ logic nằm trong ES module
// legacy `/js/reading-mini-test.js` và bản Next nạp ĐÚNG tệp đó — không chép một dòng nào, nên
// không có cơ hội hai vế lệch nhau, và sửa một chỗ là cả hai cùng đổi.
//
// `/pages/reading-mini-test.html` vẫn trả 200 và đó là CỐ Ý: cổng parity chỉ so được khi
// cả hai vế còn sống. Gỡ bản legacy thuộc Phase 7.
import type { Metadata } from 'next';
import HydratedSignal from '@/components/hydrated-signal';
import LegacyModule from '@/components/legacy-module';
import { watchdogScript } from '@/lib/watchdog-script';

import { ReadingMiniTestShell } from './page-shell';

export const metadata: Metadata = {
  // Byte-faithful với <title> của bản legacy
  title: 'Mini Tests — Aver Learning',
  robots: { index: false, follow: false },
};

export default function ReadingMiniTestPage() {
  return (
    <>
      {/* Chrome chung. Layout chỉ NẠP script; phần tử phải do từng trang dựng. */}
      <HydratedSignal />
      {/* @ts-ignore */}
      <aver-chrome active="reading" />
      <ReadingMiniTestShell />
      {/* CHÍNH tệp bản legacy dùng. `type="module"` nên nó hoãn tới sau khi
          parse xong — cùng thời điểm với bản legacy, vốn đặt thẻ này cuối <body>. */}
      {/* TAI SOM, CHAY MUON. Truoc ban va, the <script> tinh nam trong HTML
          may chu nen trinh duyet tai module SONG SONG voi moi thu khac. Doi
          sang chen bang useEffect thi luot tai do bi day lui toi tan sau khi
          hydrate, va noi dung xuat hien muon han - cong parity bat duoc dung
          dieu do o /listening/skills va /reading/vocab ([unstable-extraction]).
          modulepreload tra lai luot tai song song ma van giu thu tu THUC THI. */}
      <link rel="modulepreload" href="/js/reading-mini-test.js" />
      <LegacyModule src="/js/reading-mini-test.js" />
      {/* Duong lui khi chunk React hong han: useEffect khong chay thi script
          khong duoc chen va trang dung im vinh vien. Script nay chay NGOAI
          React va chi dieu huong, khong dung DOM. */}
      <script dangerouslySetInnerHTML={{ __html: watchdogScript('/pages/reading-mini-test.html') }} />
    </>
  );
}

// Trang Skill Practice trên Next — `/reading/skill`.
//
// Nhóm trang CHỈ-ĐỌC: KHÔNG có tầng hành vi. Toàn bộ logic nằm trong ES module
// legacy `/js/reading-skill.js` và bản Next nạp ĐÚNG tệp đó — không chép một dòng nào, nên
// không có cơ hội hai vế lệch nhau, và sửa một chỗ là cả hai cùng đổi.
//
// `/pages/reading-skill.html` vẫn trả 200 và đó là CỐ Ý: cổng parity chỉ so được khi
// cả hai vế còn sống. Gỡ bản legacy thuộc Phase 7.
import type { Metadata } from 'next';
import HydratedSignal from '@/components/hydrated-signal';
import LegacyModule from '@/components/legacy-module';
import { watchdogScript } from '@/lib/watchdog-script';

import { ReadingSkillShell } from './page-shell';

export const metadata: Metadata = {
  // Byte-faithful với <title> của bản legacy
  title: 'Skill Practice — Aver Learning',
  robots: { index: false, follow: false },
};

export default function ReadingSkillPage() {
  return (
    <>
      {/* Chrome chung. Layout chỉ NẠP script; phần tử phải do từng trang dựng. */}
      <HydratedSignal />
      {/* @ts-ignore */}
      <aver-chrome active="reading" />
      <ReadingSkillShell />
      {/* CHÍNH tệp bản legacy dùng. `type="module"` nên nó hoãn tới sau khi
          parse xong — cùng thời điểm với bản legacy, vốn đặt thẻ này cuối <body>. */}
      <LegacyModule src="/js/reading-skill.js" />
      {/* Duong lui khi chunk React hong han: useEffect khong chay thi script
          khong duoc chen va trang dung im vinh vien. Script nay chay NGOAI
          React va chi dieu huong, khong dung DOM. */}
      <script dangerouslySetInnerHTML={{ __html: watchdogScript('/pages/reading-skill.html') }} />
    </>
  );
}

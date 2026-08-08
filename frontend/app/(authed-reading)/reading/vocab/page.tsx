// Trang Vocab Reading trên Next — `/reading/vocab`.
//
// THÍ ĐIỂM cho nhóm trang CHỈ-ĐỌC. Khảo sát 52 trang học viên còn lại: 21 trang
// không phát ra request ghi nào (đã kiểm cả script rời chúng nạp, không chỉ
// script nội tuyến — bản đếm đầu tiên chỉ đọc inline nên xếp nhầm cả
// `practice.html` vào nhóm chỉ-đọc). Những trang đó gần như không có JS nội
// tuyến: logic nằm trong ES module ở `public/js/`.
//
// Hệ quả: port = markup + nạp lại ĐÚNG module cũ. Không chép logic ⇒ không có
// cơ hội lệch, và sửa một chỗ là cả hai vế cùng đổi. Rẻ hơn hẳn
// `/writing/dashboard` (~1540 dòng JS nội tuyến buộc phải port tay, và bản port
// đó dính 4 lỗi phải vá).
//
// TÍNH NGUYÊN TỬ: trang này KHÔNG có rewrite nào để gỡ (đã kiểm `next.config.ts`),
// nên chỉ cần thêm route. `/pages/reading-vocab.html` vẫn trả 200 — cổng parity
// cần cả hai vế còn sống.
import type { Metadata } from 'next';
import HydratedSignal from '@/components/hydrated-signal';
import LegacyModule from '@/components/legacy-module';
import { watchdogScript } from '@/lib/watchdog-script';

import { ReadingVocabShell } from './page-shell';

export const metadata: Metadata = {
  // Byte-faithful với <title> của bản legacy
  title: 'Vocab Reading — Aver Learning',
  robots: { index: false, follow: false },
};

export default function ReadingVocabPage() {
  return (
    <>
      {/* Chrome chung. Layout chỉ NẠP script; phần tử phải do từng trang dựng. */}
      <HydratedSignal />
      {/* @ts-ignore */}
      <aver-chrome active="reading" />
      <ReadingVocabShell />
      {/* CHÍNH tệp bản legacy dùng, không phải bản chép. `type="module"` nên nó
          hoãn tới sau khi parse xong — cùng thời điểm với bản legacy, vốn đặt
          thẻ này ở cuối <body>. */}
      {/* TAI SOM, CHAY MUON. Truoc ban va, the <script> tinh nam trong HTML
          may chu nen trinh duyet tai module SONG SONG voi moi thu khac. Doi
          sang chen bang useEffect thi luot tai do bi day lui toi tan sau khi
          hydrate, va noi dung xuat hien muon han - cong parity bat duoc dung
          dieu do o /listening/skills va /reading/vocab ([unstable-extraction]).
          modulepreload tra lai luot tai song song ma van giu thu tu THUC THI. */}
      <link rel="modulepreload" href="/js/reading-vocab.js" />
      <LegacyModule src="/js/reading-vocab.js" />
      {/* Duong lui khi chunk React hong han: useEffect khong chay thi script
          khong duoc chen va trang dung im vinh vien. Script nay chay NGOAI
          React va chi dieu huong, khong dung DOM. */}
      <script dangerouslySetInnerHTML={{ __html: watchdogScript('/pages/reading-vocab.html') }} />
    </>
  );
}

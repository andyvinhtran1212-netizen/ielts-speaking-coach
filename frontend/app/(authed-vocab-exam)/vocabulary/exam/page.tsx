// Trang Từ vựng luyện thi trên Next — `/vocabulary/exam`.
//
// KHÔNG cần vòng chờ `getSupabase()` như hai trang vocab ở #958 — nhưng LÝ DO
// không phải cái tôi tưởng lúc đầu. Tôi viết "module tự chống `readyState`";
// review cục bộ chỉ ra là sai: nạp bằng `defer` thì script chạy lúc
// `readyState === 'interactive'`, nên nó đi THẲNG vào `boot()` chứ không đăng
// ký `DOMContentLoaded` bao giờ.
//
// Lý do THẬT, kiểm được: `/js/vocab-exam.js` KHÔNG hề đụng Supabase (0 lần
// nhắc), và `/api/vocabulary/exam` là endpoint PUBLIC — không nhận
// `authorization` (`backend/routers/vocabulary.py:85`). Ràng buộc duy nhất là
// `api.js` phải chạy trước, mà khung nạp nó bằng `defer` ở `<head>` nên luôn
// đúng thứ tự.
//
// Ghi đúng lý do là quan trọng: mô hình sai ("cứ tự chống readyState là xong")
// sẽ được áp cho trang sau — mà trang sau có thể CẦN token.
//
// THỨ TỰ CASCADE bám bản legacy: tokens → components (khung) → tailwind (khung)
// → `vocab-exam.css` (ở ĐÂY). CSS trang phải đứng SAU tailwind, mà
// `pageStylesheets` của khung lại chèn TRƯỚC — nên nó nhả từ page, không từ layout.
import type { Metadata } from 'next';

import { VocabExamShell } from './page-shell';

export const metadata: Metadata = {
  // Byte-faithful với <title> của bản legacy
  title: 'Từ vựng luyện thi — Aver Learning',
  robots: { index: false, follow: false },
};

export default function VocabExamPage() {
  return (
    <>
      <link rel="stylesheet" href="/css/vocab-exam.css" />
      {/* Chrome chung. Layout chỉ NẠP script; phần tử phải do từng trang dựng. */}
      {/* @ts-ignore */}
      <aver-chrome active="vocabulary" />
      <VocabExamShell />
      {/* CHÍNH tệp bản legacy dùng, không phải bản chép. */}
      <script src="/js/vocab-exam.js" defer />
    </>
  );
}

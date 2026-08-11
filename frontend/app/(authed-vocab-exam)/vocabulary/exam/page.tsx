// Trang Từ vựng luyện thi trên Next — `/vocabulary/exam`.
//
// THỨ TỰ CASCADE bám bản legacy: tokens → components (khung) → tailwind (khung)
// → `vocab-exam.css` (ở ĐÂY). CSS trang phải đứng SAU tailwind, mà
// `pageStylesheets` của khung lại chèn TRƯỚC — nên nó nhả từ page, không từ layout.
import type { Metadata } from 'next';

import { VocabExamShell } from './page-shell';

export const metadata: Metadata = {
  // Byte-faithful với <title> của bản legacy
  title: 'Từ vựng luyện thi',
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
    </>
  );
}

// Trang Vocab Reading trên Next — `/reading/vocab`.
import type { Metadata } from 'next';
import { Suspense } from 'react';

import { ReadingVocabBehavior } from './reading-vocab-behavior';

export const metadata: Metadata = {
  // Byte-faithful với <title> của bản legacy
  title: 'Vocab Reading — Aver Learning',
  robots: { index: false, follow: false },
};

export default function ReadingVocabPage() {
  return (
    <>
      {/* Chrome chung. Layout chỉ NẠP script; phần tử phải do từng trang dựng. */}
      {/* @ts-ignore */}
      <aver-chrome active="reading" />
      <Suspense fallback={<div role="status">Đang khôi phục lựa chọn…</div>}><ReadingVocabBehavior /></Suspense>
    </>
  );
}

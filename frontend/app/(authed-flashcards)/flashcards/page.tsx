// Trang Flashcards trên Next — `/flashcards`.
//
import type { Metadata } from 'next';

import { FlashcardsBehavior } from './flashcards-behavior';

export const metadata: Metadata = {
  // Byte-faithful với <title> của bản legacy
  title: 'Flashcards — Aver Learning',
  robots: { index: false, follow: false },
};

export default function FlashcardsPage() {
  return (
    <>
      {/* Chrome chung. Layout chỉ NẠP script; phần tử phải do từng trang dựng. */}
      {/* @ts-ignore */}
      <aver-chrome active="vocabulary" />
      <FlashcardsBehavior />
    </>
  );
}

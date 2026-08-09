// Trang Vocab Reading trên Next — `/reading/vocab`.
import type { Metadata } from 'next';

import { ReadingVocabShell } from './page-shell';
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
      <ReadingVocabShell>
        <ReadingVocabBehavior />
      </ReadingVocabShell>
    </>
  );
}

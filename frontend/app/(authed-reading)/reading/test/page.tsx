// Trang Full Tests trên Next — `/reading/test`.
import type { Metadata } from 'next';

import { ReadingTestShell } from './page-shell';
import { ReadingTestBehavior } from './reading-test-behavior';

export const metadata: Metadata = {
  // Byte-faithful với <title> của bản legacy
  title: 'Full Tests — Aver Learning',
  robots: { index: false, follow: false },
};

export default function ReadingTestPage() {
  return (
    <>
      {/* Chrome chung. Layout chỉ NẠP script; phần tử phải do từng trang dựng. */}
      {/* @ts-ignore */}
      <aver-chrome active="reading" />
      <ReadingTestShell>
        <ReadingTestBehavior />
      </ReadingTestShell>
    </>
  );
}

import type { Metadata } from 'next';

import { ReadingMiniTestBehavior } from './reading-mini-test-behavior';

export const metadata: Metadata = {
  // Byte-faithful với <title> của bản legacy
  title: 'Mini Tests — Aver Learning',
  robots: { index: false, follow: false },
};

export default function ReadingMiniTestPage() {
  return (
    <>
      {/* @ts-ignore */}
      <aver-chrome active="reading" />
      <ReadingMiniTestBehavior />
    </>
  );
}

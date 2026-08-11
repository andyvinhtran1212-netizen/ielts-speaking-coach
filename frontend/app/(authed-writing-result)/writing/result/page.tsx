import type { Metadata } from 'next';
import { Suspense } from 'react';

import { WritingResultBehavior, WritingResultLoading } from './writing-result-behavior';

export const metadata: Metadata = {
  title: 'Phân tích bài viết — Aver Learning',
  robots: { index: false, follow: false },
};

export default function WritingResultPage() {
  return (
    <>
      {/* @ts-ignore — canonical chrome is a shared Web Component. */}
      <aver-chrome active="writing" />
      <Suspense fallback={<WritingResultLoading />}>
        <WritingResultBehavior />
      </Suspense>
    </>
  );
}

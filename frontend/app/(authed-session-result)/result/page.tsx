import type { Metadata } from 'next';
import { Suspense } from 'react';

import { SessionResultBehavior, SessionResultLoading } from './session-result-behavior';

export const metadata: Metadata = {
  title: 'Kết quả luyện tập — Aver Learning',
  robots: { index: false, follow: false },
};

export default function SessionResultPage() {
  return (
    <>
      {/* @ts-ignore — Aver chrome là Web Component dùng chung với legacy. */}
      <aver-chrome active="speaking" />
      <Suspense fallback={<SessionResultLoading />}>
        <SessionResultBehavior />
      </Suspense>
    </>
  );
}

// Trang "Kết quả thi thử" (phiếu điểm TRF) trên Next — `/mock/result`.
//
// Behavior đã được port sang React trong `mock-result-behavior.tsx`; route
// không còn inject `/js/mock-result.js`, nên soft navigation không phụ thuộc
// DOMContentLoaded, hydration timing hay watchdog legacy.
import type { Metadata } from 'next';
import { Suspense } from 'react';

import { MockResultBehavior, MockResultLoading } from './mock-result-behavior';

export const metadata: Metadata = {
  title: 'Kết quả thi thử — Aver Learning',
  robots: { index: false, follow: false },
};

export default function MockResultPage() {
  return (
    <>
      {/* @ts-ignore — Aver chrome là Web Component dùng chung với legacy. */}
      <aver-chrome active="home" />
      <Suspense fallback={<MockResultLoading />}>
        <MockResultBehavior />
      </Suspense>
    </>
  );
}

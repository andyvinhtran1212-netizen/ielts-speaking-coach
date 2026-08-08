// Trang "Nhận xét Speaking" trên Next — `/speaking/result`.
//
// Behavior đã được port sang React trong `speaking-result-behavior.tsx`; route
// không còn inject `/js/speaking-result.js`, nên có thể vào bằng App Router soft
// navigation mà không phụ thuộc DOMContentLoaded hay watchdog legacy.
import type { Metadata } from 'next';
import { Suspense } from 'react';

import {
  SpeakingResultBehavior,
  SpeakingResultLoading,
} from './speaking-result-behavior';

export const metadata: Metadata = {
  title: 'Nhận xét Speaking — Aver Learning',
  robots: { index: false, follow: false },
};

export default function SpeakingResultPage() {
  return (
    <>
      {/* @ts-ignore — Aver chrome là Web Component dùng chung với legacy. */}
      <aver-chrome active="home" />
      <Suspense fallback={<SpeakingResultLoading />}>
        <SpeakingResultBehavior />
      </Suspense>
    </>
  );
}

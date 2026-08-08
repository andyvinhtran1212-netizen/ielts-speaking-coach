// Trang "Thống kê luyện tập" trên Next — `/quiz/progress`.
//
// Behavior đã được port sang React trong `quiz-progress-behavior.tsx`; route
// không còn inject `/js/quiz-progress.js`, nên có thể vào bằng App Router soft
// navigation mà không phụ thuộc DOMContentLoaded hay watchdog legacy.
import type { Metadata } from 'next';
import { Suspense } from 'react';

import {
  QuizProgressBehavior,
  QuizProgressLoading,
} from './quiz-progress-behavior';

export const metadata: Metadata = {
  title: 'Thống kê luyện tập',
  robots: { index: false, follow: false },
};

export default function QuizProgressPage() {
  return (
    <>
      {/* @ts-ignore — Aver chrome là Web Component dùng chung với legacy. */}
      <aver-chrome active="vocabulary" />
      <Suspense fallback={<QuizProgressLoading />}>
        <QuizProgressBehavior />
      </Suspense>
    </>
  );
}

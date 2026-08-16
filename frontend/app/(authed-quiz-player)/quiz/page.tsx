import type { Metadata } from 'next';
import { Suspense } from 'react';

import { QuizPlayer, QuizPlayerLoading } from './quiz-player';

export const metadata: Metadata = {
  title: 'Quick-Check',
  robots: { index: false, follow: false },
};

export default function QuizPage() {
  return (
    <Suspense fallback={<QuizPlayerLoading />}>
      <QuizPlayer />
    </Suspense>
  );
}

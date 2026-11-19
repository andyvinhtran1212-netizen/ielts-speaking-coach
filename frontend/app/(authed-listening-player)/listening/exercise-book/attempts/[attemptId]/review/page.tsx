import type { Metadata } from 'next';
import { Suspense } from 'react';

import { LearnerReview } from '@/components/exercise-book/exercise-book-review';
import { ExerciseBookApiProvider } from '@/lib/exercise-book/api-context';

export const metadata: Metadata = { title: 'Tự đối chiếu — Aver Learning', robots: { index: false, follow: false } };

async function ExerciseBookReviewRoute({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params;
  return <ExerciseBookApiProvider><LearnerReview attemptId={attemptId} /></ExerciseBookApiProvider>;
}

export default function ExerciseBookReviewPage({ params }: { params: Promise<{ attemptId: string }> }) {
  return (
    <Suspense fallback={<main className="programme-runner" role="status">Đang tải phần tự đối chiếu…</main>}>
      <ExerciseBookReviewRoute params={params} />
    </Suspense>
  );
}

import type { Metadata } from 'next';
import { Suspense } from 'react';

import { ExerciseBookRunner } from '@/components/exercise-book/exercise-book-runner';
import { ExerciseBookApiProvider } from '@/lib/exercise-book/api-context';

export const metadata: Metadata = { title: 'Làm bài sách bài tập — Aver Learning', robots: { index: false, follow: false } };

async function ExerciseBookRunnerRoute({ params, searchParams }: {
  params: Promise<{ testId: string }>;
  searchParams: Promise<{ class_item?: string | string[] }>;
}) {
  const [{ testId }, query] = await Promise.all([params, searchParams]);
  const classItem = typeof query.class_item === 'string' && query.class_item ? query.class_item : null;
  return <ExerciseBookApiProvider><ExerciseBookRunner testId={testId} classItem={classItem} /></ExerciseBookApiProvider>;
}

export default function ExerciseBookRunnerPage(props: {
  params: Promise<{ testId: string }>;
  searchParams: Promise<{ class_item?: string | string[] }>;
}) {
  return (
    <Suspense fallback={<main className="programme-runner" role="status">Đang mở activity…</main>}>
      <ExerciseBookRunnerRoute {...props} />
    </Suspense>
  );
}

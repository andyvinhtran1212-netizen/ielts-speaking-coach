import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AssignedGrammarLesson } from './workspace';

export const metadata: Metadata = {
  title: 'Bài Grammar được giao · AverLearning',
  robots: { index: false, follow: false },
};

export default function AssignedGrammarLessonPage() {
  return <>
    <link rel="stylesheet" href="/css/assigned-grammar-lesson.css" />
    <aver-chrome active="grammar"></aver-chrome>
    <Suspense fallback={<main className="agl-shell" role="status">Đang tải bài Grammar…</main>}>
      <AssignedGrammarLesson />
    </Suspense>
  </>;
}

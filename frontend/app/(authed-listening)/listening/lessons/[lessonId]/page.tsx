import type { Metadata } from 'next';
import { Suspense } from 'react';

import { ListeningLessonDetail } from './lesson-detail';

export const metadata: Metadata = { title: 'Bài học Listening — Aver Learning', robots: { index: false, follow: false } };

async function ListeningLessonRoute({ params }: { params: Promise<{ lessonId: string }> }) {
  const { lessonId } = await params;
  return <>{/* @ts-ignore */}<aver-chrome active="listening" /><ListeningLessonDetail lessonId={lessonId} /></>;
}

export default function ListeningLessonPage({ params }: { params: Promise<{ lessonId: string }> }) {
  return (
    <Suspense fallback={<main className="lp-shell"><div className="lp-state" role="status">Đang mở bài học…</div></main>}>
      <ListeningLessonRoute params={params} />
    </Suspense>
  );
}

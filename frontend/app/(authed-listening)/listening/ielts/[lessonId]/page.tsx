import type { Metadata } from 'next';
import { Suspense } from 'react';

import { ListeningLessonDetail } from '../../lessons/[lessonId]/lesson-detail';

export const metadata: Metadata = { title: 'IELTS Listening Practice — Aver Learning', robots: { index: false, follow: false } };

async function IeltsLessonRoute({ params }: { params: Promise<{ lessonId: string }> }) {
  const { lessonId } = await params;
  return <>{/* @ts-ignore */}<aver-chrome active="listening" /><ListeningLessonDetail lessonId={lessonId} /></>;
}

export default function IeltsLessonPage({ params }: { params: Promise<{ lessonId: string }> }) {
  return <Suspense fallback={<main className="lp-shell"><div className="lp-state" role="status">Đang mở bài học…</div></main>}><IeltsLessonRoute params={params} /></Suspense>;
}

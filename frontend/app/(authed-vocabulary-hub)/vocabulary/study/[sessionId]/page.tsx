import { Suspense } from 'react';
import { VocabularyStudy } from './study';
export const metadata = { title: 'Học bộ từ — Aver Learning', robots: { index: false, follow: false } };
async function Content({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <><aver-chrome active="vocabulary" /><VocabularyStudy sessionId={sessionId} /></>;
}

export default function Page(props: { params: Promise<{ sessionId: string }> }) { return <Suspense fallback={<p role="status">Đang tải…</p>}><Content {...props} /></Suspense>; }

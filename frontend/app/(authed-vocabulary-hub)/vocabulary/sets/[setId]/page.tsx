import { Suspense } from 'react';
import { VocabularySetDetail } from './set-detail';
export const metadata = { title: 'Bộ từ — Aver Learning', robots: { index: false, follow: false } };
async function Content({ params }: { params: Promise<{ setId: string }> }) {
  const { setId } = await params;
  return <><aver-chrome active="vocabulary" /><VocabularySetDetail setId={setId} /></>;
}

export default function Page(props: { params: Promise<{ setId: string }> }) { return <Suspense fallback={<p role="status">Đang tải…</p>}><Content {...props} /></Suspense>; }

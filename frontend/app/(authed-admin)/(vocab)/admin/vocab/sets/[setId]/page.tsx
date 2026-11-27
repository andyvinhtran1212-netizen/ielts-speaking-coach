import { Suspense } from 'react';
import { AdminAccessGate } from '@/components/admin-access-gate';
import { AdminVocabularySetEditor } from '../sets-console';
export const metadata = { title: 'Biên tập bộ từ · Admin', robots: { index: false, follow: false } };
async function Content({ params }: { params: Promise<{ setId: string }> }) {
  const { setId } = await params;
  return <aver-admin-chrome active="vocab"><AdminAccessGate><AdminVocabularySetEditor setId={setId} /></AdminAccessGate></aver-admin-chrome>;
}

export default function Page(props: { params: Promise<{ setId: string }> }) { return <Suspense fallback={<p role="status">Đang tải…</p>}><Content {...props} /></Suspense>; }

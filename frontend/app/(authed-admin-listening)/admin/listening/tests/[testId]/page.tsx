import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { AdminListeningTestDetail } from './admin-listening-test-detail';

export const metadata: Metadata = {
  title: 'Listening test detail · Admin',
  description: 'Kiểm định cấu trúc, audio, map assets và lifecycle của Listening test bundle.',
  robots: { index: false, follow: false },
};

async function TestDetailRoute({ params }: { params: Promise<{ testId: string }> }) {
  const { testId } = await params;
  return <aver-admin-chrome active="listening" subsection="tests"><AdminAccessGate><AdminListeningTestDetail testId={testId} /></AdminAccessGate></aver-admin-chrome>;
}

export default function AdminListeningTestDetailPage({ params }: { params: Promise<{ testId: string }> }) {
  return <Suspense fallback={<main className="altd-shell"><div className="altd-state" role="status">Đang mở Listening test…</div></main>}><TestDetailRoute params={params} /></Suspense>;
}

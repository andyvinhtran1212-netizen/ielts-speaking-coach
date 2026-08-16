import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';

import { AdminListeningContentDetail } from './admin-listening-content-detail';

export const metadata: Metadata = {
  title: 'Chi tiết nội dung Listening · Admin',
  robots: { index: false, follow: false },
};

async function DetailRoute({ params }: { params: Promise<{ contentId: string }> }) {
  const { contentId } = await params;
  return <aver-admin-chrome active="listening" subsection="content"><AdminAccessGate><AdminListeningContentDetail contentId={contentId} /></AdminAccessGate></aver-admin-chrome>;
}

export default function AdminListeningContentDetailPage({ params }: { params: Promise<{ contentId: string }> }) {
  return <Suspense fallback={<main className="ald-shell"><div className="ald-state" role="status">Đang mở nội dung Listening…</div></main>}><DetailRoute params={params} /></Suspense>;
}

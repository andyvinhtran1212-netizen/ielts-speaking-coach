import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';

import { AdminClassDetail } from './admin-class-detail';

export const metadata: Metadata = {
  title: 'Chi tiết lớp · Admin',
  robots: { index: false, follow: false },
};

async function AdminClassDetailRoute({ params }: { params: Promise<{ cohortId: string }> }) {
  const { cohortId } = await params;
  return (
    <aver-admin-chrome active="classes" subsection="classes">
      <AdminAccessGate>
        <AdminClassDetail cohortId={cohortId} />
      </AdminAccessGate>
    </aver-admin-chrome>
  );
}

export default function AdminClassDetailPage({ params }: { params: Promise<{ cohortId: string }> }) {
  return (
    <Suspense fallback={<main className="acd-shell"><div className="acd-state" role="status">Đang mở lớp…</div></main>}>
      <AdminClassDetailRoute params={params} />
    </Suspense>
  );
}

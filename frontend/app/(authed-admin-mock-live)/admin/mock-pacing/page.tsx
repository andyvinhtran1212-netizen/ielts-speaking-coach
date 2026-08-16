import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { AdminMockPacing } from './admin-mock-pacing';

export const metadata: Metadata = {
  title: 'Nhịp làm bài · Admin',
  robots: { index: false, follow: false },
};

async function AdminMockPacingBody({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const sittingId = typeof params.sitting === 'string' ? params.sitting : '';
  return (
    <aver-admin-chrome active="mock-tests" subsection="live">
      <AdminAccessGate>
        <AdminMockPacing sittingId={sittingId} />
      </AdminAccessGate>
    </aver-admin-chrome>
  );
}

export default function AdminMockPacingPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <Suspense fallback={<div className="adm-access-state adm-access-state--loading" role="status"><p className="adm-access-state__message">Đang dựng nhịp làm bài…</p></div>}><AdminMockPacingBody searchParams={searchParams} /></Suspense>;
}

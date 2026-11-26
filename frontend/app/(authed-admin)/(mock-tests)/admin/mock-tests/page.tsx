import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { AdminMockTests } from './admin-mock-tests';

export const metadata: Metadata = {
  title: 'Mock Test · Admin',
  robots: { index: false, follow: false },
};

async function AdminMockTestsBody({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const requested = Array.isArray(query.tab) ? query.tab[0] : query.tab;
  const subsection = requested === 'review' || requested === 'writing' ? requested : 'manage';
  return (
    <aver-admin-chrome active="mock-tests" subsection={subsection}>
      <AdminAccessGate>
        <AdminMockTests />
      </AdminAccessGate>
    </aver-admin-chrome>
  );
}

export default function AdminMockTestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <Suspense fallback={<div className="adm-access-state adm-access-state--loading" role="status">Đang mở Mock Test cockpit…</div>}><AdminMockTestsBody searchParams={searchParams} /></Suspense>;
}

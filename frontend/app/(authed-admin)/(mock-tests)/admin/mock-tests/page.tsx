import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { AdminMockTests } from './admin-mock-tests';
import { MockExamList } from './mock-exam-list';

export const metadata: Metadata = {
  title: 'Mock Test · Admin',
  robots: { index: false, follow: false },
};

async function AdminMockTestsBody({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const view = Array.isArray(query.view) ? query.view[0] : query.view;
  // MOCKORG-0086 FR-140 (G09-T32): with the new admin frame the page is the
  // exam list. The console stays reachable at ?view=console until the
  // one-exam page (G09-T34) replaces it.
  if (process.env.ADMIN_FRAME_V2 === '1' && view !== 'console') {
    return (
      <aver-admin-chrome active="mock-tests" subsection="manage">
        <AdminAccessGate>
          <MockExamList />
        </AdminAccessGate>
      </aver-admin-chrome>
    );
  }
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

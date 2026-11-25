import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { AdminMockExams } from './admin-mock-exams';

export const metadata: Metadata = {
  title: 'Quản lý đề Mock Test · Admin',
  robots: { index: false, follow: false },
};

async function AdminMockExamsBody({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const embed = params.embed === '1';
  return (
    <aver-admin-chrome active="mock-tests" subsection="manage" embed={embed ? '' : undefined}>
      <AdminAccessGate>
        <AdminMockExams />
      </AdminAccessGate>
    </aver-admin-chrome>
  );
}

export default function AdminMockExamsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <Suspense fallback={<div className="adm-access-state adm-access-state--loading" role="status"><p className="adm-access-state__message">Đang mở quản lý đề thi…</p></div>}><AdminMockExamsBody searchParams={searchParams} /></Suspense>;
}

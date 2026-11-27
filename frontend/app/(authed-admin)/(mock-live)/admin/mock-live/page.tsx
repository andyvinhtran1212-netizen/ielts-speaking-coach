import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { AdminMockLive } from './admin-mock-live';

export const metadata: Metadata = {
  title: 'Phòng thi trực tiếp · Admin',
  robots: { index: false, follow: false },
};

async function AdminMockLiveBody({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const examId = typeof params.exam_id === 'string' ? params.exam_id : '';
  const embed = params.embed === '1';
  return (
    <aver-admin-chrome active="mock-tests" subsection="live" embed={embed ? '' : undefined}>
      <AdminAccessGate>
        <AdminMockLive initialExamId={examId} embedded={embed} />
      </AdminAccessGate>
    </aver-admin-chrome>
  );
}

export default function AdminMockLivePage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <Suspense fallback={<div className="adm-access-state adm-access-state--loading" role="status"><p className="adm-access-state__message">Đang mở phòng thi…</p></div>}><AdminMockLiveBody searchParams={searchParams} /></Suspense>;
}

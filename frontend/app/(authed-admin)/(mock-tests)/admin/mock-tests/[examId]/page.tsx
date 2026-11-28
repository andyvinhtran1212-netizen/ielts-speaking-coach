import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { MockExamRecord } from './mock-exam-record';

export const metadata: Metadata = {
  title: 'Kỳ thi · Admin',
  robots: { index: false, follow: false },
};

// MOCKORG-0086 FR-145 (G09-T34): only with the new admin frame (ADMIN_FRAME_V2).
export default async function MockExamRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ examId: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  if (process.env.ADMIN_FRAME_V2 !== '1') notFound();
  const { examId } = await params;
  const { tab } = await searchParams;
  return (
    <aver-admin-chrome active="mock-tests" subsection="manage">
      <AdminAccessGate>
        <MockExamRecord examId={examId} initialTab={typeof tab === 'string' ? tab : null} />
      </AdminAccessGate>
    </aver-admin-chrome>
  );
}

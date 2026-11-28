import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { MockExamSetup } from '../../mock-exam-setup';

export const metadata: Metadata = {
  title: 'Tổ chức kỳ thi · Admin',
  robots: { index: false, follow: false },
};

// MOCKORG-0086 FR-141 (G09-T32): only with the new admin frame (ADMIN_FRAME_V2).
export default async function MockExamSetupPage({ params }: { params: Promise<{ examId: string }> }) {
  if (process.env.ADMIN_FRAME_V2 !== '1') notFound();
  const { examId } = await params;
  return (
    <aver-admin-chrome active="mock-tests" subsection="manage">
      <AdminAccessGate>
        <MockExamSetup examId={examId} />
      </AdminAccessGate>
    </aver-admin-chrome>
  );
}

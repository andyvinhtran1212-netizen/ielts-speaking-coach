import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { requireAdminFrameV2 } from '@/lib/admin-frame-redirect';

import { AdminLearnerProfile } from './admin-learner-profile';

export const metadata: Metadata = {
  title: 'Hồ sơ học viên · Admin',
  robots: { index: false, follow: false },
};

const REF = /^[us]-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AdminLearnerProfilePage({ params }: { params: Promise<{ ref: string }> }) {
  requireAdminFrameV2();
  const { ref } = await params;
  if (!REF.test(ref)) notFound();
  return (
    <aver-admin-chrome active="classes" subsection="students">
      <AdminAccessGate>
        <Suspense fallback={null}>
          <AdminLearnerProfile learnerRef={ref.toLowerCase()} />
        </Suspense>
      </AdminAccessGate>
    </aver-admin-chrome>
  );
}

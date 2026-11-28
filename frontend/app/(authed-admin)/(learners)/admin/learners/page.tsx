import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { requireAdminFrameV2 } from '@/lib/admin-frame-redirect';

import { AdminLearners } from './admin-learners';

export const metadata: Metadata = {
  title: 'Học viên · Admin',
  robots: { index: false, follow: false },
};

export default function AdminLearnersPage() {
  requireAdminFrameV2();
  return (
    <aver-admin-chrome active="classes" subsection="students">
      <AdminAccessGate>
        <Suspense fallback={null}>
          <AdminLearners />
        </Suspense>
      </AdminAccessGate>
    </aver-admin-chrome>
  );
}

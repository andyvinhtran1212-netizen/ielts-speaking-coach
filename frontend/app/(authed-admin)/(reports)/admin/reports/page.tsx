import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { requireAdminFrameV2 } from '@/lib/admin-frame-redirect';

import { AdminReports } from './admin-reports';

export const metadata: Metadata = {
  title: 'Báo cáo · Admin',
  robots: { index: false, follow: false },
};

export default function AdminReportsPage() {
  requireAdminFrameV2();
  return (
    <aver-admin-chrome active="reports">
      <AdminAccessGate>
        <Suspense fallback={null}>
          <AdminReports />
        </Suspense>
      </AdminAccessGate>
    </aver-admin-chrome>
  );
}

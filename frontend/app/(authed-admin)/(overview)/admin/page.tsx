import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';

import { AdminOverview } from './admin-overview';

export const metadata: Metadata = {
  title: 'Tổng quan · Admin',
  robots: { index: false, follow: false },
};

export default function AdminOverviewPage() {
  return (
    <aver-admin-chrome active="overview">
      <AdminAccessGate>
        <Suspense fallback={<div role="status">Đang khôi phục lựa chọn…</div>}><AdminOverview /></Suspense>
      </AdminAccessGate>
    </aver-admin-chrome>
  );
}

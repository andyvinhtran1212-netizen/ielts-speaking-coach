import type { Metadata } from 'next';

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
        <AdminOverview />
      </AdminAccessGate>
    </aver-admin-chrome>
  );
}

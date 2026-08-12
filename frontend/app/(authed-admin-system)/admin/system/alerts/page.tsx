import type { Metadata } from 'next';

import { AdminAccessGate } from '@/components/admin-access-gate';

import { AdminAlerts } from './admin-alerts';

export const metadata: Metadata = {
  title: 'Sự cố chấm bài · Admin',
  robots: { index: false, follow: false },
};

export default function AdminAlertsPage() {
  return (
    <aver-admin-chrome active="system" subsection="alerts">
      <AdminAccessGate>
        <AdminAlerts />
      </AdminAccessGate>
    </aver-admin-chrome>
  );
}

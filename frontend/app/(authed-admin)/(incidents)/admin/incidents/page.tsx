import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';

import { AdminIncidents } from './admin-incidents';

export const metadata: Metadata = {
  title: 'Hộp thư sự cố · Admin',
  robots: { index: false, follow: false },
};

export default function AdminIncidentsPage() {
  return (
    <aver-admin-chrome active="error-logs">
      <AdminAccessGate>
        <Suspense fallback={null}>
          <AdminIncidents />
        </Suspense>
      </AdminAccessGate>
    </aver-admin-chrome>
  );
}

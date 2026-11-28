import type { Metadata } from 'next';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { redirectUnderAdminFrameV2 } from '@/lib/admin-frame-redirect';

import { AdminErrorLogs } from './admin-error-logs';

export const metadata: Metadata = {
  title: 'Báo lỗi · Admin',
  robots: { index: false, follow: false },
};

export default function AdminErrorLogsPage() {
  redirectUnderAdminFrameV2('/admin/error-logs');
  return (
    <aver-admin-chrome active="error-logs">
      <AdminAccessGate>
        <AdminErrorLogs />
      </AdminAccessGate>
    </aver-admin-chrome>
  );
}

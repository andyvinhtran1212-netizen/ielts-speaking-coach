import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';

import { AdminWritingRegradeRequests } from './admin-writing-regrade-requests';

export const metadata: Metadata = {
  title: 'Yêu cầu chấm lại Writing · Admin',
  description: 'Duyệt yêu cầu chấm lại theo trạng thái canonical.',
  robots: { index: false, follow: false },
};

export default function AdminWritingRegradePage() {
  return <aver-admin-chrome active="writing" subsection="regrade-requests">
    <AdminAccessGate>
      <Suspense fallback={<div className="adm-access-state adm-access-state--loading" role="status"><p className="adm-access-state__message">Đang mở hàng yêu cầu chấm lại…</p></div>}>
        <AdminWritingRegradeRequests />
      </Suspense>
    </AdminAccessGate>
  </aver-admin-chrome>;
}

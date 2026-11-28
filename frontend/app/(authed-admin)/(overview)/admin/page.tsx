import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';

import { AdminOverview } from './admin-overview';
import { AdminTodo } from './admin-todo';

export const metadata: Metadata = {
  title: 'Tổng quan · Admin',
  robots: { index: false, follow: false },
};

export default function AdminOverviewPage() {
  // ADMINIA-0074 FR-090: under the new frame /admin is "Việc cần làm"
  // (G09-T18b). With ADMIN_FRAME_V2 off the old overview opens as before.
  const todo = process.env.ADMIN_FRAME_V2 === '1';
  return (
    <aver-admin-chrome active="overview">
      <AdminAccessGate>
        {todo ? <AdminTodo /> : (
          <Suspense fallback={<div role="status">Đang khôi phục lựa chọn…</div>}><AdminOverview /></Suspense>
        )}
      </AdminAccessGate>
    </aver-admin-chrome>
  );
}

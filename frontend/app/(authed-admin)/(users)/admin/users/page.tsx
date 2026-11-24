import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';

import { AdminUsers } from './admin-users';

export const metadata: Metadata = {
  title: 'Người dùng · Admin',
  robots: { index: false, follow: false },
};

// `?tab=codes` never reaches this page: next.config.ts sends it to
// /admin/activation-codes with a 307 (ADMINIA-0074 FR-048).
export default function AdminUsersPage() {
  return (
    <aver-admin-chrome active="users">
      <Suspense fallback={<div className="adm-access-state adm-access-state--loading" role="status"><p className="adm-access-state__message">Đang mở khu vực quản trị tài khoản…</p></div>}>
        <AdminAccessGate>
          <AdminUsers />
        </AdminAccessGate>
      </Suspense>
    </aver-admin-chrome>
  );
}

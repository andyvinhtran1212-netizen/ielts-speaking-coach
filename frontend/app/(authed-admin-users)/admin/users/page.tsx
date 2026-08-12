import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';

import { AdminUsers } from './admin-users';

export const metadata: Metadata = {
  title: 'Người dùng & Mã kích hoạt · Admin',
  robots: { index: false, follow: false },
};

async function AdminUsersBody({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const initialTab = params.tab === 'codes' ? 'codes' : 'users';
  return (
    <AdminAccessGate>
      <AdminUsers initialTab={initialTab} />
    </AdminAccessGate>
  );
}

export default function AdminUsersPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <aver-admin-chrome active="users">
      <Suspense fallback={<div className="adm-access-state adm-access-state--loading" role="status"><p className="adm-access-state__message">Đang mở khu vực quản trị tài khoản…</p></div>}>
        <AdminUsersBody searchParams={searchParams} />
      </Suspense>
    </aver-admin-chrome>
  );
}

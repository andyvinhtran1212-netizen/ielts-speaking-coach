import type { Metadata } from 'next';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { redirectUnderAdminFrameV2 } from '@/lib/admin-frame-redirect';

import { AdminStudentsDirectory } from './admin-students-directory';

export const metadata: Metadata = {
  title: 'Học viên · Lớp & Học viên · Admin',
  robots: { index: false, follow: false },
};

export default async function AdminStudentsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  redirectUnderAdminFrameV2('/admin/students', { q: typeof params.q === 'string' ? params.q : undefined });
  return (
    <aver-admin-chrome active="classes" subsection="students">
      <AdminAccessGate>
        <AdminStudentsDirectory />
      </AdminAccessGate>
    </aver-admin-chrome>
  );
}

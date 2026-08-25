import type { Metadata } from 'next';

import { AdminAccessGate } from '@/components/admin-access-gate';

import { AdminClassesDirectory } from './admin-classes-directory';

export const metadata: Metadata = {
  title: 'Lớp & Học viên · Admin',
  robots: { index: false, follow: false },
};

export default function AdminClassesPage() {
  return (
    <aver-admin-chrome active="classes" subsection="classes">
      <AdminAccessGate>
        <AdminClassesDirectory />
      </AdminAccessGate>
    </aver-admin-chrome>
  );
}

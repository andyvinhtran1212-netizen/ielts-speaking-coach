import type { Metadata } from 'next';

import { AdminAccessGate } from '@/components/admin-access-gate';

import { AdminStudentsDirectory } from './admin-students-directory';

export const metadata: Metadata = {
  title: 'Học viên · Lớp & Học viên · Admin',
  robots: { index: false, follow: false },
};

export default function AdminStudentsPage() {
  return (
    <aver-admin-chrome active="classes" subsection="students">
      <AdminAccessGate>
        <AdminStudentsDirectory />
      </AdminAccessGate>
    </aver-admin-chrome>
  );
}

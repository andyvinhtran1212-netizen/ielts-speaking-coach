import type { Metadata } from 'next';

import { AdminAccessGate } from '@/components/admin-access-gate';

import { AdminInstructors } from './admin-instructors';

export const metadata: Metadata = {
  title: 'Giảng viên · Admin',
  robots: { index: false, follow: false },
};

export default function AdminInstructorsPage() {
  return (
    <aver-admin-chrome active="instructors">
      <AdminAccessGate>
        <AdminInstructors />
      </AdminAccessGate>
    </aver-admin-chrome>
  );
}

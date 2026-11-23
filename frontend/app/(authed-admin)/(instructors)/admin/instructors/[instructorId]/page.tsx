import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';

import { AdminInstructorProfile } from './admin-instructor-profile';

export const metadata: Metadata = {
  title: 'Hồ sơ giảng viên · Admin',
  robots: { index: false, follow: false },
};

async function AdminInstructorProfileRoute({ params }: { params: Promise<{ instructorId: string }> }) {
  const { instructorId } = await params;
  return (
    <aver-admin-chrome active="instructors">
      <AdminAccessGate>
        <AdminInstructorProfile instructorId={instructorId} />
      </AdminAccessGate>
    </aver-admin-chrome>
  );
}

export default function AdminInstructorProfilePage({ params }: { params: Promise<{ instructorId: string }> }) {
  return (
    <Suspense fallback={<main className="ain-shell"><div className="ain-state" role="status">Đang mở hồ sơ giảng viên…</div></main>}>
      <AdminInstructorProfileRoute params={params} />
    </Suspense>
  );
}

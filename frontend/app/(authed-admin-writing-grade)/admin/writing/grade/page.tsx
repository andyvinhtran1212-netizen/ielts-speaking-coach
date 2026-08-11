import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';

import { AdminWritingGradeBehavior, AdminWritingGradeLoading } from './writing-grade-behavior';

export const metadata: Metadata = {
  title: 'Review + Edit — Writing Coach Admin',
  robots: { index: false, follow: false },
};

export default function AdminWritingGradePage() {
  return (
    <aver-admin-chrome active="writing" subsection="queue">
      <AdminAccessGate>
        <Suspense fallback={<AdminWritingGradeLoading />}>
          <AdminWritingGradeBehavior />
        </Suspense>
      </AdminAccessGate>
    </aver-admin-chrome>
  );
}

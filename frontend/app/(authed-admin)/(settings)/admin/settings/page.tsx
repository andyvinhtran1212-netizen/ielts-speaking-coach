import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { requireAdminFrameV2 } from '@/lib/admin-frame-redirect';

import { AdminSettings } from './admin-settings';

export const metadata: Metadata = {
  title: 'Cài đặt · Admin',
  robots: { index: false, follow: false },
};

// Admin only (AdminAccessGate: a teacher sees the frame's denied state); the
// API itself requires AAL2 for every write.
export default function AdminSettingsPage() {
  requireAdminFrameV2();
  return (
    <aver-admin-chrome active="system">
      <AdminAccessGate>
        <Suspense fallback={null}>
          <AdminSettings />
        </Suspense>
      </AdminAccessGate>
    </aver-admin-chrome>
  );
}

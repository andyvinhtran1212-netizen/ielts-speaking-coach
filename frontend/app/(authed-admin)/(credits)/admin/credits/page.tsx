import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';

import { AdminCredits } from './admin-credits';

export const metadata: Metadata = {
  title: 'Lượt AI · Admin',
  robots: { index: false, follow: false },
};

export default function AdminCreditsPage() {
  // A page of the new frame (G09-T08): 404 while ADMIN_FRAME_V2 is off. The
  // same check moves to lib/admin-frame-redirect.ts once #2561 lands.
  if (process.env.ADMIN_FRAME_V2 !== '1') notFound();
  return (
    <aver-admin-chrome active="access-codes">
      <AdminAccessGate>
        <Suspense fallback={null}>
          <AdminCredits />
        </Suspense>
      </AdminAccessGate>
    </aver-admin-chrome>
  );
}

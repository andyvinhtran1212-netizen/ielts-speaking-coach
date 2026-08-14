import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { AdminListeningTests } from './admin-listening-tests';

export const metadata: Metadata = {
  title: 'Listening tests · Admin',
  description: 'Kiểm định Cambridge bundles, audio và phạm vi hiển thị của kho Listening.',
  robots: { index: false, follow: false },
};

export default function AdminListeningTestsPage() {
  return <aver-admin-chrome active="listening" subsection="tests"><AdminAccessGate><Suspense fallback={<main className="alt-shell"><div className="alt-state" role="status">Đang mở kho test…</div></main>}><AdminListeningTests /></Suspense></AdminAccessGate></aver-admin-chrome>;
}

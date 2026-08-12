import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { AdminReadingAttempts } from './admin-reading-attempts';

export const metadata: Metadata = {
  title: 'Reading · Lượt làm bài · Admin',
  robots: { index: false, follow: false },
};

export default function AdminReadingAttemptsPage() {
  return <aver-admin-chrome active="overview" subsection="reading-attempts"><AdminAccessGate><Suspense fallback={<main className="ara-shell"><div className="ara-state" role="status">Đang chuẩn bị bộ lọc dữ liệu…</div></main>}><AdminReadingAttempts /></Suspense></AdminAccessGate></aver-admin-chrome>;
}

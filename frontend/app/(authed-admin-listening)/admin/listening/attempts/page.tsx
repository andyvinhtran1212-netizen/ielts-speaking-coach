import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { AdminListeningAttempts } from './admin-listening-attempts';

export const metadata: Metadata = {
  title: 'Lượt làm bài Listening · Admin',
  description: 'Đối chiếu lượt làm bài Listening và kết quả từng câu trên dữ liệu canonical.',
  robots: { index: false, follow: false },
};

export default function AdminListeningAttemptsPage() {
  return <aver-admin-chrome active="listening" subsection="attempts">
    <AdminAccessGate>
      <Suspense fallback={<main className="ala-shell"><div className="ala-state" role="status">Đang mở lịch sử Listening…</div></main>}>
        <AdminListeningAttempts />
      </Suspense>
    </AdminAccessGate>
  </aver-admin-chrome>;
}

import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { AdminListeningDictation } from './admin-listening-dictation';

export const metadata: Metadata = {
  title: 'Báo cáo chép chính tả · Admin',
  description: 'Đối chiếu phiên chép chính tả, từng câu và xu hướng lỗi trên dữ liệu canonical.',
  robots: { index: false, follow: false },
};

export default function AdminListeningDictationPage() {
  return <aver-admin-chrome active="listening" subsection="dictation-reports">
    <AdminAccessGate>
      <Suspense fallback={<main className="aldict-shell"><div className="aldict-state" role="status">Đang mở báo cáo chép chính tả…</div></main>}>
        <AdminListeningDictation />
      </Suspense>
    </AdminAccessGate>
  </aver-admin-chrome>;
}

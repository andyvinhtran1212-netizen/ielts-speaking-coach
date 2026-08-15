import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';
import HydratedSignal from '@/components/hydrated-signal';
import { watchdogScript } from '@/lib/watchdog-script';

import { AdminListeningAudit } from './admin-listening-audit';

export const metadata: Metadata = {
  title: 'Audit chất lượng · Admin Listening',
  description: 'Đối chiếu live structural health và full-audit đã lưu cho toàn bộ test Listening.',
  robots: { index: false, follow: false },
};

export default function AdminListeningAuditPage() {
  return <>
    <HydratedSignal />
    <script dangerouslySetInnerHTML={{ __html: watchdogScript('/pages/admin/listening/audit.html') }} />
    <aver-admin-chrome active="listening" subsection="audit">
      <AdminAccessGate>
        <Suspense fallback={<main className="alqa-shell"><div className="alqa-state" role="status">Đang mở quality audit…</div></main>}>
          <AdminListeningAudit />
        </Suspense>
      </AdminAccessGate>
    </aver-admin-chrome>
  </>;
}

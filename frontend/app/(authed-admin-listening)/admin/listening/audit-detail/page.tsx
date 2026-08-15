import type { Metadata } from 'next';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';

import { AdminAccessGate } from '@/components/admin-access-gate';
import HydratedSignal from '@/components/hydrated-signal';
import LegacyModule from '@/components/legacy-module';
import { watchdogScript } from '@/lib/watchdog-script';

import { AdminListeningAuditDetail } from './admin-listening-audit-detail';

export const metadata: Metadata = {
  title: 'Audit workspace · Admin Listening',
  description: 'Đối chiếu, sửa và triage một Listening test bằng dữ liệu canonical.',
  robots: { index: false, follow: false },
};

async function AuditDetailRoute({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const id = String((await searchParams).id || '').trim();
  if (!id) redirect('/admin/listening/audit');
  return <aver-admin-chrome active="listening" subsection="audit">
    <AdminAccessGate><AdminListeningAuditDetail testId={id} /></AdminAccessGate>
  </aver-admin-chrome>;
}

export default function AdminListeningAuditDetailPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  return <>
    <HydratedSignal />
    <script dangerouslySetInnerHTML={{ __html: watchdogScript('/pages/admin/listening/audit-detail.html') }} />
    <LegacyModule src="/js/components/audio-player.js" />
    <Suspense fallback={<main className="alqad-shell"><div className="alqad-state" role="status">Đang mở audit workspace…</div></main>}>
      <AuditDetailRoute searchParams={searchParams} />
    </Suspense>
  </>;
}

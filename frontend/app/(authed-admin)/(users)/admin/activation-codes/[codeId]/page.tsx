import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';

import { AdminActivationCodeDetail } from './admin-activation-code-detail';

export const metadata: Metadata = {
  title: 'Chi tiết mã kích hoạt · Admin',
  robots: { index: false, follow: false },
};

// ADMINIA-0074 FR-055: one code's page; revoking a used code happens only in
// its "Vùng nguy hiểm". FR-048 keeps /admin/activation-codes/new a 404 (codes
// are issued from a class page). Under cacheComponents the AuthedShell
// streams before this page runs, so notFound() here is Next's soft 404:
// HTTP 200 with the not-found boundary and `noindex`, as for unknown Grammar
// articles on production.
export default async function AdminActivationCodeDetailPage({ params }: { params: Promise<{ codeId: string }> }) {
  const { codeId } = await params;
  if (codeId === 'new') notFound();
  return (
    <aver-admin-chrome active="access-codes">
      <Suspense fallback={<div className="adm-access-state adm-access-state--loading" role="status"><p className="adm-access-state__message">Đang mở mã kích hoạt…</p></div>}>
        <AdminAccessGate>
          <AdminActivationCodeDetail codeId={codeId} />
        </AdminAccessGate>
      </Suspense>
    </aver-admin-chrome>
  );
}

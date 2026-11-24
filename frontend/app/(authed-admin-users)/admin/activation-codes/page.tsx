import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';

import { AdminActivationCodes } from './admin-activation-codes';

export const metadata: Metadata = {
  title: 'Mã kích hoạt · Admin',
  robots: { index: false, follow: false },
};

// ADMINIA-0074 FR-048: the activation-code ledger. There is deliberately no
// /admin/activation-codes/new; codes are issued from a class page.
export default function AdminActivationCodesPage() {
  return (
    <aver-admin-chrome active="access-codes">
      <Suspense fallback={<div className="adm-access-state adm-access-state--loading" role="status"><p className="adm-access-state__message">Đang mở sổ mã kích hoạt…</p></div>}>
        <AdminAccessGate>
          <AdminActivationCodes />
        </AdminAccessGate>
      </Suspense>
    </aver-admin-chrome>
  );
}

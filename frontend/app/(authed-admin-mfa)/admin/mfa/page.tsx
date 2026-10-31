import type { Metadata } from 'next';

import { AdminMfa } from './admin-mfa';

export const metadata: Metadata = {
  title: 'Xác thực 2 bước · Admin',
  robots: { index: false, follow: false },
};

// ADMINAAL2-0032 FR-012. Deliberately NOT wrapped in AdminAccessGate: the
// gate sends an AAL1 admin here under enforcement, so wrapping would loop.
// AdminMfa runs its own signed-in + admin + active check.
export default function AdminMfaPage() {
  return (
    <aver-admin-chrome active="mfa">
      <AdminMfa />
    </aver-admin-chrome>
  );
}

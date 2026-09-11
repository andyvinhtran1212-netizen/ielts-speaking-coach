import type { Metadata } from 'next';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { AdminMockCorrections } from './admin-mock-corrections';

export const metadata: Metadata = {
  title: 'Correction performance · Admin',
  robots: { index: false, follow: false },
};

export default function AdminMockCorrectionsPage() {
  return <aver-admin-chrome active="mock-tests" subsection="manage">
    <AdminAccessGate><AdminMockCorrections /></AdminAccessGate>
  </aver-admin-chrome>;
}

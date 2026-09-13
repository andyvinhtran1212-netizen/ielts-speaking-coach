import type { Metadata } from 'next';

import { AdminAccessGate } from '@/components/admin-access-gate';
import HydratedSignal from '@/components/hydrated-signal';

import { AdminListeningFulltestImport } from './admin-listening-fulltest-import';

export const metadata: Metadata = {
  title: 'Import full test · Admin Listening',
  description: 'Kiểm định pack bốn file, xem answer key và ghi test Listening bằng readback canonical.',
  robots: { index: false, follow: false },
};

export default function AdminListeningFulltestImportPage() {
  return <>
    <HydratedSignal />
    <aver-admin-chrome active="listening" subsection="tests">
      <AdminAccessGate><AdminListeningFulltestImport /></AdminAccessGate>
    </aver-admin-chrome>
  </>;
}

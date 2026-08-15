import type { Metadata } from 'next';

import { AdminAccessGate } from '@/components/admin-access-gate';
import HydratedSignal from '@/components/hydrated-signal';
import { watchdogScript } from '@/lib/watchdog-script';

import { AdminListeningDrillImport } from './admin-listening-drill-import';

export const metadata: Metadata = {
  title: 'Import skill drills · Admin Listening',
  description: 'Ghép file theo Test ID, dry-run và ghi tuần tự các Listening skill drill bằng canonical readback.',
  robots: { index: false, follow: false },
};

export default function AdminListeningDrillImportPage() {
  return <>
    <HydratedSignal />
    <script dangerouslySetInnerHTML={{ __html: watchdogScript('/pages/admin/listening/import-drills.html') }} />
    <aver-admin-chrome active="listening" subsection="tests">
      <AdminAccessGate><AdminListeningDrillImport /></AdminAccessGate>
    </aver-admin-chrome>
  </>;
}

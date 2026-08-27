import type { Metadata } from 'next';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { AdminVocabPilotMetrics } from './admin-vocab-pilot-metrics';

export const metadata: Metadata = {
  title: 'Vocab Curated pilot · Admin',
  robots: { index: false, follow: false },
};

export default function AdminVocabPilotMetricsPage() {
  return (
    <aver-admin-chrome active="vocab" subsection="pilot-metrics">
      <AdminAccessGate><AdminVocabPilotMetrics /></AdminAccessGate>
    </aver-admin-chrome>
  );
}

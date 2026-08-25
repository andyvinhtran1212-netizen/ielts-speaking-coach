import type { Metadata } from 'next';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { AdminVocabStats } from './admin-vocab-stats';

export const metadata: Metadata = {
  title: 'Vocabulary stats · Admin',
  robots: { index: false, follow: false },
};

export default function AdminVocabStatsPage() {
  return (
    <aver-admin-chrome active="vocab" subsection="stats">
      <AdminAccessGate><AdminVocabStats /></AdminAccessGate>
    </aver-admin-chrome>
  );
}

import type { Metadata } from 'next';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { AdminVocabEditorial } from './admin-vocab-editorial';

export const metadata: Metadata = {
  title: 'Curated learning units · Admin',
  description: 'Review inbox, version diff và publication controls cho Vocab Curated.',
  robots: { index: false, follow: false },
};

export default function AdminVocabEditorialPage() {
  return (
    <aver-admin-chrome active="vocab" subsection="curated">
      <AdminAccessGate><AdminVocabEditorial /></AdminAccessGate>
    </aver-admin-chrome>
  );
}


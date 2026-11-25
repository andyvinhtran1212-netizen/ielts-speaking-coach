import type { Metadata } from 'next';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { AdminVocabD1Curation } from './admin-vocab-d1-curation';

export const metadata: Metadata = {
  title: 'D1 Curation · Admin',
  robots: { index: false, follow: false },
};

export default function AdminVocabD1CurationPage() {
  return (
    <aver-admin-chrome active="vocab" subsection="d1-curation">
      <AdminAccessGate><AdminVocabD1Curation /></AdminAccessGate>
    </aver-admin-chrome>
  );
}

import type { Metadata } from 'next';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { AdminVocabLemmas } from './admin-vocab-lemmas';

export const metadata: Metadata = {
  title: 'Lemma Overrides · Admin',
  robots: { index: false, follow: false },
};

export default function AdminVocabLemmasPage() {
  return (
    <aver-admin-chrome active="vocab" subsection="lemmas">
      <AdminAccessGate><AdminVocabLemmas /></AdminAccessGate>
    </aver-admin-chrome>
  );
}

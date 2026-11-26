import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { AdminVocabContent } from './admin-vocab-content';

export const metadata: Metadata = { title: 'Kho từ vựng · Admin', robots: { index: false, follow: false } };

export default function AdminVocabContentPage() {
  return <aver-admin-chrome active="vocab" subsection="content"><AdminAccessGate><Suspense fallback={<main className="avv-shell"><div className="avv-state">Đang mở Content workspace…</div></main>}><AdminVocabContent /></Suspense></AdminAccessGate></aver-admin-chrome>;
}

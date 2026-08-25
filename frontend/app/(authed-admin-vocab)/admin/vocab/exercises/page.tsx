import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { AdminVocabExercises } from './admin-vocab-exercises';

export const metadata: Metadata = { title: 'Vocab Exercises · Admin', robots: { index: false, follow: false } };

export default function AdminVocabExercisesPage() {
  return <aver-admin-chrome active="vocab" subsection="exercises"><AdminAccessGate><Suspense fallback={<main className="avv-shell"><div className="avv-state">Đang mở Exercises workspace…</div></main>}><AdminVocabExercises /></Suspense></AdminAccessGate></aver-admin-chrome>;
}

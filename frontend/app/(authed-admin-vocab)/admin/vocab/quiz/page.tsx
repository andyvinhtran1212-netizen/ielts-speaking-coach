import { Suspense } from 'react';
import type { Metadata } from 'next';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { AdminVocabQuizImport } from './admin-vocab-quiz-import';

export const metadata: Metadata = { title: 'Quick-Check Quiz · Admin', robots: { index: false, follow: false } };

export default function AdminVocabQuizPage() {
  return <aver-admin-chrome active="vocab" subsection="quiz"><AdminAccessGate><Suspense fallback={<main className="avv-shell"><div className="avv-state">Đang mở Quiz workspace…</div></main>}><AdminVocabQuizImport /></Suspense></AdminAccessGate></aver-admin-chrome>;
}

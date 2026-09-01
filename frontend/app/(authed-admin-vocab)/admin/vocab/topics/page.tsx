import { Suspense } from 'react';
import type { Metadata } from 'next';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { AdminVocabTopics } from './admin-vocab-topics';

export const metadata: Metadata = { title: 'Chủ đề nội dung · Admin', robots: { index: false, follow: false } };

export default function AdminVocabTopicsPage() {
  return <aver-admin-chrome active="vocab" subsection="topics"><AdminAccessGate><Suspense fallback={<main className="avv-shell"><div className="avv-state">Đang mở Topic workspace…</div></main>}><AdminVocabTopics /></Suspense></AdminAccessGate></aver-admin-chrome>;
}

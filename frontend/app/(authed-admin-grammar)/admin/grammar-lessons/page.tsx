import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminAccessGate } from '@/components/admin-access-gate';
import { GrammarLessonReport } from './report';

export const metadata: Metadata = {
  title: 'Bài Grammar được giao · Admin', robots: { index: false, follow: false },
};

export default function AdminGrammarLessonPage() {
  return <aver-admin-chrome active="grammar"><AdminAccessGate>
    <link rel="stylesheet" href="/css/assigned-grammar-lesson.css" />
    <Suspense fallback={<main className="agl-shell">Đang tải báo cáo…</main>}><GrammarLessonReport /></Suspense>
  </AdminAccessGate></aver-admin-chrome>;
}

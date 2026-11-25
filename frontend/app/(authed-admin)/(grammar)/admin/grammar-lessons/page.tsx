import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { AdminAccessGate } from '@/components/admin-access-gate';
import { redirectNoticeHref, searchParamText } from '@/lib/redirect-notice-model.mjs';
import { GrammarLessonReport } from './report';

export const metadata: Metadata = {
  title: 'Bài Grammar được giao · Admin', robots: { index: false, follow: false },
};

const LOADING = <main className="agl-shell">Đang tải báo cáo…</main>;

async function AdminGrammarLessonBody({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  // G02-T12: a report is opened from a class submission; without one, back to classes.
  if (!searchParamText(params.attempt)) redirect(redirectNoticeHref('/admin/classes'));
  return <aver-admin-chrome active="grammar"><AdminAccessGate>
    <link rel="stylesheet" href="/css/assigned-grammar-lesson.css" />
    <Suspense fallback={LOADING}><GrammarLessonReport /></Suspense>
  </AdminAccessGate></aver-admin-chrome>;
}

export default function AdminGrammarLessonPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <Suspense fallback={LOADING}><AdminGrammarLessonBody searchParams={searchParams} /></Suspense>;
}

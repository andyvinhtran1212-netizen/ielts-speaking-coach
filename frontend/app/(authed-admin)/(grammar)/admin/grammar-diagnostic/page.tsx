import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { redirectNoticeHref, searchParamText } from '@/lib/redirect-notice-model.mjs';
import { GrammarDiagnosticReport } from './report';

export const metadata: Metadata = {
  title: 'Grammar Diagnostic report · Admin',
  robots: { index: false, follow: false },
};

const LOADING = <main className="agdr-shell"><div className="agdr-empty">Đang tải báo cáo…</div></main>;

async function AdminGrammarDiagnosticBody({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  // G02-T12: a report is opened from a class submission; without one, back to classes.
  if (!searchParamText(params.session)) redirect(redirectNoticeHref('/admin/classes'));
  return (
    <aver-admin-chrome active="grammar">
      <AdminAccessGate>
        <link rel="stylesheet" href="/css/admin-grammar-diagnostic.css" />
        <Suspense fallback={LOADING}>
          <GrammarDiagnosticReport />
        </Suspense>
      </AdminAccessGate>
    </aver-admin-chrome>
  );
}

export default function AdminGrammarDiagnosticPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <Suspense fallback={LOADING}><AdminGrammarDiagnosticBody searchParams={searchParams} /></Suspense>;
}

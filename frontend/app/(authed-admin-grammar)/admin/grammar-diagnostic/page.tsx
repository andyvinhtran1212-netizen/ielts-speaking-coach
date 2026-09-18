import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { GrammarDiagnosticReport } from './report';

export const metadata: Metadata = {
  title: 'Grammar Diagnostic report · Admin',
  robots: { index: false, follow: false },
};

export default function AdminGrammarDiagnosticPage() {
  return (
    <aver-admin-chrome active="grammar">
      <AdminAccessGate>
        <link rel="stylesheet" href="/css/admin-grammar-diagnostic.css" />
        <Suspense fallback={<main className="agdr-shell"><div className="agdr-empty">Đang tải báo cáo…</div></main>}>
          <GrammarDiagnosticReport />
        </Suspense>
      </AdminAccessGate>
    </aver-admin-chrome>
  );
}

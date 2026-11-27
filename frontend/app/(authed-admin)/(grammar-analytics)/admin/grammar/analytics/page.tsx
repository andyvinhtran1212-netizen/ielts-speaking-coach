import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { AdminGrammarAnalytics } from './admin-grammar-analytics';

export const metadata: Metadata = {
  title: 'Grammar analytics · Admin',
  description: 'Theo dõi tín hiệu sử dụng canonical của Grammar Wiki.',
  robots: { index: false, follow: false },
};

export default function AdminGrammarAnalyticsPage() {
  return <aver-admin-chrome active="grammar" subsection="analytics">
    <AdminAccessGate>
      <Suspense fallback={<main className="gax-shell"><div className="gax-state" role="status">Đang chuẩn bị Grammar analytics…</div></main>}>
        <AdminGrammarAnalytics />
      </Suspense>
    </AdminAccessGate>
  </aver-admin-chrome>;
}

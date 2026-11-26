import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { AdminGrammarArticles } from './admin-grammar-articles';

export const metadata: Metadata = {
  title: 'Grammar articles · Admin',
  description: 'Tra cứu nội dung canonical và tín hiệu sử dụng của Grammar Wiki.',
  robots: { index: false, follow: false },
};

export default function AdminGrammarArticlesPage() {
  return <aver-admin-chrome active="grammar" subsection="articles">
    <AdminAccessGate>
      <Suspense fallback={<main className="gaa-shell"><div className="gaa-state" role="status">Đang chuẩn bị thư viện nội dung…</div></main>}>
        <AdminGrammarArticles />
      </Suspense>
    </AdminAccessGate>
  </aver-admin-chrome>;
}

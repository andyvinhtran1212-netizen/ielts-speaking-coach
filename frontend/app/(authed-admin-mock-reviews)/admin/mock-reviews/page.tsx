import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { AdminMockReviews } from './admin-mock-reviews';

export const metadata: Metadata = {
  title: 'Duyệt thi thử · Admin',
  robots: { index: false, follow: false },
};

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const examId = typeof params.mock_exam_id === 'string' ? params.mock_exam_id.trim() : '';
  const embed = params.embed === '1';
  return (
    <aver-admin-chrome active="mock-tests" subsection="review" embed={embed ? '' : undefined}>
      <AdminAccessGate><AdminMockReviews examId={examId} embedded={embed} /></AdminAccessGate>
    </aver-admin-chrome>
  );
}

export default function AdminMockReviewsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <Suspense fallback={<div className="adm-access-state adm-access-state--loading" role="status"><p className="adm-access-state__message">Đang mở bàn duyệt…</p></div>}><Body searchParams={searchParams} /></Suspense>;
}

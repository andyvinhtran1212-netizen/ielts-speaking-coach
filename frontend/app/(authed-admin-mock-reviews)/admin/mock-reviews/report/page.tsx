import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { AdminMockReviewReport } from './admin-mock-review-report';

export const metadata: Metadata = {
  title: 'Phiếu báo điểm thi thử · Admin',
  robots: { index: false, follow: false },
};

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const reviewId = typeof params.review_id === 'string' ? params.review_id.trim() : '';
  const examId = typeof params.mock_exam_id === 'string' ? params.mock_exam_id.trim() : '';
  return (
    <aver-admin-chrome active="mock-tests" subsection="review">
      <AdminAccessGate><AdminMockReviewReport reviewId={reviewId} examId={examId} /></AdminAccessGate>
    </aver-admin-chrome>
  );
}

export default function AdminMockReviewReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <Suspense fallback={<div className="adm-access-state adm-access-state--loading" role="status"><p className="adm-access-state__message">Đang dựng phiếu điểm…</p></div>}><Body searchParams={searchParams} /></Suspense>;
}

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { mockTestsHref } from '@/lib/admin-mock-tests-model.mjs';
import { redirectNoticeHref, searchParamText } from '@/lib/redirect-notice-model.mjs';
import { AdminMockReviewReport } from './admin-mock-review-report';

export const metadata: Metadata = {
  title: 'Phiếu báo điểm thi thử · Admin',
  robots: { index: false, follow: false },
};

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const reviewId = searchParamText(params.review_id);
  const examId = searchParamText(params.mock_exam_id);
  // G02-T12: a report link without its review goes back to the review tab.
  if (!reviewId) redirect(redirectNoticeHref(mockTestsHref('review', examId)));
  return (
    <aver-admin-chrome active="mock-tests" subsection="review">
      <AdminAccessGate><AdminMockReviewReport reviewId={reviewId} examId={examId} /></AdminAccessGate>
    </aver-admin-chrome>
  );
}

export default function AdminMockReviewReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <Suspense fallback={<div className="adm-access-state adm-access-state--loading" role="status"><p className="adm-access-state__message">Đang dựng phiếu điểm…</p></div>}><Body searchParams={searchParams} /></Suspense>;
}

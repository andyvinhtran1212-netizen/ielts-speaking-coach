import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { redirectNoticeHref } from '@/lib/redirect-notice-model.mjs';
import { AdminMockReviews } from './admin-mock-reviews';

export const metadata: Metadata = {
  title: 'Duyệt thi thử · Admin',
  robots: { index: false, follow: false },
};

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const examId = typeof params.mock_exam_id === 'string' ? params.mock_exam_id.trim() : '';
  const embed = params.embed === '1';
  // G02-T10 / G09-T02: the bare URL (sidebar, old bookmark) has no exam to
  // review, so send the admin to the review tab of the Mock Test cockpit. The
  // cockpit's iframe always passes `mock_exam_id`, so an embedded frame never
  // lands here and cannot nest the cockpit inside itself.
  if (!examId && !embed) redirect(redirectNoticeHref('/admin/mock-tests?tab=review'));
  return (
    <aver-admin-chrome active="mock-tests" subsection="review" embed={embed ? '' : undefined}>
      <AdminAccessGate><AdminMockReviews examId={examId} embedded={embed} /></AdminAccessGate>
    </aver-admin-chrome>
  );
}

export default function AdminMockReviewsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <Suspense fallback={<div className="adm-access-state adm-access-state--loading" role="status"><p className="adm-access-state__message">Đang mở bàn duyệt…</p></div>}><Body searchParams={searchParams} /></Suspense>;
}

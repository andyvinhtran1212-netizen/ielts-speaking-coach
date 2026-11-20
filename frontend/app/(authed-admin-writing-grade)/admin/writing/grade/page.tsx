import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { writingNavigationHref } from '@/lib/admin-writing-navigation-model.mjs';
import { firstSearchParams, redirectNoticeHref, searchParamText } from '@/lib/redirect-notice-model.mjs';

import { AdminWritingGradeBehavior, AdminWritingGradeLoading } from './writing-grade-behavior';

export const metadata: Metadata = {
  title: 'Chấm Writing · Admin',
  robots: { index: false, follow: false },
};

async function AdminWritingGradeBody({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const embed = params.embed === '1';
  // G02-T12: without an essay, back to the queue it came from (filters kept).
  if (!searchParamText(params.id) && !searchParamText(params.essay_id)) {
    redirect(redirectNoticeHref(writingNavigationHref('queue', firstSearchParams(params))));
  }
  return (
    <aver-admin-chrome active="writing" subsection="queue" embed={embed ? '' : undefined}>
      <AdminAccessGate>
        <Suspense fallback={<AdminWritingGradeLoading />}>
          <AdminWritingGradeBehavior />
        </Suspense>
      </AdminAccessGate>
    </aver-admin-chrome>
  );
}

export default function AdminWritingGradePage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <Suspense fallback={<AdminWritingGradeLoading />}><AdminWritingGradeBody searchParams={searchParams} /></Suspense>;
}

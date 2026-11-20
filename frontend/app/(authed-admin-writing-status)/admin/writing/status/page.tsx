import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { writingStatusHref } from '@/lib/admin-writing-status-model.mjs';
import { firstSearchParams, redirectNoticeHref, searchParamText } from '@/lib/redirect-notice-model.mjs';

import { AdminWritingStatus } from './admin-writing-status';

export const metadata: Metadata = {
  title: 'Tiến trình chấm Writing · Admin',
  description: 'Theo dõi trạng thái canonical của một lượt chấm Writing.',
  robots: { index: false, follow: false },
};

async function AdminWritingStatusBody({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const embed = params.embed === '1';
  // G02-T12: without an essay, back to the queue it came from (filters kept).
  if (!searchParamText(params.essay_id) && !searchParamText(params.id)) {
    redirect(redirectNoticeHref(writingStatusHref('queue', firstSearchParams(params))));
  }
  return <aver-admin-chrome active="writing" subsection="queue" embed={embed ? '' : undefined}>
    <AdminAccessGate><AdminWritingStatus /></AdminAccessGate>
  </aver-admin-chrome>;
}

export default function AdminWritingStatusPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <Suspense fallback={<div className="adm-access-state adm-access-state--loading" role="status"><p className="adm-access-state__message">Đang mở tiến trình chấm…</p></div>}><AdminWritingStatusBody searchParams={searchParams} /></Suspense>;
}

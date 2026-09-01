import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';

import { AdminWritingQueue } from './admin-writing-queue';

export const metadata: Metadata = {
  title: 'Hàng chờ chấm Writing · Admin',
  description: 'Điều phối bài Writing từ chấm AI đến review và trả bài.',
  robots: { index: false, follow: false },
};

async function AdminWritingQueueBody({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const embed = params.embed === '1';
  return (
    <aver-admin-chrome active="writing" subsection="queue" embed={embed ? '' : undefined}>
      <AdminAccessGate><AdminWritingQueue /></AdminAccessGate>
    </aver-admin-chrome>
  );
}

export default function AdminWritingQueuePage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <Suspense fallback={<div className="adm-access-state adm-access-state--loading" role="status"><p className="adm-access-state__message">Đang mở hàng chờ Writing…</p></div>}><AdminWritingQueueBody searchParams={searchParams} /></Suspense>;
}

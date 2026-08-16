import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';

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
  return <aver-admin-chrome active="writing" subsection="queue" embed={embed ? '' : undefined}>
    <AdminAccessGate><AdminWritingStatus /></AdminAccessGate>
  </aver-admin-chrome>;
}

export default function AdminWritingStatusPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <Suspense fallback={<div className="adm-access-state adm-access-state--loading" role="status"><p className="adm-access-state__message">Đang mở tiến trình chấm…</p></div>}><AdminWritingStatusBody searchParams={searchParams} /></Suspense>;
}

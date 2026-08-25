import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminAccessGate } from '@/components/admin-access-gate';
import { AdminWritingInstructorQueue } from './admin-writing-instructor-queue';

export const metadata: Metadata = { title: 'Hàng đợi Instructor · Admin', description: 'Claim, review và trả bài Writing Instructor theo trạng thái canonical.', robots: { index: false, follow: false } };

async function AdminWritingInstructorQueueBody({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams; const embed = params.embed === '1';
  return <aver-admin-chrome active="writing" subsection="instructor-queue" embed={embed ? '' : undefined}><AdminAccessGate><AdminWritingInstructorQueue /></AdminAccessGate></aver-admin-chrome>;
}

export default function AdminWritingInstructorQueuePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <Suspense fallback={<div className="adm-access-state adm-access-state--loading" role="status"><p className="adm-access-state__message">Đang mở hàng đợi Instructor…</p></div>}><AdminWritingInstructorQueueBody searchParams={searchParams} /></Suspense>;
}

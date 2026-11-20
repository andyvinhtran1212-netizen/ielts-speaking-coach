import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { adminReadingPreviewReturnHref } from '@/lib/admin-reading-navigation.mjs';
import { firstSearchParams, redirectNoticeHref, searchParamText } from '@/lib/redirect-notice-model.mjs';
import { AdminReadingPreview } from './admin-reading-preview';

export const metadata: Metadata = {
  title: 'Kiểm định đề Reading · Admin',
  description: 'Kiểm định passage, answer key, lời giải và ảnh sơ đồ của đề Reading.',
  robots: { index: false, follow: false },
};

const BOOT = <div className="arp-boot" role="status">Đang mở workspace kiểm định…</div>;

async function AdminReadingPreviewBody({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  // G02-T12: preview is opened from a test row; without one, back to the library.
  if (!searchParamText(params.test_id)) redirect(redirectNoticeHref(adminReadingPreviewReturnHref(firstSearchParams(params))));
  return <aver-admin-chrome active="reading" subsection="content"><AdminAccessGate><Suspense fallback={BOOT}><AdminReadingPreview /></Suspense></AdminAccessGate></aver-admin-chrome>;
}

export default function AdminReadingPreviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <Suspense fallback={BOOT}><AdminReadingPreviewBody searchParams={searchParams} /></Suspense>;
}

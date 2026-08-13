import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { AdminReadingPreview } from './admin-reading-preview';

export const metadata: Metadata = {
  title: 'Kiểm định đề Reading · Admin',
  description: 'Kiểm định passage, answer key, lời giải và ảnh sơ đồ của đề Reading.',
  robots: { index: false, follow: false },
};

export default function AdminReadingPreviewPage() {
  return <aver-admin-chrome active="reading" subsection="content"><AdminAccessGate><Suspense fallback={<div className="arp-boot" role="status">Đang mở workspace kiểm định…</div>}><AdminReadingPreview /></Suspense></AdminAccessGate></aver-admin-chrome>;
}

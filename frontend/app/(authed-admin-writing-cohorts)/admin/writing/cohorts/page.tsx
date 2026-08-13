import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminAccessGate } from '@/components/admin-access-gate';
import { AdminWritingCohorts } from './admin-writing-cohorts';

export const metadata: Metadata = {
  title: 'Tiến độ Writing theo lớp · Admin',
  description: 'Theo dõi từng lượt giao, trạng thái chấm và trả bài theo lớp.',
  robots: { index: false, follow: false },
};

export default function AdminWritingCohortsPage() {
  return <aver-admin-chrome active="writing" subsection="cohorts"><AdminAccessGate><Suspense fallback={<div className="adm-access-state adm-access-state--loading" role="status"><p className="adm-access-state__message">Đang mở bảng tiến độ lớp…</p></div>}><AdminWritingCohorts /></Suspense></AdminAccessGate></aver-admin-chrome>;
}

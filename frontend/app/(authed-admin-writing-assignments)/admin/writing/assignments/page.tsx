import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminAccessGate } from '@/components/admin-access-gate';
import { AdminWritingAssignments } from './admin-writing-assignments';

export const metadata: Metadata = { title: 'Gán bài Writing · Admin', description: 'Giao đề Writing theo học viên hoặc lớp với canonical readback.', robots: { index: false, follow: false } };

export default function AdminWritingAssignmentsPage() {
  return <aver-admin-chrome active="writing" subsection="assignments"><AdminAccessGate><Suspense fallback={<div className="adm-access-state adm-access-state--loading" role="status"><p className="adm-access-state__message">Đang mở bàn giao bài…</p></div>}><AdminWritingAssignments /></Suspense></AdminAccessGate></aver-admin-chrome>;
}

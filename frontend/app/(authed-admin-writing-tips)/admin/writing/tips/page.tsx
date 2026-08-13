import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminAccessGate } from '@/components/admin-access-gate';
import { AdminWritingTips } from './admin-writing-tips';

export const metadata: Metadata = { title: 'Mẹo Writing · Admin', description: 'Biên tập, xuất bản và nhập nội dung hỗ trợ Writing.', robots: { index: false, follow: false } };
export default function AdminWritingTipsPage() { return <aver-admin-chrome active="writing" subsection="tips"><AdminAccessGate><Suspense fallback={<div className="adm-access-state adm-access-state--loading" role="status"><p className="adm-access-state__message">Đang mở thư viện mẹo Writing…</p></div>}><AdminWritingTips/></Suspense></AdminAccessGate></aver-admin-chrome>; }

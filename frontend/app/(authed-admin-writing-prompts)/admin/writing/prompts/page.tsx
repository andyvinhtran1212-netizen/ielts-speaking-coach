import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';

import { AdminWritingPrompts } from './admin-writing-prompts';

export const metadata: Metadata = {
  title: 'Kho đề Writing · Admin',
  description: 'Quản lý prompt Writing và duyệt đáp án hình Task 1 Academic.',
  robots: { index: false, follow: false },
};

export default function AdminWritingPromptsPage() {
  return <aver-admin-chrome active="writing" subsection="prompts">
    <AdminAccessGate>
      <Suspense fallback={<div className="adm-access-state adm-access-state--loading" role="status"><p className="adm-access-state__message">Đang mở kho đề Writing…</p></div>}>
        <AdminWritingPrompts />
      </Suspense>
    </AdminAccessGate>
  </aver-admin-chrome>;
}

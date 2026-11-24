import type { Metadata } from 'next';

import { AdminAccessGate } from '@/components/admin-access-gate';

import { AdminQaTools } from './admin-qa-tools';

export const metadata: Metadata = {
  title: 'Công cụ QA · Admin',
  robots: { index: false, follow: false },
};

// ADMINIA-0074 FR-073: internal QA tools, including "Tạo lỗi thử" outside Production.
export default function AdminQaToolsPage() {
  return (
    <aver-admin-chrome active="qa-tools">
      <AdminAccessGate>
        <AdminQaTools />
      </AdminAccessGate>
    </aver-admin-chrome>
  );
}

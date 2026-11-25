import type { Metadata } from 'next';

import { AdminAccessGate } from '@/components/admin-access-gate';

import { AdminAiPanel } from './admin-ai-panel';

export const metadata: Metadata = {
  title: 'AI và mô hình · Admin',
  robots: { index: false, follow: false },
};

// ADMINIA-0074 FR-074: the model table moved here from /admin.
export default function AdminAiModelsPage() {
  return (
    <aver-admin-chrome active="ai-models">
      <AdminAccessGate>
        <main className="aim-shell">
          <header className="aim-header">
            <p className="aim-eyebrow">Hệ thống</p>
            <h1>AI và mô hình</h1>
            <p className="aim-subtitle">
              Model đang dùng cho từng tính năng, lượt gọi và chi phí, lỗi gọi AI. Mỗi lần đổi model cần xác nhận kèm lý do.
            </p>
          </header>
          <AdminAiPanel />
        </main>
      </AdminAccessGate>
    </aver-admin-chrome>
  );
}

import type { Metadata } from 'next';

import { AdminAccessGate } from '@/components/admin-access-gate';

export const metadata: Metadata = {
  title: 'Hệ thống · Admin',
  robots: { index: false, follow: false },
};

export default function AdminSystemPage() {
  return (
    <aver-admin-chrome active="system">
      <AdminAccessGate>
        <main className="sys-shell">
          <header className="sys-header">
            <h1>Hệ thống</h1>
            <p className="subtitle">
              AI usage tracking + alerts. Sprint 12.8 carve cuối cùng từ admin.html monolith.
            </p>
          </header>

          <section className="admin-hub-grid" aria-label="System admin sections">
            <a href="/admin/system/ai-usage" className="admin-hub-card">
              <h3>AI Usage</h3>
              <p className="lede">
                Theo dõi chi phí AI (Claude / Gemini / Whisper / TTS), filter theo cửa sổ
                thời gian, breakdown per-user.
              </p>
              <div className="meta"><span className="adm-status-pill is-live">LIVE</span></div>
            </a>
            <a href="/admin/system/alerts" className="admin-hub-card">
              <h3>Alerts</h3>
              <p className="lede">
                Cảnh báo lỗi gần đây — session errors + grading failures. Xem chi tiết,
                regrade response/session.
              </p>
              <div className="meta"><span className="adm-status-pill is-live">LIVE</span></div>
            </a>
          </section>
        </main>
      </AdminAccessGate>
    </aver-admin-chrome>
  );
}

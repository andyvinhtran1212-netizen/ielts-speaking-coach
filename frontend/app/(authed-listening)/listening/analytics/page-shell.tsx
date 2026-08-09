import type { ReactNode } from 'react';

export function ListeningAnalyticsShell({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <main className="analytics-shell">
        <header className="analytics-header">
          <p className="eyebrow"><a href="/listening" style={{ color: "var(--av-text-secondary)" }}>← Quay lại</a></p>
          <h1>Thống kê <span className="accent">Listening</span></h1>
          <p className="subtitle">
            Theo dõi tiến độ luyện nghe của bạn theo dạng bài và theo thời gian.
          </p>
        </header>

        {children}
      </main>
    </div>
  );
}

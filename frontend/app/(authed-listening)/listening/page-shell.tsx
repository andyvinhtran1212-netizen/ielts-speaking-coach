import type { ReactNode } from 'react';

export function ListeningLandingShell({ children }: { children: ReactNode }) {
  return (
    <div className="shell">

      {/* ── Header ────────────────────────────────────────────────── */}
      <header className="listening-header">
        <p className="eyebrow">Listening practice</p>
        <h1>Luyện nghe</h1>
        <p className="subtitle">
          Tiếp tục bài đang làm, khám phá General Listening hoặc IELTS Listening,
          rồi chọn đúng hình thức luyện phù hợp với thời gian của bạn.
        </p>
      </header>

      {children}
    </div>
  );
}

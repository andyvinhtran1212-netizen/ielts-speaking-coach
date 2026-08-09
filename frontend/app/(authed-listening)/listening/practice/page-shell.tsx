import type { ReactNode } from 'react';

export function ListeningPracticeShell({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="shell">
        <main className="lp-shell">
          <header className="lp-header">
            <p className="eyebrow">
              <a href="/listening" style={{ color: "var(--av-text-secondary)" }}>← Quay lại Listening</a>
            </p>
            <h1>Luyện <span className="accent">nhanh</span></h1>
            <p className="subtitle">
              Bài ngắn 30–90 giây, thông tin dày. Không mô phỏng nhịp phòng thi —
              mục tiêu là bắt đúng chi tiết và nhận ra bẫy, làm được vài bài trong
              lúc chờ.
            </p>
          </header>

          {children}
        </main>
      </div>
    </>
  );
}

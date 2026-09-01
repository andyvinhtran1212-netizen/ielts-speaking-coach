import type { ReactNode } from 'react';

export function ListeningAnalyticsShell({ children }: { children: ReactNode }) {
  return (
    <main className="shell analytics-shell">
      <header className="subpage-header">
        <div className="subpage-header__lhs">
          <a className="subpage-header__back" href="/listening"><span aria-hidden="true">←</span><span>Listening</span></a>
        </div>
      </header>
      <section className="analytics-hero">
        <div>
          <p className="analytics-eyebrow">Tiến độ luyện nghe</p>
          <h1>Biết điểm yếu để luyện đúng bài</h1>
          <p>Đọc xu hướng, xem mức hoàn thành và bắt đầu ngay với dạng bài đang kéo điểm xuống.</p>
        </div>
        <a href="/listening/practice">Luyện ngay <span aria-hidden="true">→</span></a>
      </section>
      {children}
    </main>
  );
}

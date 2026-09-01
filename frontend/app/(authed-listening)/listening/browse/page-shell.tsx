import type { ReactNode } from 'react';

export function ListeningBrowseShell({ children }: { children: ReactNode }) {
  return (
    <main className="shell browse-shell">
      <header className="subpage-header">
        <div className="subpage-header__lhs">
          <a className="subpage-header__back" href="/listening"><span aria-hidden="true">←</span><span>Listening</span></a>
        </div>
      </header>
      <section className="browse-hero">
        <div>
          <p className="browse-eyebrow">Thư viện luyện nghe</p>
          <h1>Tìm bài nghe phù hợp với mục tiêu hôm nay</h1>
          <p>Lọc theo giọng đọc, trình độ và phần thi; sau đó chọn đúng dạng luyện bạn muốn tập trung.</p>
        </div>
        <a href="/listening/analytics">Xem tiến độ <span aria-hidden="true">→</span></a>
      </section>
      {children}
    </main>
  );
}

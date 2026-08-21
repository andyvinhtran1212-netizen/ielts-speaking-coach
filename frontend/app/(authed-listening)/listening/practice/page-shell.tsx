import type { ReactNode } from 'react';

export function ListeningPracticeShell({ children }: { children: ReactNode }) {
  return (
    <main className="shell lp-shell">
      <header className="subpage-header">
        <div className="subpage-header__lhs">
          <a className="subpage-header__back" href="/listening"><span aria-hidden="true">←</span><span>Listening</span></a>
        </div>
      </header>
      <section className="lp-hero">
        <div>
          <p className="lp-eyebrow">Luyện nghe theo mục tiêu</p>
          <h1>Chọn đúng kỹ năng bạn cần cải thiện</h1>
          <p>Bài ngắn 30–90 giây, tập trung vào một loại bẫy hoặc một ngữ cảnh cụ thể. Làm ít nhưng sửa đúng điểm yếu.</p>
        </div>
        <a href="/listening/browse">Mở kho bài nghe <span aria-hidden="true">→</span></a>
      </section>
      {children}
    </main>
  );
}

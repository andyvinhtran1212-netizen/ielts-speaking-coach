import type { ReactNode } from 'react';

export function ListeningLandingShell({ children }: { children: ReactNode }) {
  return (
    <div className="shell">

      {/* ── Header ────────────────────────────────────────────────── */}
      <header className="vocab-header">
        <p className="eyebrow">Listening</p>
        <h1>Luyện nghe <span className="accent">IELTS</span></h1>
        <p className="subtitle">
          Làm đề đầy đủ, luyện 1 section, hoặc khoan sâu vào đúng dạng câu hỏi
          bạn hay sai. Mỗi thẻ hiển thị số bài đang có — thẻ chưa có bài sẽ
          không xuất hiện.
        </p>
      </header>

      {children}
    </div>
  );
}

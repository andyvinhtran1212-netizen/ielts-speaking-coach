import type { ReactNode } from 'react';

export function ListeningTestsShell({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <main className="lt-shell">
        <header className="lt-header">
          <p className="eyebrow"><a href="/listening" style={{ color: 'var(--av-text-secondary)' }}>← Quay lại Listening</a></p>
          <h1>Cambridge IELTS <span className="accent">Full Tests</span></h1>
          <p className="subtitle">
            Bài thi đầy đủ 40 câu trên 4 sections — sát đề thật. Mỗi test kéo dài
            ~30 phút và không thể tua lại audio. Sau khi nộp bài, bạn sẽ nhận
            điểm số, band ước tính và phân tích bẫy đã mắc.
          </p>
        </header>

        {children}
      </main>
    </div>
  );
}

import type { ReactNode } from 'react';

export function ListeningMiniTestShell({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="shell">
        <main className="lt-shell">
          <header className="lt-header">
            <p className="eyebrow"><a href="/listening" style={{ color: "var(--av-text-secondary)" }}>← Quay lại Listening</a></p>
            <h1>Listening <span className="accent">Mini Tests</span></h1>
            <p className="subtitle">
              Bài thi ngắn — 1 section, số câu tùy bài, sát đề thật. Cùng giao diện
              làm bài &amp; chữa bài (kèm nghe lại đúng đoạn audio) như Full Test,
              chấm điểm + band ước tính sau khi nộp.
            </p>
          </header>

          {children}
        </main>
      </div>
    </>
  );
}

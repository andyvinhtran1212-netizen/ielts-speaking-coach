import type { ReactNode } from 'react';

export function ListeningBrowseShell({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <main className="browse-shell">
        <header className="browse-header">
          <p className="eyebrow"><a href="/listening" style={{ color: "var(--av-text-secondary)" }}>← Quay lại</a></p>
          <h1>Kho bài nghe <span className="accent">·</span> <span style={{ color: "var(--av-text-muted)" }}>Browse</span></h1>
          <p className="subtitle">
            Chọn một bài nghe rồi bắt đầu luyện với dạng bài bạn muốn.
          </p>
        </header>

        {children}
      </main>
    </div>
  );
}

import type { ReactNode } from 'react';

export function ReadingMiniTestShell({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <main className="rv-shell">
        <header className="rv-header">
          <p className="eyebrow"><a href="/home" style={{ color: 'var(--av-text-secondary)' }}>← Trang chủ</a></p>
          <h1>Mini Tests <span className="accent">·</span> <span style={{ color: 'var(--av-text-muted)' }}>1 đoạn văn</span></h1>
          <p className="subtitle">Bài thi ngắn — 1 đoạn văn, số câu hỏi tùy bài, kèm bảng điểm + band IELTS. Cùng giao diện làm bài &amp; chữa bài như Full Test.</p>
        </header>

        {/* Library switcher: Vocab ↔ Skill ↔ Full Test ↔ Mini Test. Changed /pages/reading-vocab.html → /reading/vocab */}
        <nav className="rv-libnav" aria-label="Reading libraries">
          <a className="rv-libnav__link" href="/reading/vocab">Vocab Reading</a>
          <a className="rv-libnav__link" href="/reading/skill">Skill Practice</a>
          <a className="rv-libnav__link" href="/reading/test">Full Tests</a>
          <a className="rv-libnav__link is-active" aria-current="page">Mini Tests</a>
        </nav>

        {children}
      </main>
    </div>
  );
}

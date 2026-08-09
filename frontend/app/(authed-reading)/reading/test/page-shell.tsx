// Markup tĩnh của trang Full Tests. `<aver-chrome>` do `page.tsx` dựng;
// behavior React sở hữu filter, request và các trạng thái động bên dưới.
import type { ReactNode } from 'react';

export function ReadingTestShell({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <main className="rv-shell">
        <header className="rv-header">
          <p className="eyebrow"><a href="/home" style={{ color: 'var(--av-text-secondary)' }}>← Trang chủ</a></p>
          <h1>Full Tests <span className="accent">·</span> <span style={{ color: 'var(--av-text-muted)' }}>Cambridge-style</span></h1>
          <p className="subtitle">Bài thi đầy đủ 60 phút — 3 đoạn văn, 40 câu hỏi, kèm bảng điểm + band IELTS.</p>
        </header>

        {/* Library switcher: L1 ↔ L2 ↔ L3 (Sprint 20.6 adds the Full Test entry). Changed /pages/reading-vocab.html → /reading/vocab */}
        <nav className="rv-libnav" aria-label="Reading libraries">
          <a className="rv-libnav__link" href="/reading/vocab">Vocab Reading</a>
          <a className="rv-libnav__link" href="/reading/skill">Skill Practice</a>
          <a className="rv-libnav__link is-active" aria-current="page">Full Tests</a>
          <a className="rv-libnav__link" href="/reading/mini-test">Mini Tests</a>
        </nav>

        {children}
      </main>
    </div>
  );
}

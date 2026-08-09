// Markup tĩnh của trang Skill Practice. `<aver-chrome>` do `page.tsx` dựng;
// behavior React sở hữu bộ lọc, request và các trạng thái động bên dưới.
import type { ReactNode } from 'react';

export function ReadingSkillShell({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <main className="rv-shell">
        <header className="rv-header">
          <p className="eyebrow"><a href="/home" style={{ color: 'var(--av-text-secondary)' }}>← Trang chủ</a></p>
          <h1>Skill Practice <span className="accent">·</span> <span style={{ color: 'var(--av-text-muted)' }}>Luyện kỹ năng</span></h1>
          <p className="subtitle">Chọn một bài luyện theo kỹ năng đọc — skimming, scanning, detail, inference… — và kiểm tra hiểu ngay sau khi đọc.</p>
        </header>

        {/* Library switcher: L1 ↔ L2 ↔ L3 (Sprint 20.6 adds the Full Test entry). Changed /pages/reading-vocab.html → /reading/vocab */}
        <nav className="rv-libnav" aria-label="Reading libraries">
          <a className="rv-libnav__link" href="/reading/vocab">Vocab Reading</a>
          <a className="rv-libnav__link is-active" aria-current="page">Skill Practice</a>
          <a className="rv-libnav__link" href="/reading/test">Full Tests</a>
          <a className="rv-libnav__link" href="/reading/mini-test">Mini Tests</a>
        </nav>

        {children}
      </main>
    </div>
  );
}

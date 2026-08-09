// Markup tĩnh của trang Vocab Reading. `<aver-chrome>` do `page.tsx` dựng;
// behavior React sở hữu bộ lọc, request và các trạng thái động bên dưới.
import type { ReactNode } from 'react';

export function ReadingVocabShell({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <main className="rv-shell">
        <header className="rv-header">
          <p className="eyebrow">
            <a href="/home" style={{ color: 'var(--av-text-secondary)' }}>← Trang chủ</a>
          </p>
          <h1>
            Vocab Reading <span className="accent">·</span>{' '}
            <span style={{ color: 'var(--av-text-muted)' }}>Thư viện</span>
          </h1>
          <p className="subtitle">
            Đọc đoạn văn ngắn, tra từ vựng ngay trong bài, và kiểm tra hiểu nhanh.
          </p>
        </header>

        {/* Library switcher: L1 ↔ L2 ↔ L3 (Sprint 20.6 adds the Full Test entry). */}
        <nav className="rv-libnav" aria-label="Reading libraries">
          <a className="rv-libnav__link is-active" aria-current="page">Vocab Reading</a>
          <a className="rv-libnav__link" href="/reading/skill">Skill Practice</a>
          <a className="rv-libnav__link" href="/reading/test">Full Tests</a>
          <a className="rv-libnav__link" href="/reading/mini-test">Mini Tests</a>
        </nav>

        {children}
      </main>
    </div>
  );
}

// Markup tĩnh của trang Vocab Reading. `<aver-chrome>` do `page.tsx` dựng;
// behavior React sở hữu bộ lọc, request và các trạng thái động bên dưới.
import type { ReactNode } from 'react';

interface ReadingVocabShellProps {
  children: ReactNode;
  totalCount?: number | string;
}

export function ReadingVocabShell({ children, totalCount = '—' }: ReadingVocabShellProps) {
  return (
    <div className="shell">
      <main className="rv-shell">
        <header className="rv-header rv-header--vocab">
          <div className="rv-header__copy">
            <a className="rv-back" href="/home">← Trang chủ</a>
            <p className="rv-kicker">READING LAB · VOCAB</p>
            <h1>Đọc để hiểu, <span>nhớ từ trong ngữ cảnh.</span></h1>
            <p className="subtitle">Bài đọc ngắn có chú giải tại chỗ, giúp bạn gặp từ mới trong câu thật và kiểm tra mức độ hiểu ngay sau khi đọc.</p>
          </div>
          <dl className="rv-header__stats" aria-label="Tổng quan thư viện từ vựng">
            <div><dt id="rv-total-count">{totalCount}</dt><dd>bài đọc</dd></div>
            <div><dt>Trong bài</dt><dd>Tra từ tức thì</dd></div>
            <div><dt>Sau khi đọc</dt><dd>Kiểm tra nhanh</dd></div>
          </dl>
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

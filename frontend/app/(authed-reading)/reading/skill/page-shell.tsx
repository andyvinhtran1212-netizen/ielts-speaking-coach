// Markup tĩnh của trang Skill Practice. `<aver-chrome>` do `page.tsx` dựng;
// behavior React sở hữu bộ lọc, request và các trạng thái động bên dưới.
import type { ReactNode } from 'react';

interface ReadingSkillShellProps {
  children: ReactNode;
  focusCount?: number | string;
  totalCount?: number | string;
}

export function ReadingSkillShell({
  children,
  focusCount = '—',
  totalCount = '—',
}: ReadingSkillShellProps) {
  return (
    <div className="shell">
      <main className="rv-shell">
        <header className="rv-header rv-header--skill">
          <div className="rv-header__copy">
            <a className="rv-back" href="/home">← Trang chủ</a>
            <p className="rv-kicker">READING LAB · SKILLS</p>
            <h1>Luyện từng kỹ năng, <span>đọc nhanh và chính xác hơn.</span></h1>
            <p className="subtitle">Tập trung vào một mục tiêu mỗi lần — skimming, scanning, main idea, inference và các dạng câu hỏi IELTS thường gặp.</p>
          </div>
          <dl className="rv-header__stats" aria-label="Tổng quan thư viện kỹ năng">
            <div><dt id="rv-total-count">{totalCount}</dt><dd>bài luyện</dd></div>
            <div><dt id="rv-focus-count">{focusCount}</dt><dd>nhóm kỹ năng</dd></div>
            <div><dt>1 mục tiêu</dt><dd>Mỗi bài luyện</dd></div>
          </dl>
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

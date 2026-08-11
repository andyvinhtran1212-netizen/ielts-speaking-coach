import type { ReactNode } from 'react';

interface ReadingMiniTestShellProps {
  children: ReactNode;
  durationCount?: number | string;
  totalCount?: number | string;
}

export function ReadingMiniTestShell({
  children,
  durationCount = '—',
  totalCount = '—',
}: ReadingMiniTestShellProps) {
  return (
    <div className="shell">
      <main className="rv-shell">
        <header className="rv-header rv-header--mini">
          <div className="rv-header__copy">
            <a className="rv-back" href="/home">← Trang chủ</a>
            <p className="rv-kicker">READING LAB · MINI TEST</p>
            <h1>Một đoạn văn, <span>một phiên luyện tập trung.</span></h1>
            <p className="subtitle">Luyện theo nhịp ngắn với giao diện và phần chữa bài giống Full Test — phù hợp khi bạn chưa có đủ 60 phút.</p>
          </div>
          <dl className="rv-header__stats" aria-label="Cấu trúc Mini Test">
            <div><dt id="rv-total-count">{totalCount}</dt><dd>mini test</dd></div>
            <div><dt>1 đoạn</dt><dd>Mỗi đề</dd></div>
            <div><dt id="rv-duration-count">{durationCount}</dt><dd>thời lượng phổ biến</dd></div>
          </dl>
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

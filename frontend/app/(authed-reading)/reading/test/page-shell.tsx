// Markup tĩnh của trang Full Tests. `<aver-chrome>` do `page.tsx` dựng;
// behavior React sở hữu filter, request và các trạng thái động bên dưới.
import Link from 'next/link';
import type { ReactNode } from 'react';

interface ReadingTestShellProps {
  children: ReactNode;
  totalCount?: number | string;
}

export function ReadingTestShell({ children, totalCount = '—' }: ReadingTestShellProps) {
  return (
    <div className="shell">
      <main className="rv-shell">
        <header className="rv-header rv-header--test">
          <div className="rv-header__copy">
            <Link className="rv-back" href="/home">← Trang chủ</Link>
            <p className="rv-kicker">READING LAB · FULL TEST</p>
            <h1>Thi thử trọn bộ, <span>làm quen áp lực phòng thi.</span></h1>
            <p className="subtitle">Mô phỏng bài Academic Reading đầy đủ với giao diện làm bài, đồng hồ, bảng câu hỏi và phần chữa bài sau khi nộp.</p>
          </div>
          <dl className="rv-header__stats" aria-label="Cấu trúc Full Test">
            <div><dt id="rv-total-count">{totalCount}</dt><dd>đề thi</dd></div>
            <div><dt>3 đoạn</dt><dd>40 câu hỏi</dd></div>
            <div><dt>60 phút</dt><dd>Đúng chuẩn thi</dd></div>
          </dl>
        </header>

        {/* Library switcher: L1 ↔ L2 ↔ L3 (Sprint 20.6 adds the Full Test entry). Changed /pages/reading-vocab.html → /reading/vocab */}
        <nav className="rv-libnav" aria-label="Reading libraries">
          <Link className="rv-libnav__link" href="/reading/vocab">Vocab Reading</Link>
          <Link className="rv-libnav__link" href="/reading/skill">Skill Practice</Link>
          <a className="rv-libnav__link is-active" aria-current="page">Full Tests</a>
          <Link className="rv-libnav__link" href="/reading/mini-test">Mini Tests</Link>
        </nav>

        {children}
      </main>
    </div>
  );
}

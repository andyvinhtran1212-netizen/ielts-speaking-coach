import Link from 'next/link';
import type { ReactNode } from 'react';

import { LEGAL_LINKS } from './legal-content';

/**
 * Khung chung của bốn trang công khai (G02-T13): thanh trên tối giản, đường
 * dẫn "Trang chủ › …", dải "Bản tạm" và chân trang có liên kết qua lại.
 * Chỉ dùng lớp trong `/css/legal.css` (token `--av-*`), không thêm lớp
 * Tailwind mới vì bản dựng Tailwind không quét TSX.
 */
export function LegalShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="lg-page">
      <link rel="stylesheet" href="/css/legal.css" />
      <header className="lg-topbar">
        <div className="lg-topbar__inner">
          <Link href="/" className="lg-brand">Aver Learning</Link>
          <Link href="/login" className="lg-topbar__link">Đăng nhập</Link>
        </div>
      </header>

      <main id="main-content" className="lg-main">
        <nav aria-label="Đường dẫn" className="lg-crumbs">
          <Link href="/">Trang chủ</Link>
          <span aria-hidden="true"> › </span>
          <span aria-current="page">{title}</span>
        </nav>
        <p className="lg-draft" role="note">
          <strong>Bản tạm</strong>, đang chờ duyệt pháp lý. Nội dung ghi XXX là phần chưa có.
        </p>
        {children}
      </main>

      <footer className="lg-footer">
        <div className="lg-footer__inner">
          <nav aria-label="Thông tin" className="lg-footer__links">
            {LEGAL_LINKS.map((link) => (
              <Link key={link.href} href={link.href}>{link.label}</Link>
            ))}
          </nav>
          <p className="lg-footer__copy">© 2026 Aver Learning. Bảo lưu mọi quyền.</p>
        </div>
      </footer>
    </div>
  );
}

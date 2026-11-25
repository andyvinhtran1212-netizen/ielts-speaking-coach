import { PUBLIC_FOOTER_LINKS, PUBLIC_HREF } from './public-links';
import styles from './public-shell.module.css';

/**
 * Full footer of the public area (UIBASE-0056 FR-011, KhungTrang2 §9):
 * Giới thiệu · Khoá học · Thư viện · Điều khoản · Quyền riêng tư · Liên hệ · ©.
 * Same order at every width; on a phone the links wrap, each row 44px.
 */
export function PublicFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <div className={styles.footerRow}>
          <a href={PUBLIC_HREF.home} className={styles.footerBrand}>
            <span className={styles.brandMark} aria-hidden="true">A</span>
            Aver Learning
          </a>
          <nav aria-label="Chân trang">
            <ul className={styles.footerLinks}>
              {PUBLIC_FOOTER_LINKS.map((link) => (
                <li key={link.label}><a href={link.href}>{link.label}</a></li>
              ))}
            </ul>
          </nav>
        </div>
        <p className={styles.copy}>© 2026 Aver Learning. Bảo lưu mọi quyền.</p>
      </div>
    </footer>
  );
}

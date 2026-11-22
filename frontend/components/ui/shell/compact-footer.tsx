import { COMPACT_FOOTER_LINKS } from './learner-sections';
import styles from './learner-shell.module.css';

/** Compact signed-in footer (KhungTrang2 §9): © · Trợ giúp · Điều khoản · Quyền riêng tư. */
export function CompactFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <p className={styles.copy}>
          <span className={styles.brandMarkSmall} aria-hidden="true">A</span>
          © 2026 Aver Learning
        </p>
        <nav aria-label="Chân trang">
          <ul className={styles.footerLinks}>
            {COMPACT_FOOTER_LINKS.map((link) => <li key={link.href}><a href={link.href}>{link.label}</a></li>)}
          </ul>
        </nav>
      </div>
    </footer>
  );
}

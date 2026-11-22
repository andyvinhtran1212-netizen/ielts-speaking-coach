import type { ReactNode } from 'react';

import { PublicFooter } from './public-footer';
import { PublicTopNav, type PublicNavItem, type PublicSection } from './public-top-nav';
import styles from './public-shell.module.css';

export type PublicShellProps = {
  active?: PublicSection;
  mobileExtraItem?: PublicNavItem;
  children: ReactNode;
};

/**
 * Page frame of the public area for guests (UIBASE-0056 FR-011, plan 5.5):
 * PublicTopNav, the page in a <main>, PublicFooter. No bottom bar at any width.
 * Pages render inside `.av2-root` (the `(public-v2)` layout provides it).
 */
export function PublicShell({ active, mobileExtraItem, children }: PublicShellProps) {
  return (
    <div className={styles.shell}>
      <a href="#main-content" className={styles.skip}>Bỏ qua tới nội dung</a>
      <PublicTopNav active={active} mobileExtraItem={mobileExtraItem} />
      <main id="main-content" tabIndex={-1} className={styles.main}>{children}</main>
      <PublicFooter />
    </div>
  );
}

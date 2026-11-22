'use client';

import { useEffect, useState } from 'react';

import { cx } from '../cx';
import { Icon } from '../icon/icon';
import { LEARNER_NAV, type LearnerSectionId } from './learner-sections';
import styles from './learner-shell.module.css';

/** The on-screen keyboard counts as open when the visual viewport loses >25% of the window height. */
export const KEYBOARD_SHRINK_RATIO = 0.75;

/**
 * Phone bottom bar (UIBASE-0056 FR-007, KhungTrang §3): below 768px, 64px,
 * five equal cells, 22px icon over 12px label; the current one has a 3px top
 * rule and bold text. Stays on scroll; hidden while the on-screen keyboard is
 * open so it never covers a field.
 */
export function BottomTabBar({ current }: { current: LearnerSectionId | null }) {
  const [keyboard, setKeyboard] = useState(false);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const check = () => setKeyboard(vv.height < window.innerHeight * KEYBOARD_SHRINK_RATIO);
    check();
    vv.addEventListener('resize', check);
    return () => vv.removeEventListener('resize', check);
  }, []);

  return (
    <nav aria-label="Thanh mục chính" className={styles.bottomBar} hidden={keyboard || undefined}>
      <ul className={styles.bottomList}>
        {LEARNER_NAV.map((item) => (
          <li key={item.id}>
            <a
              href={item.href}
              className={cx(styles.bottomLink, item.id === current && styles.current)}
              aria-current={item.id === current ? 'page' : undefined}
            >
              <Icon name={item.icon} size={22} />
              <span>{item.label}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

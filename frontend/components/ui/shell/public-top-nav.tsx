'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import { Button } from '../button';
import { cx } from '../cx';
import { IconButton } from '../icon-button';
import { ThemeChoiceGroup } from '../theme-choice';
import { ThemeMenu } from '../theme-menu';
import { PUBLIC_HREF } from './public-links';
import styles from './public-shell.module.css';

export type PublicSection = 'library' | 'courses';

export type PublicNavItem = { label: string; href: string };

export type PublicTopNavProps = {
  /** The section the page belongs to; marked with a 3px rule and bold text. */
  active?: PublicSection;
  /**
   * One extra row in the phone menu, e.g. G05-T21's "Chấm thử" while the free
   * trial is open. Not passed: the menu has no empty row.
   */
  mobileExtraItem?: PublicNavItem;
};

const SECTIONS: readonly (PublicNavItem & { id: PublicSection })[] = [
  { id: 'library', label: 'Thư viện', href: PUBLIC_HREF.library },
  { id: 'courses', label: 'Khoá học', href: PUBLIC_HREF.courses },
];

const CTA = 'Xem các khoá';

/**
 * Top bar of the public area (UIBASE-0056 FR-011, KhungTrang §4): Thư viện ·
 * Khoá học · "Đăng nhập" as a text link · one primary button "Xem các khoá".
 * Below 768px "Đăng nhập" stays on the bar and the rest moves into a menu.
 * No bottom bar, no AI credits, no account button: guests only.
 */
export function PublicTopNav({ active, mobileExtraItem }: PublicTopNavProps) {
  const [open, setOpen] = useState(false);
  const bar = useRef<HTMLElement>(null);
  const menuId = useId();

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) bar.current?.querySelector<HTMLButtonElement>('[data-menu-trigger]')?.focus();
  };

  // A tap outside the bar closes the menu without moving focus.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!bar.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (open && event.key === 'Escape') {
      event.preventDefault();
      close(true);
    }
  };

  const sectionLink = (item: (typeof SECTIONS)[number], className: string) => (
    <a
      href={item.href}
      className={cx(className, active === item.id && styles.current)}
      aria-current={active === item.id ? 'page' : undefined}
    >
      {item.label}
    </a>
  );

  return (
    <header ref={bar} className={styles.topbar} onKeyDown={onKeyDown}>
      <div className={styles.topbarInner}>
        <a href={PUBLIC_HREF.home} className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">A</span>
          Aver Learning
        </a>

        <nav aria-label="Khu công khai" className={styles.sections}>
          <ul className={styles.sectionList}>
            {SECTIONS.map((item) => <li key={item.id}>{sectionLink(item, styles.sectionLink)}</li>)}
          </ul>
        </nav>

        <div className={styles.actions}>
          <ThemeMenu className={styles.wideOnly} />
          <a href={PUBLIC_HREF.login} className={styles.login}>Đăng nhập</a>
          <Button href={PUBLIC_HREF.courses} variant="primary" size="md" className={styles.wideOnly}>{CTA}</Button>
          <IconButton
            data-menu-trigger=""
            icon="menu"
            label={open ? 'Đóng menu' : 'Mở menu'}
            aria-expanded={open}
            aria-controls={menuId}
            className={styles.phoneOnly}
            onClick={() => setOpen((was) => !was)}
          />
        </div>
      </div>

      {open ? (
        <div id={menuId} className={styles.menu}>
          <nav aria-label="Menu khu công khai">
            <ul className={styles.menuList}>
              {SECTIONS.map((item) => <li key={item.id}>{sectionLink(item, styles.menuLink)}</li>)}
              {mobileExtraItem ? (
                <li><a href={mobileExtraItem.href} className={styles.menuLink}>{mobileExtraItem.label}</a></li>
              ) : null}
            </ul>
          </nav>
          <Button href={PUBLIC_HREF.courses} variant="primary" size="lg" className={styles.menuCta}>{CTA}</Button>
          <ThemeChoiceGroup className={styles.menuTheme} />
        </div>
      ) : null}
    </header>
  );
}

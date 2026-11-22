'use client';

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

import { cx } from '../cx';
import { Icon } from '../icon/icon';
import { AccountMenu, type LearnerUser } from './account-menu';
import { AiCreditsIndicator, type AiCredits } from './ai-credits';
import { useLearnerShellPanel } from './learner-panel';
import { LEARNER_NAV, type LearnerSectionId } from './learner-sections';
import { QuickLookup, type LookupFn } from './quick-lookup';
import styles from './learner-shell.module.css';

export type LearnerTopNavProps = {
  current: LearnerSectionId | null;
  user: LearnerUser;
  canSwitchToAdmin: boolean;
  credits?: AiCredits | null;
  trialLeft?: number | null;
  overdueSlot?: ReactNode;
  notificationsSlot?: ReactNode;
  lookup?: LookupFn;
};

/**
 * Learner top bar (UIBASE-0056 FR-007, KhungTrang §1–3). ≥1024px the five
 * sections in one row; 768–1023px a "Menu: {section}" button whose list pushes
 * the page down; <768px no sections here (BottomTabBar). Right side, in order:
 * AI credits · "N quá hạn" · magnifier (from 768px) · bell · account button.
 * Slots that are not passed take no space.
 */
export function LearnerTopNav({
  current, user, canSwitchToAdmin, credits, trialLeft, overdueSlot, notificationsSlot, lookup,
}: LearnerTopNavProps) {
  const [menuOpen, setMenuOpen] = useLearnerShellPanel('menu');
  const menuWrap = useRef<HTMLDivElement>(null);
  const listId = useId();
  const currentItem = LEARNER_NAV.find((item) => item.id === current) ?? null;

  const closeMenu = (refocus: boolean) => {
    setMenuOpen(false);
    if (refocus) menuWrap.current?.querySelector<HTMLButtonElement>('[data-menu-trigger]')?.focus();
  };

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: PointerEvent) => {
      if (!menuWrap.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [menuOpen, setMenuOpen]);

  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (menuOpen && event.key === 'Escape') {
      event.preventDefault();
      closeMenu(true);
    }
  };

  const sectionLink = (item: (typeof LEARNER_NAV)[number], className: string) => (
    <a
      href={item.href}
      className={cx(className, item.id === current && styles.current)}
      aria-current={item.id === current ? 'page' : undefined}
    >
      {item.label}
    </a>
  );

  return (
    <header className={styles.topbar} data-has-overdue={overdueSlot ? 'true' : undefined}>
      <div ref={menuWrap} onKeyDown={onMenuKey}>
        <div className={styles.topbarInner}>
          <a href="/home" className={styles.brand}>
            <span className={styles.brandMark} aria-hidden="true">A</span>
            <span className={styles.brandName}>Aver Learning</span>
          </a>

          <nav aria-label="Mục chính" className={styles.sections}>
            <ul className={styles.sectionList}>
              {LEARNER_NAV.map((item) => <li key={item.id}>{sectionLink(item, styles.sectionLink)}</li>)}
            </ul>
          </nav>

          <button
            type="button"
            data-menu-trigger=""
            className={styles.menuButton}
            aria-expanded={menuOpen}
            aria-controls={listId}
            onClick={() => (menuOpen ? closeMenu(false) : setMenuOpen(true))}
          >
            <Icon name="menu" />
            {currentItem ? `Menu: ${currentItem.label}` : 'Menu'}
          </button>

          <div className={styles.actions}>
            {typeof trialLeft === 'number' || credits ? (
              <span className={styles.creditsSlot}><AiCreditsIndicator credits={credits} trialLeft={trialLeft} /></span>
            ) : null}
            {overdueSlot ? <span className={styles.overdueSlot}>{overdueSlot}</span> : null}
            {lookup ? <QuickLookup lookup={lookup} /> : null}
            {notificationsSlot ? <span className={styles.bellSlot}>{notificationsSlot}</span> : null}
            <AccountMenu user={user} canSwitchToAdmin={canSwitchToAdmin} />
          </div>
        </div>

        {menuOpen ? (
          <nav id={listId} aria-label="Menu mục chính" className={styles.tabletMenu}>
            <ul className={styles.tabletList}>
              {LEARNER_NAV.map((item) => (
                <li key={item.id}>{sectionLink(item, styles.tabletLink)}</li>
              ))}
            </ul>
          </nav>
        ) : null}
      </div>
    </header>
  );
}

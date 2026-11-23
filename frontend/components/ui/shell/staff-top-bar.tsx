'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import { signOutFromShell } from '@/lib/auth/shell-sign-out';

import { cx } from '../cx';
import { Icon } from '../icon/icon';
import { ThemeChoiceGroup } from '../theme-choice';
import { ThemeMenu } from '../theme-menu';
import {
  ENV_LABEL, LEARNER_VIEW_HREF, ROLE_LABEL, STAFF_HOME,
  type StaffEnvironment, type StaffRole, type StaffRoleSwitch, type StaffUser,
} from './staff-nav';
import { StaffQuickSearch, type StaffSearchFn } from './staff-quick-search';
import styles from './staff-shell.module.css';

export type StaffPanel = 'search' | 'account' | 'drawer';

/** Never hidden (KhungTrang2 §7): production solid, the others dashed, and different words. */
export function EnvBadge({ environment, className }: { environment: StaffEnvironment; className?: string }) {
  return <span className={cx(styles.env, className)} data-env={environment}>{ENV_LABEL[environment]}</span>;
}

const SEARCH_PLACEHOLDER: Record<StaffRole, string> = {
  admin: 'Tìm học viên, lớp, bài nộp, đề…',
  instructor: 'Tìm học viên, lớp, bài nộp…',
};

function StaffAccountMenu({
  user, switchTo, open, onOpenChange,
}: { user: StaffUser; switchTo: readonly StaffRoleSwitch[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [signingOut, setSigningOut] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const close = (refocus: boolean) => {
    onOpenChange(false);
    if (refocus) wrap.current?.querySelector<HTMLButtonElement>('[data-account-trigger]')?.focus();
  };

  useEffect(() => {
    if (open) wrap.current?.querySelector<HTMLElement>('[data-account-menu] a, [data-account-menu] button')?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) onOpenChange(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open, onOpenChange]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (open && event.key === 'Escape') {
      event.preventDefault();
      close(true);
    }
  };

  // The same sign-out flow and order as the legacy bars (lib/auth/shell-sign-out).
  const signOut = () => {
    if (signingOut) return;
    setSigningOut(true);
    void signOutFromShell();
  };

  return (
    <div ref={wrap} className={styles.account} onKeyDown={onKeyDown}>
      <button
        type="button"
        data-account-trigger=""
        className={styles.accountButton}
        aria-label={`Tài khoản: ${user.name}. Đổi vai trò, đăng xuất`}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => (open ? close(false) : onOpenChange(true))}
      >
        <span aria-hidden="true">{user.initials}</span>
      </button>
      {open ? (
        <div id={menuId} className={styles.accountMenu} data-account-menu="" role="dialog" aria-label="Tài khoản">
          <div className={styles.accountHead}>
            <p className={styles.accountName}>{user.name}</p>
            <p className={styles.accountEmail}>{user.email}</p>
          </div>
          <ul className={styles.accountList}>
            <li className={styles.phoneOnly}><a href={LEARNER_VIEW_HREF} className={styles.accountItem}>Xem như học viên</a></li>
            {switchTo.map((s) => (
              <li key={s.href}><a href={s.href} className={styles.accountItem}>Đổi vai trò: {s.label}</a></li>
            ))}
          </ul>
          <ThemeChoiceGroup className={cx(styles.accountTheme, styles.phoneOnly)} />
          <button type="button" className={styles.signOut} onClick={signOut} aria-disabled={signingOut || undefined}>
            {signingOut ? 'Đang đăng xuất…' : 'Đăng xuất'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export type StaffTopBarProps = {
  role: StaffRole;
  environment: StaffEnvironment;
  user: StaffUser;
  switchTo: readonly StaffRoleSwitch[];
  search?: StaffSearchFn;
  panel: StaffPanel | null;
  setPanel: (panel: StaffPanel | null) => void;
};

/**
 * Staff top bar (UIBASE-0056 FR-010, KhungTrang2 §7–8): brand · role label ·
 * environment badge · quick search ⌘K · "Xem như học viên" · theme · account.
 * Staging and local draw the bar on --av2-off. Below 768px: menu button,
 * brand, search and account buttons, and the role + environment as a strip.
 */
export function StaffTopBar({ role, environment, user, switchTo, search, panel, setPanel }: StaffTopBarProps) {
  const toggle = (name: StaffPanel) => (open: boolean) => setPanel(open ? name : panel === name ? null : panel);
  return (
    <header className={styles.topbar} data-env={environment}>
      <div className={styles.topbarInner}>
        <button
          type="button"
          className={cx(styles.squareButton, styles.menuButton)}
          aria-label={panel === 'drawer' ? `Đóng menu ${ROLE_LABEL[role].toLowerCase()}` : `Mở menu ${ROLE_LABEL[role].toLowerCase()}`}
          aria-expanded={panel === 'drawer'}
          onClick={() => setPanel(panel === 'drawer' ? null : 'drawer')}
        >
          <Icon name="menu" />
        </button>
        <a href={STAFF_HOME[role]} className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">A</span>
          <span>Aver Learning</span>
        </a>
        <span className={styles.role}>{ROLE_LABEL[role]}</span>
        <EnvBadge environment={environment} className={styles.envInBar} />
        {search ? (
          <StaffQuickSearch
            search={search}
            placeholder={SEARCH_PLACEHOLDER[role]}
            open={panel === 'search'}
            onOpenChange={toggle('search')}
          />
        ) : null}
        <span className={styles.spacer} />
        <a href={LEARNER_VIEW_HREF} className={styles.learnerView}>Xem như học viên</a>
        <ThemeMenu className={styles.theme} />
        <StaffAccountMenu user={user} switchTo={switchTo} open={panel === 'account'} onOpenChange={toggle('account')} />
      </div>
      <p className={styles.envStrip} data-env={environment}>{ROLE_LABEL[role]} · {ENV_LABEL[environment]}</p>
    </header>
  );
}

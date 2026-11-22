'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import { signOutFromShell } from '@/lib/auth/shell-sign-out';
import { useDialogFocus } from '@/lib/use-dialog-focus';

import { ThemeChoiceGroup } from '../theme-choice';
import { useLearnerShellPanel } from './learner-panel';
import { ACCOUNT_LINKS, ADMIN_SWITCH } from './learner-sections';
import styles from './learner-shell.module.css';

export type LearnerUser = { name: string; email: string; initials: string };

export type AccountMenuProps = {
  user: LearnerUser;
  /** True only when the server profile (`/auth/me`) says admin. Never inferred on the client. */
  canSwitchToAdmin: boolean;
};

/**
 * Account button and menu (UIBASE-0056 FR-008, KhungTrang §1, §3): name and
 * email on top, then Tiến độ · Khoá học và lượt AI · Hồ sơ · Trợ giúp ·
 * (Đổi vai trò, admins only, no gap otherwise) · theme · Đăng xuất below a rule.
 * A 288px popover from 768px; a bottom sheet with "Đóng" on a phone. Closes on
 * the button, a click outside or Esc, and focus returns to the button. The
 * phone sheet is modal (focus trap, Esc from anywhere, no page scroll).
 */
const PHONE = '(max-width: 767px)';

/** True below 768px, where the menu is a modal bottom sheet. */
function usePhoneSheet() {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(PHONE);
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return phone;
}

export function AccountMenu({ user, canSwitchToAdmin }: AccountMenuProps) {
  const [open, setOpen] = useLearnerShellPanel('account');
  const [signingOut, setSigningOut] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const phone = usePhoneSheet();

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) wrap.current?.querySelector<HTMLButtonElement>('[data-account-trigger]')?.focus();
  };

  // Phone: the sheet is modal. Tab stays inside, Esc closes from anywhere,
  // the page does not scroll behind it and focus returns to the button.
  useDialogFocus({ open: open && phone, onClose: () => close(true), dialogRef: menu });

  // Focus the first entry when the menu opens.
  useEffect(() => {
    if (open) wrap.current?.querySelector<HTMLElement>(`[data-account-menu] a, [data-account-menu] button`)?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Element;
      if (!wrap.current?.contains(target) || target.closest('[data-account-backdrop]')) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open, setOpen]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (open && !phone && event.key === 'Escape') {
      event.preventDefault();
      close(true);
    }
  };

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
        aria-label={`Tài khoản: ${user.name}`}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <span aria-hidden="true">{user.initials}</span>
      </button>
      {open ? (
        <>
          <div className={styles.backdrop} data-account-backdrop="" aria-hidden="true" />
          <div
            ref={menu}
            id={menuId}
            className={styles.accountMenu}
            data-account-menu=""
            role="dialog"
            aria-label="Tài khoản"
            aria-modal={phone || undefined}
          >
            <div className={styles.accountHead}>
              <p className={styles.accountName}>{user.name}</p>
              {canSwitchToAdmin ? <span className={styles.adminTag}>Admin</span> : null}
              <p className={styles.accountEmail}>{user.email}</p>
            </div>
            <ul className={styles.accountList}>
              {ACCOUNT_LINKS.map((link) => (
                <li key={link.href}><a href={link.href} className={styles.accountItem}>{link.label}</a></li>
              ))}
              {canSwitchToAdmin ? (
                <li><a href={ADMIN_SWITCH.href} className={styles.accountItem}>{ADMIN_SWITCH.label}</a></li>
              ) : null}
            </ul>
            <ThemeChoiceGroup className={styles.accountTheme} />
            <button
              type="button"
              className={styles.signOut}
              onClick={signOut}
              aria-disabled={signingOut || undefined}
            >
              {signingOut ? 'Đang đăng xuất…' : 'Đăng xuất'}
            </button>
            <button type="button" className={styles.sheetClose} onClick={() => close(true)}>Đóng</button>
          </div>
        </>
      ) : null}
    </div>
  );
}

'use client';

import Link from 'next/link';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { AdminTestDataToggle } from '@/components/admin-test-data-toggle';
import { getAdminMfaStatus } from '@/lib/admin-mfa-api';
import {
  ACCOUNT_INACTIVE_EVENT,
  ADMIN_MFA_COPY,
  adminGateDecision,
  adminMfaUrl,
  bannerDismissKey,
  isInactiveError,
} from '@/lib/admin-mfa-model.mjs';
import { getAuthorizationIdentity, type AuthRoleIdentity } from '@/lib/auth-api';
import { useAuth } from '@/lib/auth/auth-provider';
import { selectKeyedAdminState } from '@/lib/admin-writing-grade-model.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

export type AdminProfile = AuthRoleIdentity;

type AccessValue =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'inactive' }
  | { phase: 'redirect'; target: string }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; profile: AdminProfile; reportOnly: boolean };

type KeyedAccess = { key: string; value: AccessValue };

const AdminProfileContext = createContext<AdminProfile | null>(null);

export function useAdminProfile() {
  const profile = useContext(AdminProfileContext);
  if (!profile) throw new Error('useAdminProfile must be rendered inside AdminAccessGate');
  return profile;
}

function messageOf(caught: unknown) {
  return caught instanceof Error ? caught.message : String(caught || 'Không kiểm tra được quyền admin.');
}

function tabStore(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}

/** Report-only (ADMIN_AAL2_ENFORCE off) nudge for an AAL1 admin; dismissal lasts for the tab. */
function AdminMfaReportOnlyBanner({ accountKey }: { accountKey: string }) {
  const [dismissed, setDismissed] = useState(() => tabStore()?.getItem(bannerDismissKey(accountKey)) === '1');
  if (dismissed) return null;
  const next = adminMfaUrl(window.location.pathname, window.location.search);
  return (
    <div id="admin-mfa-report-only" className="adm-mfa-banner" role="status">
      <span>{ADMIN_MFA_COPY.reportOnlyBanner}</span>
      <a href={next} className="adm-mfa-banner__link">Bật ngay</a>
      <button
        type="button"
        className="adm-mfa-banner__dismiss"
        onClick={() => {
          try { tabStore()?.setItem(bannerDismissKey(accountKey), '1'); } catch { /* tab-only hint */ }
          setDismissed(true);
        }}
      >
        Ẩn
      </button>
    </div>
  );
}

/**
 * Canonical admin gate for native routes. Authentication stays in AuthProvider;
 * the backend-owned `/auth/me` role and `/admin/mfa/status` assurance are
 * checked separately and never cached. State is account-keyed so a direct
 * A → B auth transition cannot expose A's admin surface during the effect gap.
 *
 * ADMINAAL2-0032 FR-013: under enforcement an AAL1 admin is sent to
 * `/admin/mfa?next=…` and children never mount; in report-only mode they
 * render under a dismissible banner. An inactive 403 from any later call
 * (api.js dispatches ACCOUNT_INACTIVE_EVENT) replaces the page with the
 * denied state.
 */
export function AdminAccessGate({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const [accessState, setAccessState] = useState<KeyedAccess>({
    key: '', value: { phase: 'loading' },
  });
  const accountKey = status === 'signed-in' && user?.id ? user.id : '';

  useEffect(() => {
    if (status === 'signed-out') window.location.replace('/login');
  }, [status]);

  useEffect(() => {
    if (!accountKey) return;
    let dead = false;
    setAccessState({ key: accountKey, value: { phase: 'loading' } });
    (async () => {
      const ready = await whenGlobalReady(
        () => typeof window.api?.get === 'function',
        'window.api (admin access)',
      );
      if (dead) return;
      if (!ready) {
        setAccessState({
          key: accountKey,
          value: { phase: 'error', message: 'Không tải được công cụ xác minh quyền. Vui lòng tải lại trang.' },
        });
        return;
      }
      try {
        const profile = await getAuthorizationIdentity();
        if (dead) return;
        if (profile?.role !== 'admin' || profile.is_active === false) {
          setAccessState({
            key: accountKey,
            value: { phase: profile?.role === 'admin' ? 'inactive' : 'denied' },
          });
          return;
        }
        const assurance = await getAdminMfaStatus();
        if (dead) return;
        const decision = adminGateDecision(profile, assurance);
        setAccessState({
          key: accountKey,
          value: decision === 'redirect'
            ? { phase: 'redirect', target: adminMfaUrl(window.location.pathname, window.location.search) }
            : decision === 'ready' || decision === 'banner'
              ? { phase: 'ready', profile, reportOnly: decision === 'banner' }
              : { phase: decision },
        });
      } catch (caught) {
        if (dead) return;
        const value: AccessValue = isInactiveError(caught)
          ? { phase: 'inactive' }
          : (caught as { status?: number } | null)?.status === 403
            ? { phase: 'denied' }
            : { phase: 'error', message: messageOf(caught) };
        setAccessState({ key: accountKey, value });
      }
    })();
    return () => { dead = true; };
  }, [accountKey]);

  useEffect(() => {
    if (!accountKey) return;
    const onInactive = () => setAccessState({ key: accountKey, value: { phase: 'inactive' } });
    window.addEventListener(ACCOUNT_INACTIVE_EVENT, onInactive);
    return () => window.removeEventListener(ACCOUNT_INACTIVE_EVENT, onInactive);
  }, [accountKey]);

  const access = selectKeyedAdminState(accessState, accountKey) as AccessValue;

  useEffect(() => {
    if (access.phase === 'redirect') window.location.replace(access.target);
  }, [access]);

  if (!accountKey || access.phase === 'loading') {
    return <div id="state-loading" className="adm-access-state adm-access-state--loading" role="status"><p className="adm-access-state__message aw-state-loading__text">Đang kiểm tra quyền truy cập…</p></div>;
  }
  if (access.phase === 'redirect') {
    return <div id="state-mfa-redirect" className="adm-access-state adm-access-state--loading" role="status"><p className="adm-access-state__message aw-state-loading__text">{ADMIN_MFA_COPY.redirecting}</p></div>;
  }
  if (access.phase === 'denied') {
    return <div id="state-denied" className="adm-access-state" role="alert"><h2 className="adm-access-state__title aw-state-denied__title">🔒 Admin Access Required</h2><Link href="/home" className="adm-access-state__action aw-state-denied__back">← Quay lại trang chủ</Link></div>;
  }
  if (access.phase === 'inactive') {
    return <div id="state-denied" className="adm-access-state" role="alert"><h2 className="adm-access-state__title aw-state-denied__title">🔒 Admin Access Required</h2><p id="state-inactive" className="adm-access-state__message">{ADMIN_MFA_COPY.inactive}</p><Link href="/home" className="adm-access-state__action aw-state-denied__back">← Quay lại trang chủ</Link></div>;
  }
  if (access.phase === 'error') {
    return <div id="state-error" className="adm-access-state" role="alert"><h2 className="adm-access-state__title aw-state-denied__title">Không xác minh được quyền</h2><p className="adm-access-state__message">{access.message}</p><button className="adm-access-state__action adm-access-state__button" type="button" onClick={() => window.location.reload()}>Tải lại</button></div>;
  }
  return <>{access.reportOnly && <AdminMfaReportOnlyBanner accountKey={accountKey} />}<AdminProfileContext.Provider value={access.profile}><AdminTestDataToggle />{children}</AdminProfileContext.Provider></>;
}

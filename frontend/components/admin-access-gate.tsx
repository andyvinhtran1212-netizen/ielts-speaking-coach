'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import { selectKeyedAdminState } from '@/lib/admin-writing-grade-model.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

export interface AdminProfile {
  id: string;
  email?: string | null;
  role: string;
}

type AccessValue =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; profile: AdminProfile };

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

/**
 * Canonical admin gate for native routes. Authentication stays in AuthProvider;
 * the backend-owned `/auth/me` role is checked separately and never cached.
 * State is account-keyed so a direct A → B auth transition cannot expose A's
 * admin surface during the effect gap.
 */
export function AdminAccessGate({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const [accessState, setAccessState] = useState<KeyedAccess>({
    key: '', value: { phase: 'loading' },
  });
  const accountKey = status === 'signed-in' && user?.id ? user.id : '';

  useEffect(() => {
    if (status === 'signed-out') window.location.replace('/login.html');
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
        const profile = await window.api.get<AdminProfile>('/auth/me');
        if (dead) return;
        setAccessState({
          key: accountKey,
          value: profile?.role === 'admin'
            ? { phase: 'ready', profile }
            : { phase: 'denied' },
        });
      } catch (caught) {
        if (!dead) setAccessState({
          key: accountKey,
          value: { phase: 'error', message: messageOf(caught) },
        });
      }
    })();
    return () => { dead = true; };
  }, [accountKey]);

  const access = selectKeyedAdminState(accessState, accountKey) as AccessValue;
  if (!accountKey || access.phase === 'loading') {
    return <div id="state-loading" className="adm-access-state adm-access-state--loading" role="status"><p className="adm-access-state__message aw-state-loading__text">Đang kiểm tra quyền truy cập…</p></div>;
  }
  if (access.phase === 'denied') {
    return <div id="state-denied" className="adm-access-state" role="alert"><h2 className="adm-access-state__title aw-state-denied__title">🔒 Admin Access Required</h2><a href="/home" className="adm-access-state__action aw-state-denied__back">← Quay lại trang chủ</a></div>;
  }
  if (access.phase === 'error') {
    return <div id="state-error" className="adm-access-state" role="alert"><h2 className="adm-access-state__title aw-state-denied__title">Không xác minh được quyền</h2><p className="adm-access-state__message">{access.message}</p><button className="adm-access-state__action adm-access-state__button" type="button" onClick={() => window.location.reload()}>Tải lại</button></div>;
  }
  return <AdminProfileContext.Provider value={access.profile}>{children}</AdminProfileContext.Provider>;
}

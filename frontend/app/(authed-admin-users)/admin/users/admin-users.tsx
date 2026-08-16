'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { useAdminProfile } from '@/components/admin-access-gate';
import { normalizeCohortsPayload } from '@/lib/admin-users-model.mjs';

import { AdminAccessCodesPanel } from './admin-access-codes-panel';
import type { AdminCohort } from './admin-user-types';
import { AdminUsersPanel } from './admin-users-panel';
import { messageOf } from './admin-user-ui';

type Tab = 'users' | 'codes';

export function AdminUsers({ initialTab }: { initialTab: Tab }) {
  const profile = useAdminProfile();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [cohorts, setCohorts] = useState<AdminCohort[]>([]);
  const [cohortsError, setCohortsError] = useState<string | null>(null);
  const cohortSequence = useRef(0);

  const loadCohorts = useCallback(async () => {
    const requestId = ++cohortSequence.current;
    setCohortsError(null);
    try {
      const payload = normalizeCohortsPayload(await window.api.get<unknown>('/admin/cohorts?is_active=true')) as AdminCohort[];
      if (requestId === cohortSequence.current) setCohorts(payload);
    } catch (caught) {
      if (requestId === cohortSequence.current) {
        setCohorts([]);
        setCohortsError(messageOf(caught));
      }
    }
  }, []);

  useEffect(() => {
    setCohorts([]);
    void loadCohorts();
    return () => { cohortSequence.current += 1; };
  }, [profile.id, loadCohorts]);

  useEffect(() => {
    const onPopState = () => {
      setTab(new URLSearchParams(window.location.search).get('tab') === 'codes' ? 'codes' : 'users');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const selectTab = (next: Tab) => {
    if (next === tab) return;
    setTab(next);
    const url = next === 'codes' ? '/admin/users?tab=codes' : '/admin/users';
    window.history.pushState({}, '', url);
  };

  const moveTabFocus = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const tabs: Tab[] = ['users', 'codes'];
    const current = tabs.indexOf(tab);
    const nextIndex = event.key === 'Home' ? 0
      : event.key === 'End' ? tabs.length - 1
        : event.key === 'ArrowRight' ? (current + 1) % tabs.length
          : (current - 1 + tabs.length) % tabs.length;
    const next = tabs[nextIndex];
    selectTab(next);
    requestAnimationFrame(() => document.getElementById(`${next}-tab`)?.focus());
  };

  return (
    <main className="au-shell">
      <header className="au-header">
        <div>
          <p className="au-eyebrow">Quản trị tài khoản</p>
          <h1>Người dùng <span>& Mã kích hoạt</span></h1>
          <p>Quản lý vai trò, hồ sơ học viên và quyền truy cập từ cùng một nguồn dữ liệu backend.</p>
        </div>
        <div className="au-header__meta">
          <span>Admin đang thao tác</span>
          <strong>{profile.email || profile.id}</strong>
        </div>
      </header>

      <nav className="au-tabs" role="tablist" aria-label="Người dùng và mã kích hoạt">
        <button id="users-tab" type="button" role="tab" aria-selected={tab === 'users'} aria-controls="users-panel" tabIndex={tab === 'users' ? 0 : -1} className={tab === 'users' ? 'is-active' : ''} onClick={() => selectTab('users')} onKeyDown={moveTabFocus}>
          <span>Người dùng</span><small>Vai trò · lớp · tài khoản</small>
        </button>
        <button id="codes-tab" type="button" role="tab" aria-selected={tab === 'codes'} aria-controls="codes-panel" tabIndex={tab === 'codes' ? 0 : -1} className={tab === 'codes' ? 'is-active' : ''} onClick={() => selectTab('codes')} onKeyDown={moveTabFocus}>
          <span>Mã kích hoạt</span><small>Quyền · quota · lịch sử</small>
        </button>
      </nav>

      {tab === 'users'
        ? <AdminUsersPanel profileId={profile.id} cohorts={cohorts} cohortsError={cohortsError} />
        : <AdminAccessCodesPanel profileId={profile.id} cohorts={cohorts} cohortsError={cohortsError} />}
    </main>
  );
}

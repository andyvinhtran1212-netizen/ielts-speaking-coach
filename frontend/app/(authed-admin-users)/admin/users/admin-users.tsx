'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useAdminProfile } from '@/components/admin-access-gate';
import { getAdminCohorts } from '@/lib/admin-cohorts-api';
import { normalizeCohortsPayload } from '@/lib/admin-users-model.mjs';

import type { AdminCohort } from './admin-user-types';
import { AdminUsersPanel } from './admin-users-panel';
import { messageOf } from './admin-user-ui';

// ADMINIA-0074 FR-048: activation codes moved to their own ledger page,
// /admin/activation-codes; /admin/users?tab=codes redirects there (307).
export function AdminUsers() {
  const profile = useAdminProfile();
  const [cohorts, setCohorts] = useState<AdminCohort[]>([]);
  const [cohortsError, setCohortsError] = useState<string | null>(null);
  const cohortSequence = useRef(0);

  const loadCohorts = useCallback(async () => {
    const requestId = ++cohortSequence.current;
    setCohortsError(null);
    try {
      const payload = normalizeCohortsPayload(await getAdminCohorts({ isActive: true })) as AdminCohort[];
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

  return (
    <main className="au-shell">
      <header className="au-header">
        <div>
          <p className="au-eyebrow">Quản trị tài khoản</p>
          <h1>Người dùng</h1>
          <p>Quản lý vai trò, hồ sơ học viên và quyền truy cập từ cùng một nguồn dữ liệu backend.</p>
        </div>
        <div className="au-header__meta">
          <span>Admin đang thao tác</span>
          <strong>{profile.email || profile.id}</strong>
        </div>
      </header>

      <p className="au-related-link">Mã kích hoạt nằm ở trang riêng: <a href="/admin/activation-codes">Mở sổ tra cứu mã kích hoạt</a></p>

      <AdminUsersPanel profileId={profile.id} cohorts={cohorts} cohortsError={cohortsError} />
    </main>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useAdminProfile } from '@/components/admin-access-gate';
import { getAdminCohorts } from '@/lib/admin-cohorts-api';
import { getAdminThresholds } from '@/lib/admin-users-api';
import { DEFAULT_CODE_EXPIRING_DAYS, expiringDaysFromThresholds, normalizeCohortsPayload } from '@/lib/admin-users-model.mjs';

import { AdminAccessCodesPanel } from '../users/admin-access-codes-panel';
import type { AdminCohort } from '../users/admin-user-types';
import { messageOf } from '../users/admin-user-ui';

export function AdminActivationCodes() {
  const profile = useAdminProfile();
  const [cohorts, setCohorts] = useState<AdminCohort[]>([]);
  const [cohortsError, setCohortsError] = useState<string | null>(null);
  const [expiringDays, setExpiringDays] = useState<number>(DEFAULT_CODE_EXPIRING_DAYS);
  const [thresholdsFailed, setThresholdsFailed] = useState(false);
  const sequence = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++sequence.current;
    setCohortsError(null);
    const [cohortResult, thresholdResult] = await Promise.allSettled([
      getAdminCohorts({ isActive: true }),
      getAdminThresholds(),
    ]);
    if (requestId !== sequence.current) return;
    if (cohortResult.status === 'fulfilled') {
      setCohorts(normalizeCohortsPayload(cohortResult.value) as AdminCohort[]);
    } else {
      setCohorts([]);
      setCohortsError(messageOf(cohortResult.reason));
    }
    if (thresholdResult.status === 'fulfilled') {
      setExpiringDays(expiringDaysFromThresholds(thresholdResult.value));
      setThresholdsFailed(false);
    } else {
      setExpiringDays(DEFAULT_CODE_EXPIRING_DAYS);
      setThresholdsFailed(true);
    }
  }, []);

  useEffect(() => {
    setCohorts([]);
    void load();
    return () => { sequence.current += 1; };
  }, [profile.id, load]);

  return (
    <main className="au-shell">
      <header className="au-header">
        <div>
          <p className="au-eyebrow">Quản trị tài khoản</p>
          <h1>Mã kích hoạt <span>· sổ tra cứu</span></h1>
          <p>Tra cứu mọi mã: chưa dùng, đã dùng (kèm người và ngày), hết hạn nhập, đã thu hồi. Mã mới được cấp từ trang của lớp.</p>
        </div>
        <div className="au-header__meta">
          <span>Admin đang thao tác</span>
          <strong>{profile.email || profile.id}</strong>
        </div>
      </header>
      {thresholdsFailed && <div className="au-inline-warning" role="status">Chưa đọc được ngưỡng cảnh báo; nhãn &quot;sắp hết hạn&quot; đang dùng mặc định {DEFAULT_CODE_EXPIRING_DAYS} ngày.</div>}
      <AdminAccessCodesPanel profileId={profile.id} cohorts={cohorts} cohortsError={cohortsError} expiringDays={expiringDays} />
    </main>
  );
}

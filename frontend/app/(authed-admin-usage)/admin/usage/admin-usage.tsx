'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { useAdminProfile } from '@/components/admin-access-gate';
import {
  filterUsageRows,
  formatUsageCost,
  formatUsageCount,
  formatUsageDate,
  normalizeCodeUsagePayload,
  normalizeUsageUsersPayload,
  sortUsageRows,
  summarizeUsageRows,
  usageUserLabel,
} from '@/lib/admin-usage-model.mjs';

import type { CodeUsagePayload, UsageUser, UsageUsersPayload } from './admin-usage-types';

const SORTS = [
  ['sessions', 'Nhiều phiên nhất'],
  ['last_active', 'Hoạt động gần nhất'],
  ['ai_cost_usd', 'Chi phí AI cao nhất'],
  ['name', 'Tên A–Z'],
] as const;

function roleLabel(value: string | null) {
  return ({ student: 'Học viên', instructor: 'Giảng viên', admin: 'Quản trị' } as Record<string, string>)[value || ''] || value || 'Chưa rõ vai trò';
}

function UsageTable({ rows }: { rows: UsageUser[] }) {
  return (
    <div className="aus-table-wrap">
      <table className="aus-table">
        <thead><tr><th>Người dùng</th><th>Vai trò</th><th>Tổng phiên</th><th>Hoạt động gần nhất</th><th>Chi phí AI ước tính</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.userId}>
          <td data-label="Người dùng"><span className="aus-mobile-label">Người dùng</span><div className="aus-person"><strong>{usageUserLabel(row)}</strong>{row.name && row.email && <span>{row.email}</span>}<code>{row.userId}</code></div></td>
          <td data-label="Vai trò"><span className="aus-mobile-label">Vai trò</span><span className="adm-chip">{roleLabel(row.role)}</span></td>
          <td data-label="Tổng phiên" className={row.sessions == null ? 'is-unknown' : 'is-number'}><span className="aus-mobile-label">Tổng phiên</span>{formatUsageCount(row.sessions)}</td>
          <td data-label="Hoạt động gần nhất" className={row.sessions == null ? 'is-unknown' : ''}><span className="aus-mobile-label">Hoạt động gần nhất</span>{row.sessions == null ? 'Không đọc được' : row.lastActive ? formatUsageDate(row.lastActive) : 'Chưa có phiên'}</td>
          <td data-label="Chi phí AI ước tính" className={row.aiCostUsd == null ? 'is-unknown' : 'is-number'}><span className="aus-mobile-label">Chi phí AI ước tính</span>{row.aiCostUsd == null ? 'Không đọc được' : formatUsageCost(row.aiCostUsd)}</td>
        </tr>)}</tbody>
      </table>
    </div>
  );
}

export function AdminUsage() {
  const profile = useAdminProfile();
  const searchParams = useSearchParams();
  const codeId = searchParams?.get('code_id')?.trim() || '';
  const scopeKey = `${profile.id}:${codeId || 'all'}`;
  const urlQuery = searchParams?.get('q') || '';
  const urlSort = searchParams?.get('sort') || 'sessions';
  const [query, setQuery] = useState(urlQuery);
  const [sort, setSort] = useState(SORTS.some(([value]) => value === urlSort) ? urlSort : 'sessions');
  const [snapshot, setSnapshot] = useState<{ key: string; value: UsageUsersPayload | CodeUsagePayload } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const payload = snapshot?.key === scopeKey ? snapshot.value : null;

  const load = useCallback(async () => {
    const requestId = ++sequence.current;
    setLoading(true);
    setError(null);
    try {
      const path = codeId
        ? `/admin/access-codes/${encodeURIComponent(codeId)}/usage`
        : '/admin/usage/users';
      const value = await window.api.get<unknown>(path);
      const normalized = codeId ? normalizeCodeUsagePayload(value) : normalizeUsageUsersPayload(value);
      if (!normalized) throw new Error('Dữ liệu hoạt động không đúng định dạng.');
      if (requestId === sequence.current) setSnapshot({ key: scopeKey, value: normalized as UsageUsersPayload | CodeUsagePayload });
    } catch {
      if (requestId === sequence.current) setError('Không thể đọc dữ liệu hoạt động từ máy chủ. Vui lòng thử lại.');
    } finally {
      if (requestId === sequence.current) setLoading(false);
    }
  }, [codeId, scopeKey]);

  useEffect(() => {
    void load();
    return () => { sequence.current += 1; };
  }, [load]);

  useEffect(() => {
    setQuery(urlQuery);
    setSort(SORTS.some(([value]) => value === urlSort) ? urlSort : 'sessions');
  }, [urlQuery, urlSort]);

  const rows = useMemo(
    () => sortUsageRows(filterUsageRows(payload?.rows || [], query), sort) as UsageUser[],
    [payload, query, sort],
  );
  const summary = useMemo(() => summarizeUsageRows(payload?.rows || []), [payload]);
  const codePayload = codeId && payload ? payload as CodeUsagePayload : null;

  const updateUrl = (nextQuery: string, nextSort: string) => {
    const url = new URL(window.location.href);
    if (nextQuery.trim()) url.searchParams.set('q', nextQuery.trim()); else url.searchParams.delete('q');
    if (nextSort !== 'sessions') url.searchParams.set('sort', nextSort); else url.searchParams.delete('sort');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  };

  const updateQuery = (next: string) => { setQuery(next); updateUrl(next, sort); };
  const updateSort = (next: string) => { setSort(next); updateUrl(query, next); };
  const shownSummary = codePayload ? {
    users: codePayload.aggregate.assignedUserCount,
    activeUsers: codePayload.aggregate.totalSessions == null ? null : summary.activeUsers,
    sessions: codePayload.aggregate.totalSessions,
    aiCostUsd: codePayload.aggregate.totalAiCostUsd,
    degradedRows: summary.degradedRows,
  } : summary;

  return (
    <main className="aus-shell">
      <header className="aus-header">
        <div>
          <p className="aus-eyebrow">Vận hành · Hoạt động</p>
          <h1>{codePayload ? `Hoạt động mã ${codePayload.code.value}` : 'Hoạt động người dùng'}</h1>
          <p className="aus-subtitle">{codePayload
            ? 'Tổng hợp những tài khoản đang gắn với mã này; lịch sử kích hoạt đã gỡ không được tính vào roster hiện tại.'
            : 'Đối chiếu số phiên Speaking, lần hoạt động gần nhất và chi phí AI đã ghi nhận theo từng tài khoản.'}</p>
        </div>
        <div className="aus-header-actions">{codeId && <a className="btn-secondary" href="/admin/users?tab=codes">← Mã kích hoạt</a>}<button className="btn-secondary" type="button" onClick={() => void load()} disabled={loading}>{loading ? 'Đang làm mới…' : 'Làm mới'}</button></div>
      </header>

      {error && <div className="aus-banner is-error" role="alert"><div><strong>{payload ? 'Không thể làm mới — đang giữ dữ liệu cũ.' : 'Không tải được hoạt động người dùng.'}</strong><span>{error}</span></div><button className="btn-secondary" type="button" disabled={loading} onClick={() => void load()}>Thử lại</button></div>}
      {loading && !payload && <div className="aus-state" role="status">Đang tổng hợp hoạt động…</div>}

      {payload && <>
        <section className="aus-summary" aria-label="Tổng quan hoạt động">
          <div><span>{codePayload ? 'Đang gắn mã' : 'Tài khoản'}</span><strong>{formatUsageCount(shownSummary.users)}</strong></div>
          <div><span>Đã từng hoạt động</span><strong>{formatUsageCount(shownSummary.activeUsers)}</strong></div>
          <div><span>Tổng phiên Speaking</span><strong>{formatUsageCount(shownSummary.sessions)}</strong></div>
          <div><span>Chi phí AI ước tính</span><strong>{formatUsageCost(shownSummary.aiCostUsd)}</strong></div>
        </section>

        {codePayload && <section className="aus-code-context" aria-label="Thông tin mã"><div><span>Loại mã</span><strong>{codePayload.code.codeType || '—'}</strong></div><div><span>Giới hạn phiên</span><strong>{codePayload.code.sessionLimit == null ? 'Không giới hạn' : formatUsageCount(codePayload.code.sessionLimit)}</strong></div><div><span>Mã lớp</span><strong>{codePayload.code.cohortId || 'Không gắn lớp'}</strong></div></section>}
        {shownSummary.degradedRows > 0 && <div className="aus-banner is-warning" role="status"><div><strong>Một phần số liệu không đọc được.</strong><span>{shownSummary.degradedRows} tài khoản có metric bị lỗi; dấu — không có nghĩa là 0.</span></div></div>}
        {payload.malformedCount > 0 && <div className="aus-banner is-warning" role="status"><div><strong>Dữ liệu không hợp lệ đã bị loại.</strong><span>{payload.malformedCount} bản ghi sai định dạng hoặc trùng mã người dùng.</span></div></div>}

        <section className="aus-directory">
          <div className="aus-directory-head"><div><p>Danh sách</p><h2>{codePayload ? 'Người dùng đang gắn mã' : 'Tất cả tài khoản'}</h2></div><div className="aus-controls"><label>Tìm người dùng<input aria-label="Tìm người dùng" type="search" value={query} onChange={(event) => updateQuery(event.target.value)} placeholder="Tên, email hoặc mã…" /></label><label>Sắp xếp<select aria-label="Sắp xếp" value={sort} onChange={(event) => updateSort(event.target.value)}>{SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div></div>
          <p className="aus-results" aria-live="polite">Hiển thị {rows.length} / {payload.rows.length} người dùng</p>
          {rows.length ? <UsageTable rows={rows} /> : <div className="aus-state is-empty"><strong>{payload.rows.length ? 'Không tìm thấy người dùng' : codePayload ? 'Mã chưa có người dùng đang gắn' : 'Chưa có tài khoản nào'}</strong><span>{payload.rows.length ? 'Thử tên, email hoặc mã khác.' : codePayload ? 'Đây là roster hiện tại, không phải lịch sử kích hoạt.' : 'Backend chưa trả về tài khoản.'}</span></div>}
        </section>
      </>}
    </main>
  );
}

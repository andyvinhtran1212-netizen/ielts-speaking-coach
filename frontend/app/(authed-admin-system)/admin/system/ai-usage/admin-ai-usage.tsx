'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAdminProfile } from '@/components/admin-access-gate';
import { coverageMessage, formatCount, formatUsd, normalizeAiUsagePayload, serviceLabel, serviceRows } from '@/lib/admin-ai-usage-model.mjs';
import type { AiUsagePayload, UserUsage } from './admin-ai-usage-types';

const PERIODS = [['1', 'Hôm nay'], ['7', '7 ngày'], ['30', '30 ngày'], ['90', '90 ngày'], ['all', 'Tất cả']] as const;

function messageOf(value: unknown) { return value instanceof Error ? value.message : String(value || 'lỗi không xác định'); }
function userLabel(row: UserUsage) { return row.displayName || row.email || row.userId; }

export function AdminAiUsage() {
  const profile = useAdminProfile();
  const searchParams = useSearchParams();
  const requestedDays = searchParams?.get('days') ?? '7';
  const initialDays = PERIODS.some(([value]) => value === requestedDays) ? requestedDays : '7';
  const [days, setDays] = useState(initialDays);
  const [payload, setPayload] = useState<AiUsagePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);

  const load = useCallback(async (period: string) => {
    const requestId = ++sequence.current;
    setLoading(true); setError(null);
    try {
      const path = `/admin/ai-usage${period === 'all' ? '' : `?days=${encodeURIComponent(period)}`}`;
      const normalized = normalizeAiUsagePayload(await window.api.get<unknown>(path)) as AiUsagePayload | null;
      if (!normalized) throw new Error('Dữ liệu chi phí AI không đúng định dạng.');
      if (requestId === sequence.current) setPayload(normalized);
    } catch (caught) {
      if (requestId === sequence.current) setError(messageOf(caught));
    } finally {
      if (requestId === sequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setPayload(null);
    void load(days);
    return () => { sequence.current += 1; };
  }, [profile.id, days, load]);

  const changeDays = (next: string) => {
    setDays(next);
    const url = new URL(window.location.href);
    url.searchParams.set('days', next);
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  };

  return (
    <main className="aiun-shell">
      <header className="aiun-header">
        <div><a href="/admin/system">← Hệ thống</a><p>Vận hành · Chi phí</p><h1>Chi phí AI</h1><span>Ước tính từ log sử dụng đã lưu; không phải hoá đơn của nhà cung cấp.</span></div>
        <div className="aiun-actions"><label>Khoảng thời gian<select value={days} onChange={(event) => changeDays(event.target.value)} disabled={loading}>{PERIODS.map(([value, label]) => <option key={label} value={value}>{label}</option>)}</select></label><button className="btn-secondary" type="button" disabled={loading} onClick={() => void load(days)}>{loading ? 'Đang tải…' : 'Làm mới'}</button></div>
      </header>

      {error && <div className="aiun-banner is-error" role="alert"><div><strong>{payload ? 'Không thể làm mới — đang giữ dữ liệu cũ.' : 'Không tải được chi phí AI.'}</strong><span>{error}</span></div><button className="btn-secondary" disabled={loading} onClick={() => void load(days)}>Thử lại</button></div>}
      {loading && !payload && <div className="aiun-state" role="status">Đang tổng hợp chi phí AI…</div>}
      {payload && <>
        <div className={`aiun-banner${payload.meta.truncated || payload.meta.totalMatchingRows == null ? ' is-warning' : ''}`} role="status">{coverageMessage(payload.meta)}</div>
        {payload.malformedCount > 0 && <div className="aiun-banner is-warning" role="status">{payload.malformedCount} mục dịch vụ hoặc người dùng sai định dạng đã bị loại.</div>}
        <section className="aiun-summary" aria-label="Tổng quan chi phí AI"><div><span>Chi phí ước tính</span><strong>{formatUsd(payload.overall.cost)}</strong></div><div><span>Lượt gọi</span><strong>{formatCount(payload.overall.calls)}</strong></div><div><span>Người dùng / nguồn</span><strong>{formatCount(payload.users.length)}</strong></div></section>
        <section className="aiun-section"><div className="aiun-section__head"><div><p>Theo dịch vụ</p><h2>Phân bổ chi phí</h2></div></div><div className="aiun-services">{serviceRows(payload.overall.services).map(([name, usage]) => <article key={name}><span>{serviceLabel(name)}</span><strong>{formatUsd(usage.cost)}</strong><small>{formatCount(usage.calls)} lượt gọi</small></article>)}</div></section>
        <section className="aiun-section"><div className="aiun-section__head"><div><p>Theo tài khoản</p><h2>Người dùng phát sinh chi phí</h2></div><span>{payload.users.length}</span></div>{payload.users.length ? <div className="aiun-users">{payload.users.map((row) => <article key={row.userId}><div className="aiun-user"><strong>{userLabel(row)}</strong>{row.displayName && row.email && <span>{row.email}</span>}<code>{row.userId}</code></div><div className="aiun-user-total"><strong>{formatUsd(row.cost)}</strong><span>{formatCount(row.calls)} lượt</span></div><dl>{serviceRows(row.services).map(([name, usage]) => <div key={name}><dt>{serviceLabel(name)}</dt><dd>{formatUsd(usage.cost)}</dd></div>)}</dl></article>)}</div> : <div className="aiun-state">Chưa có log sử dụng AI trong phạm vi này.</div>}</section>
      </>}
    </main>
  );
}

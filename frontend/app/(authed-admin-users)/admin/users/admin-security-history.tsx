'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { getBrowserJsonAt } from '@/lib/browser-api';

import {
  actorText,
  alertBadge,
  eventLabel,
  formatVietnamTime,
  normalizeSecurityHistory,
  sourceLabel,
  transitionText,
} from './admin-staff-security-model.mjs';
import { EmptyState, LoadingState } from './admin-user-ui';

type HistoryRow = NonNullable<ReturnType<typeof normalizeSecurityHistory>>[number];
type HistoryState = { phase: 'loading' } | { phase: 'error' } | { phase: 'ready'; rows: HistoryRow[] };

const BADGE_CLASS: Record<string, string> = { sent: 'is-active', pending: 'is-draft', failed: 'is-revoked' };

// ADMINAAL2-0032 FR-015: the target's privilege and security history from
// GET /admin/users/{id}/security-audit. A failed or malformed read is shown
// as a failure with a retry, never as an empty history.
export function AdminSecurityHistory({ userId }: { userId: string }) {
  const [state, setState] = useState<HistoryState>({ phase: 'loading' });
  const sequence = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++sequence.current;
    setState({ phase: 'loading' });
    try {
      const rows = normalizeSecurityHistory(await getBrowserJsonAt(
        '/admin/users/{user_id}/security-audit',
        `/admin/users/${encodeURIComponent(userId)}/security-audit?limit=50`,
      ));
      if (requestId !== sequence.current) return;
      setState(rows ? { phase: 'ready', rows } : { phase: 'error' });
    } catch {
      if (requestId === sequence.current) setState({ phase: 'error' });
    }
  }, [userId]);

  useEffect(() => {
    void load();
    return () => { sequence.current += 1; };
  }, [load]);

  if (state.phase === 'loading') return <LoadingState label="Đang tải lịch sử…" />;
  if (state.phase === 'error') {
    return (
      <div className="au-inline-error" role="alert" data-testid="security-history-error">
        <span>⚠ không tải được lịch sử</span>{' '}
        <button className="adm-btn-secondary adm-btn-sm" type="button" onClick={() => void load()}>Thử lại</button>
      </div>
    );
  }
  if (!state.rows.length) return <EmptyState title="Chưa có thay đổi quyền nào" detail="Lịch sử sẽ hiện khi vai trò, trạng thái hoặc xác thực 2 bước của tài khoản thay đổi." />;
  return (
    <div className="au-table-scroll" data-testid="security-history-scroll">
      <table className="au-table">
        <thead><tr>
          <th>Thời gian (giờ Việt Nam)</th>
          <th>Sự kiện</th>
          <th>Trước → sau</th>
          <th>Người thực hiện</th>
          <th>Nguồn</th>
          <th>Lý do</th>
          <th>Cảnh báo owner</th>
        </tr></thead>
        <tbody>{state.rows.map((row) => {
          const badge = alertBadge(row.alertStatus);
          return <tr key={row.id}>
            <td><time dateTime={row.occurredAt}>{formatVietnamTime(row.occurredAt)}</time></td>
            <td>{eventLabel(row.event)}</td>
            <td>{transitionText(row.before, row.after)}</td>
            <td>{actorText(row)}</td>
            <td>{sourceLabel(row.source)}</td>
            <td>{row.reason || '—'}</td>
            <td>{badge ? <span className={`adm-status-pill ${BADGE_CLASS[badge.tone] || ''}`}>{badge.text}</span> : '—'}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  );
}

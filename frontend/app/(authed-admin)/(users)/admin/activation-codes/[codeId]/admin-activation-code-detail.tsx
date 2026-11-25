'use client';

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';

import { useAdminProfile } from '@/components/admin-access-gate';
import {
  REVOKE_REASON_MAX,
  REVOKE_REASON_MIN,
  activeAssignmentCount,
  auditActionLabel,
  codeLedgerState,
  normalizeCodeAudit,
  normalizeCodeDetail,
  revokeUsedDraftError,
  revokeUsedResultMessage,
} from '@/lib/admin-users-model.mjs';

import type { AccessCode } from '../../users/admin-user-types';
import { LoadingState, StatusBanner, codeTypeLabel, formatDate, messageOf } from '../../users/admin-user-ui';

type AuditEntry = {
  id: string;
  action: string;
  actor_user_id: string | null;
  target_user_id: string | null;
  created_at: string | null;
  reason: string | null;
  affected_user_count: number | null;
  source: string | null;
};

type DetailUser = AccessCode['assigned_users'][number] & { is_active?: boolean; assigned_at?: string | null };
type Detail = Omit<AccessCode, 'assigned_users'> & { assigned_users: DetailUser[]; access_holders: { user_id: string; name: string; email: string }[] | null };

type Banner = { kind: 'success' | 'error'; text: string } | null;

function statusOf(caught: unknown) {
  return caught && typeof caught === 'object' && 'status' in caught ? Number((caught as { status: unknown }).status) : 0;
}

function formatDateTime(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('vi-VN');
}

// ADMINIA-0074 FR-055: the code page. Details, people and the code's own
// audit history; revoking a code that has been used happens only here, in the
// danger zone, with the code retyped and a required reason. Every write is
// followed by a canonical reload of the code and its history.
export function AdminActivationCodeDetail({ codeId }: { codeId: string }) {
  const profile = useAdminProfile();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<Banner>(null);
  const [confirmCode, setConfirmCode] = useState('');
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const ids = useId();

  const load = useCallback(async () => {
    const requestId = ++sequence.current;
    setLoading(true);
    const path = `/admin/access-codes/${encodeURIComponent(codeId)}`;
    const [detailResult, auditResult] = await Promise.allSettled([
      window.api.get(path),
      window.api.get(`${path}/audit`),
    ]);
    if (requestId !== sequence.current) return;
    if (detailResult.status === 'fulfilled') {
      setDetail(normalizeCodeDetail(detailResult.value) as Detail | null);
      setLoadError(null);
      setNotFound(false);
    } else {
      setDetail(null);
      setNotFound(statusOf(detailResult.reason) === 404);
      setLoadError(messageOf(detailResult.reason));
    }
    if (auditResult.status === 'fulfilled') {
      setAudit(normalizeCodeAudit(auditResult.value) as AuditEntry[]);
      setAuditError(null);
    } else {
      setAudit([]);
      setAuditError(messageOf(auditResult.reason));
    }
    setLoading(false);
  }, [codeId]);

  useEffect(() => {
    setDetail(null);
    void load();
    return () => { sequence.current += 1; };
  }, [profile.id, load]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!detail || busy) return;
    const problem = revokeUsedDraftError({ code: detail.code, confirmCode, reason });
    setFormError(problem);
    if (problem) return;
    setBusy(true);
    setBanner(null);
    try {
      const result = await window.api.post(`/admin/access-codes/${encodeURIComponent(detail.id)}/revoke-used`, {
        confirm_code: confirmCode.trim(),
        reason: reason.trim(),
      });
      setConfirmCode('');
      setReason('');
      await load();
      setBanner(revokeUsedResultMessage(result) as Banner);
    } catch (caught) {
      setFormError(messageOf(caught));
      // The backend writes the reason first; reload so the page shows the
      // code's real state and history whatever step failed.
      await load();
    } finally {
      setBusy(false);
    }
  };

  const state = detail ? codeLedgerState(detail) : null;
  // The server's list (same count the revoke reports); null = unknown.
  const losing = detail?.access_holders ?? [];
  const dangerBlocked = detail && (detail.association_lookup_failed || detail.access_holders == null)
    ? 'Không xác minh được ai đang dùng mã; tải lại trang rồi thử lại.' : null;

  return (
    <main className="au-shell">
      <p className="au-related-link"><a href="/admin/activation-codes">← Sổ mã kích hoạt</a></p>
      <header className="au-header">
        <div>
          <p className="au-eyebrow">Mã kích hoạt</p>
          <h1>{detail ? <code className="au-code-value">{detail.code}</code> : 'Chi tiết mã'}</h1>
          {state && <p data-ledger-state={state.state}>Trạng thái: <strong>{state.label}</strong>{state.state === 'used' && detail?.used_at ? ` · ngày ${formatDate(detail.used_at)}` : ''}</p>}
        </div>
        <div className="au-header__meta">
          <span>Admin đang thao tác</span>
          <strong>{profile.email || profile.id}</strong>
        </div>
      </header>

      <StatusBanner banner={banner} />

      {loading && !detail && <LoadingState label="Đang tải mã kích hoạt…" />}
      {!loading && !detail && (
        <div className="au-banner is-error" role="alert">
          {notFound ? 'Mã kích hoạt không tồn tại.' : `Không tải được mã: ${loadError || 'lỗi không xác định'}`}
          {!notFound && <> <button type="button" className="adm-btn-secondary adm-btn-sm" onClick={() => void load()}>Thử lại</button></>}
        </div>
      )}

      {detail && (
        <>
          <section className="au-detail-card" aria-labelledby={`${ids}-info`}>
            <h2 id={`${ids}-info`}>Thông tin mã</h2>
            <dl className="au-detail-grid">
              <div><dt>Loại</dt><dd>{codeTypeLabel(detail.code_type)}</dd></div>
              <div><dt>Quyền</dt><dd>{detail.permissions.length ? detail.permissions.join(', ') : '—'}</dd></div>
              <div><dt>Giới hạn lượt</dt><dd>{detail.session_limit == null ? '∞' : detail.session_limit.toLocaleString('vi-VN')}</dd></div>
              <div><dt>Hạn nhập mã</dt><dd>{formatDate(detail.expires_at)}</dd></div>
              <div><dt>Ngày tạo</dt><dd>{formatDate(detail.created_at)}</dd></div>
              <div><dt>Ghi chú</dt><dd className="au-notes">{detail.notes || '—'}</dd></div>
            </dl>
          </section>

          <section className="au-detail-card" aria-labelledby={`${ids}-people`}>
            <h2 id={`${ids}-people`}>Người dùng mã</h2>
            {detail.association_lookup_failed ? <p className="au-lookup-failed" role="alert">⚠ lookup failed: không tải được danh sách người dùng mã.</p>
              : detail.assigned_users.length ? <ul className="au-detail-list">{detail.assigned_users.map((user) => (
                <li key={`${user.user_id}-${user.assigned_at || ''}`}>
                  <span>{user.email || user.name || '(không rõ)'}</span>
                  {user.is_fallback_used_by ? <small className="au-history-label">lịch sử kích hoạt</small>
                    : user.is_active ? <small>đang dùng · từ {formatDate(user.assigned_at || null)}</small>
                      : <small className="au-muted">đã gỡ</small>}
                </li>
              ))}</ul> : <p className="au-muted">Chưa ai dùng mã này.</p>}
          </section>

          <section className="au-detail-card" aria-labelledby={`${ids}-audit`}>
            <h2 id={`${ids}-audit`}>Lịch sử thao tác</h2>
            {auditError ? <p className="au-lookup-failed" role="alert">⚠ Không tải được lịch sử thao tác: {auditError}</p>
              : audit.length ? <ol className="au-detail-list" data-testid="code-audit">{audit.map((entry) => (
                <li key={entry.id}>
                  <span><strong>{auditActionLabel(entry.action)}</strong> · {formatDateTime(entry.created_at)}</span>
                  {entry.reason && <small>Lý do: {entry.reason}</small>}
                  {entry.affected_user_count != null && <small>{entry.affected_user_count} học viên mất quyền</small>}
                </li>
              ))}</ol> : <p className="au-muted">Chưa có thao tác nào được ghi.</p>}
          </section>

          <section className="au-danger-zone" aria-labelledby={`${ids}-danger`}>
            <h2 id={`${ids}-danger`}>Vùng nguy hiểm</h2>
            {detail.is_revoked ? <p>Mã đã thu hồi. Không thao tác thêm được.</p>
              : state?.state !== 'used' ? <p>Mã chưa ai dùng. Thu hồi mã chưa dùng ở menu "⋯" của dòng mã trong <a href="/admin/activation-codes">sổ mã kích hoạt</a>.</p>
                : (
                  <form onSubmit={(event) => void submit(event)} noValidate>
                    <p><strong>Thu hồi mã đã dùng.</strong> Mã ngừng cấp quyền ngay, không khôi phục được. {losing.length
                      ? `${losing.length} học viên đang nhận quyền từ mã này sẽ mất quyền ngay: ${losing.map((user) => user.email || user.name || user.user_id).join(', ')}.`
                      : 'Hiện không còn học viên nào nhận quyền từ mã này.'} Lịch sử kích hoạt vẫn được giữ.</p>
                    {dangerBlocked && <p className="au-lookup-failed" role="alert">{dangerBlocked}</p>}
                    <label className="au-field">
                      <span>Gõ lại mã {detail.code} để xác nhận</span>
                      <input value={confirmCode} onChange={(event) => setConfirmCode(event.target.value)} autoComplete="off" spellCheck={false} disabled={busy || Boolean(dangerBlocked)} />
                    </label>
                    <label className="au-field">
                      <span>Lý do thu hồi (bắt buộc)</span>
                      <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={REVOKE_REASON_MAX} disabled={busy || Boolean(dangerBlocked)} />
                      <small>Ít nhất {REVOKE_REASON_MIN} ký tự. Lý do được ghi vào lịch sử thao tác của mã.</small>
                    </label>
                    {formError && <p className="au-form-error" role="alert">{formError}</p>}
                    <button type="submit" className="adm-btn-danger" disabled={busy || Boolean(dangerBlocked)}>{busy ? 'Đang thu hồi…' : 'Thu hồi mã đã dùng'}</button>
                    {activeAssignmentCount(detail) > 0 && <p className="au-muted">Muốn giữ mã cho người khác? Gỡ từng người ở sổ mã thay vì thu hồi.</p>}
                  </form>
                )}
          </section>
        </>
      )}
    </main>
  );
}

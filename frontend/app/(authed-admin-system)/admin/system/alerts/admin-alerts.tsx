'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { useAdminProfile } from '@/components/admin-access-gate';
import {
  alertsForScope,
  formatAlertTime,
  normalizeAlertsPayload,
  sessionAlertLabel,
  shortId,
} from '@/lib/admin-alerts-model.mjs';

import type { AlertScope, AlertsPayload, GradingAlert, SessionAlert } from './admin-alerts-types';

function messageOf(caught: unknown) {
  return caught instanceof Error ? caught.message : String(caught || 'lỗi không xác định');
}

function identity(email: string | null, userId?: string | null) {
  return email || userId || 'Không lấy được danh tính';
}

function validDateTime(value: string | null) {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function SessionCard({ row }: { row: SessionAlert }) {
  const href = `/pages/admin/speaking/sessions.html?session=${encodeURIComponent(row.id)}`;
  return (
    <article className="aln-item">
      <div className="aln-item__head">
        <div>
          <span className="adm-status-pill is-revoked">{sessionAlertLabel(row.errorCode)}</span>
          <h3>{row.errorMessage || 'Không có thông báo lỗi từ hệ thống'}</h3>
        </div>
        <time dateTime={validDateTime(row.occurredAt)}>{formatAlertTime(row.occurredAt)}</time>
      </div>
      <dl className="aln-facts">
        <div><dt>Học viên</dt><dd>{identity(row.userEmail, row.userId)}</dd></div>
        <div><dt>Session</dt><dd><code title={row.id}>{shortId(row.id)}</code></dd></div>
        <div><dt>Bước lỗi</dt><dd><code>{row.failedStep || 'Chưa rõ'}</code></dd></div>
        <div><dt>Ngữ cảnh</dt><dd>{[row.mode, row.part && `Part ${row.part}`].filter(Boolean).join(' · ') || 'Chưa rõ'}</dd></div>
      </dl>
      <div className="aln-item__actions">
        <a className="btn-secondary" href={href}>Mở session</a>
      </div>
    </article>
  );
}

function GradingCard({ row }: { row: GradingAlert }) {
  const href = `/pages/admin/speaking/sessions.html?session=${encodeURIComponent(row.sessionId)}`;
  return (
    <article className="aln-item">
      <div className="aln-item__head">
        <div>
          <span className="adm-status-pill is-revoked">Response chưa chấm được</span>
          <h3>{identity(row.userEmail)}</h3>
        </div>
        <a className="btn-secondary" href={href}>Mở session</a>
      </div>
      <dl className="aln-facts">
        <div><dt>Response</dt><dd><code title={row.id}>{shortId(row.id)}</code></dd></div>
        <div><dt>Session</dt><dd><code title={row.sessionId}>{shortId(row.sessionId)}</code></dd></div>
        <div><dt>Grading</dt><dd>{row.gradingStatus || 'Chưa rõ'}</dd></div>
        <div><dt>STT</dt><dd>{row.sttStatus || 'Chưa rõ'}</dd></div>
      </dl>
    </article>
  );
}

export function AdminAlerts() {
  const profile = useAdminProfile();
  const searchParams = useSearchParams();
  const initialScope = searchParams?.get('scope');
  const [scope, setScope] = useState<AlertScope>(
    initialScope === 'sessions' || initialScope === 'grading' ? initialScope : 'all',
  );
  const [payload, setPayload] = useState<AlertsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const sequence = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++sequence.current;
    setLoading(true);
    setError(null);
    try {
      const normalized = normalizeAlertsPayload(await window.api.get<unknown>('/admin/alerts?limit=30')) as AlertsPayload | null;
      if (!normalized) throw new Error('Dữ liệu sự cố không đúng định dạng.');
      if (requestId !== sequence.current) return;
      setPayload(normalized);
      setUpdatedAt(new Date());
    } catch (caught) {
      if (requestId !== sequence.current) return;
      setError(messageOf(caught));
    } finally {
      if (requestId === sequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setPayload(null);
    setUpdatedAt(null);
    void load();
    return () => { sequence.current += 1; };
  }, [profile.id, load]);

  const visible = useMemo<{ sessionErrors: SessionAlert[]; gradingFailures: GradingAlert[] }>(
    () => alertsForScope(payload, scope),
    [payload, scope],
  );
  const total = (payload?.sessionErrors.length || 0) + (payload?.gradingFailures.length || 0);

  const updateScope = (next: AlertScope) => {
    setScope(next);
    const url = new URL(window.location.href);
    if (next === 'all') url.searchParams.delete('scope');
    else url.searchParams.set('scope', next);
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  };

  return (
    <main className="aln-shell">
      <header className="aln-header">
        <div>
          <a className="aln-back" href="/admin/system">← Hệ thống</a>
          <p className="aln-eyebrow">Vận hành · Speaking</p>
          <h1>Sự cố chấm bài</h1>
          <p className="aln-subtitle">Theo dõi session lỗi và response chưa chấm được từ dữ liệu backend gần nhất.</p>
        </div>
        <button className="btn-secondary" type="button" onClick={() => void load()} disabled={loading}>
          {loading ? 'Đang làm mới…' : 'Làm mới'}
        </button>
      </header>

      <section className="aln-summary" aria-label="Tổng quan sự cố">
        <div><span>Tổng đang hiển thị</span><strong>{payload ? total : '—'}</strong></div>
        <div><span>Lỗi session</span><strong>{payload ? payload.sessionErrors.length : '—'}</strong></div>
        <div><span>Response lỗi</span><strong>{payload ? payload.gradingFailures.length : '—'}</strong></div>
      </section>

      <div className="aln-toolbar">
        <div className="aln-segmented" role="group" aria-label="Lọc phạm vi sự cố">
          {([['all', 'Tất cả'], ['sessions', 'Session'], ['grading', 'Response']] as const).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={scope === value} onClick={() => updateScope(value)}>{label}</button>
          ))}
        </div>
        <p aria-live="polite">{updatedAt ? `Cập nhật ${formatAlertTime(updatedAt.toISOString())} · tối đa 30 bản ghi mỗi nhóm` : 'Chưa có lần cập nhật thành công · tối đa 30 bản ghi mỗi nhóm'}</p>
      </div>

      {error && (
        <div className="aln-banner is-error" role="alert">
          <div>
            <strong>{payload ? 'Không thể làm mới — đang giữ dữ liệu của lần tải trước.' : 'Không tải được dữ liệu sự cố.'}</strong>
            <span>{error}</span>
          </div>
          <button className="btn-secondary" type="button" disabled={loading} onClick={() => void load()}>Thử lại</button>
        </div>
      )}
      {payload && payload.malformedCount > 0 && (
        <div className="aln-banner is-warning" role="status">
          {payload.malformedCount} bản ghi không đúng định dạng đã bị loại. Các số liệu bên dưới có thể chưa đầy đủ.
        </div>
      )}
      {loading && !payload && <div className="aln-state" role="status">Đang tải dữ liệu sự cố…</div>}

      {!loading && payload && total === 0 && (
        <div className="aln-state is-empty"><strong>Không có sự cố gần đây</strong><span>Backend chưa ghi nhận session hoặc response lỗi trong giới hạn hiện tại.</span></div>
      )}

      {payload && total > 0 && (
        <div className="aln-sections" aria-busy={loading}>
          {scope !== 'grading' && (
            <section className="aln-section" aria-labelledby="aln-session-title">
              <div className="aln-section__head"><div><p>Session-level</p><h2 id="aln-session-title">Lỗi trong luồng làm bài</h2></div><span>{visible.sessionErrors.length}</span></div>
              {visible.sessionErrors.length
                ? <div className="aln-list">{visible.sessionErrors.map((row) => <SessionCard key={row.id} row={row} />)}</div>
                : <div className="aln-state is-compact">Không có lỗi session trong phạm vi này.</div>}
            </section>
          )}
          {scope !== 'sessions' && (
            <section className="aln-section" aria-labelledby="aln-grading-title">
              <div className="aln-section__head"><div><p>Response-level</p><h2 id="aln-grading-title">Response chưa chấm được</h2></div><span>{visible.gradingFailures.length}</span></div>
              {visible.gradingFailures.length
                ? <div className="aln-list">{visible.gradingFailures.map((row) => <GradingCard key={row.id} row={row} />)}</div>
                : <div className="aln-state is-compact">Không có response lỗi trong phạm vi này.</div>}
            </section>
          )}
        </div>
      )}
    </main>
  );
}

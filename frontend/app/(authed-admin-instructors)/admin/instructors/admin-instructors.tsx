'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { useAdminProfile } from '@/components/admin-access-gate';
import {
  filterInstructors,
  formatInstructorCost,
  formatInstructorCount,
  instructorLabel,
  instructorWorkspaceHref,
  normalizeInstructorsPayload,
  summarizeInstructors,
} from '@/lib/admin-instructors-model.mjs';

import type { InstructorMetric, InstructorsPayload } from './admin-instructors-types';

function messageOf(caught: unknown) {
  return caught instanceof Error ? caught.message : String(caught || 'lỗi không xác định');
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="ain-metric"><dt>{label}</dt><dd>{value}</dd>{note && <small>{note}</small>}</div>;
}

function InstructorCard({ row }: { row: InstructorMetric }) {
  const href = instructorWorkspaceHref(row.instructorId);
  const label = instructorLabel(row);
  return (
    <article className="ain-card">
      <header className="ain-card__head">
        <div className="ain-identity">
          <span className="ain-avatar" aria-hidden="true">{label.slice(0, 1).toLocaleUpperCase('vi-VN')}</span>
          <div>
            <h2>{label}</h2>
            {row.displayName && row.email && <span>{row.email}</span>}
            <code title={row.instructorId}>{row.instructorId}</code>
          </div>
        </div>
        {href && <a className="btn-secondary" href={href} aria-label={`Mở workspace đã audit của ${label}`}>Mở workspace <span aria-hidden="true">→</span></a>}
      </header>
      <dl className="ain-metrics">
        <Metric label="Học viên thuộc GV" value={formatInstructorCount(row.students)} />
        <Metric label="Đề tự soạn" value={formatInstructorCount(row.prompts)} />
        <Metric label="Bài đã trả" value={formatInstructorCount(row.graded)} />
        <Metric label="Bài từng chấm lại" value={formatInstructorCount(row.regraded)} note="Bởi bất kỳ người chấm nào" />
        <Metric label="Tổng lượt chấm lại" value={formatInstructorCount(row.regradeEvents)} note="Cộng tất cả lượt trên các bài" />
        <Metric label="Token chấm Writing" value={formatInstructorCount(row.tokens)} note="Tất cả phiên bản feedback" />
        <Metric label="Chi phí ước tính" value={formatInstructorCost(row.costUsd)} note="Writing feedback · USD" />
      </dl>
    </article>
  );
}

export function AdminInstructors() {
  const profile = useAdminProfile();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams?.get('q') || '');
  const [payload, setPayload] = useState<InstructorsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++sequence.current;
    setLoading(true);
    setError(null);
    try {
      const normalized = normalizeInstructorsPayload(await window.api.get<unknown>('/admin/instructors')) as InstructorsPayload | null;
      if (!normalized) throw new Error('Dữ liệu giảng viên không đúng định dạng.');
      if (requestId === sequence.current) setPayload(normalized);
    } catch (caught) {
      if (requestId === sequence.current) setError(messageOf(caught));
    } finally {
      if (requestId === sequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setPayload(null);
    void load();
    return () => { sequence.current += 1; };
  }, [profile.id, load]);

  const visibleRows = useMemo(() => filterInstructors(payload?.rows || [], query) as InstructorMetric[], [payload, query]);
  const summary = useMemo(() => summarizeInstructors(payload?.rows || []), [payload]);

  const updateQuery = (next: string) => {
    setQuery(next);
    const url = new URL(window.location.href);
    if (next.trim()) url.searchParams.set('q', next.trim());
    else url.searchParams.delete('q');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  };

  return (
    <main className="ain-shell">
      <header className="ain-header">
        <div>
          <p className="ain-eyebrow">Đội ngũ · Writing</p>
          <h1>Giảng viên</h1>
          <p className="ain-subtitle">Đối chiếu roster, khối lượng chấm và chi phí Writing theo phạm vi sở hữu canonical của từng giảng viên.</p>
        </div>
        <button className="btn-secondary" type="button" onClick={() => void load()} disabled={loading}>{loading ? 'Đang làm mới…' : 'Làm mới'}</button>
      </header>

      <section className="ain-summary" aria-label="Tổng quan giảng viên">
        <div><span>Giảng viên</span><strong>{payload ? formatInstructorCount(summary.instructors) : '—'}</strong></div>
        <div><span>Học viên được gắn</span><strong>{payload ? formatInstructorCount(summary.students) : '—'}</strong></div>
        <div><span>Bài đã trả</span><strong>{payload ? formatInstructorCount(summary.graded) : '—'}</strong></div>
        <div><span>Chi phí Writing</span><strong>{payload ? formatInstructorCost(summary.costUsd) : '—'}</strong></div>
      </section>

      <aside className="ain-notice" aria-label="Lưu ý về dữ liệu và quyền truy cập">
        <strong>Giám sát chỉ đọc</strong>
        <span>“Bài từng chấm lại” không quy công cho giảng viên: đó là số bài trong phạm vi của họ đã được bất kỳ ai chấm lại. Khi mở workspace, mỗi request impersonation được backend ghi audit; nếu không ghi được audit, quyền truy cập bị từ chối.</span>
      </aside>

      {error && <div className="ain-banner is-error" role="alert"><div><strong>{payload ? 'Không thể làm mới — đang giữ dữ liệu cũ.' : 'Không tải được danh sách giảng viên.'}</strong><span>{error}</span></div><button className="btn-secondary" type="button" disabled={loading} onClick={() => void load()}>Thử lại</button></div>}
      {payload && payload.malformedCount > 0 && <div className="ain-banner is-warning" role="status">{payload.malformedCount} bản ghi sai định dạng hoặc trùng mã đã bị loại. Tổng số bên dưới có thể chưa đầy đủ.</div>}
      {loading && !payload && <div className="ain-state" role="status">Đang tổng hợp dữ liệu giảng viên…</div>}

      {payload && <section className="ain-directory" aria-busy={loading}>
        <div className="ain-directory__head">
          <div><p>Danh sách</p><h2>Phạm vi giảng viên</h2></div>
          <label className="ain-search"><span>Tìm giảng viên</span><input type="search" value={query} onChange={(event) => updateQuery(event.target.value)} placeholder="Tên, email hoặc mã…" /></label>
        </div>
        <p className="ain-results" aria-live="polite">Hiển thị {formatInstructorCount(visibleRows.length)} / {formatInstructorCount(payload.rows.length)} giảng viên</p>
        {visibleRows.length ? <div className="ain-list">{visibleRows.map((row) => <InstructorCard key={row.instructorId} row={row} />)}</div>
          : <div className="ain-state is-empty"><strong>{payload.rows.length ? 'Không tìm thấy giảng viên' : 'Chưa có tài khoản giảng viên'}</strong><span>{payload.rows.length ? 'Thử tên, email hoặc mã khác.' : 'Backend chưa trả về tài khoản có role instructor.'}</span></div>}
      </section>}
    </main>
  );
}

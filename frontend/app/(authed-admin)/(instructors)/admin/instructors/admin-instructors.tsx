'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { useAdminProfile } from '@/components/admin-access-gate';
import {
  filterInstructors,
  formatInstructorCost,
  formatInstructorCount,
  formatMaybeCount,
  formatReviewHours,
  instructorLabel,
  instructorProfileHref,
  instructorWorkspaceHref,
  nextTeacherSort,
  normalizeInstructorsPayload,
  parseTeacherSort,
  sortTeachers,
  summarizeInstructors,
} from '@/lib/admin-instructors-model.mjs';

import type { InstructorMetric, InstructorsPayload, TeacherSort, TeacherSortKey } from './admin-instructors-types';

function messageOf(caught: unknown) {
  return caught instanceof Error ? caught.message : String(caught || 'lỗi không xác định');
}

const CLASS_PREVIEW = 3;

function ClassList({ row }: { row: InstructorMetric }) {
  if (row.classes == null) return <span className="ain-muted">chưa có</span>;
  if (!row.classes.length) return <span className="ain-muted">Chưa có lớp</span>;
  const shown = row.classes.slice(0, CLASS_PREVIEW);
  const more = row.classes.length - shown.length;
  return (
    <span className="ain-classes">
      <strong>{formatInstructorCount(row.classes.length)} lớp</strong>
      <span>{shown.map((c) => c.name).join(', ')}{more > 0 ? ` +${more}` : ''}</span>
    </span>
  );
}

const COLUMNS: { key: TeacherSortKey; label: string }[] = [
  { key: 'name', label: 'Giảng viên' },
  { key: 'classes', label: 'Lớp đang dạy' },
  { key: 'pending', label: 'Bài chờ duyệt' },
  { key: 'speed', label: 'Duyệt trung bình' },
];

function SortHeader({ column, sort, onSort }: { column: { key: TeacherSortKey; label: string }; sort: TeacherSort; onSort: (key: TeacherSortKey) => void }) {
  const active = sort.key === column.key;
  return (
    <th scope="col" aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="ain-sort" onClick={() => onSort(column.key)}>
        {column.label}<span aria-hidden="true">{active ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}</span>
      </button>
    </th>
  );
}

function InstructorRow({ row }: { row: InstructorMetric }) {
  const label = instructorLabel(row);
  const profile = instructorProfileHref(row.instructorId);
  const workspace = instructorWorkspaceHref(row.instructorId);
  const speed = formatReviewHours(row.avgReviewHours);
  return (
    <tr>
      <th scope="row" data-label="Giảng viên">
        <span className="ain-identity">
          <span className="ain-avatar" aria-hidden="true">{label.slice(0, 1).toLocaleUpperCase('vi-VN')}</span>
          <span className="ain-identity__text">
            <strong>{label}</strong>
            {row.displayName && row.email && <span>{row.email}</span>}
          </span>
        </span>
      </th>
      <td data-label="Lớp đang dạy"><ClassList row={row} /></td>
      <td data-label="Bài chờ duyệt">
        <span className="ain-num">{formatMaybeCount(row.writingPending)}</span>
        {row.writingOverdue ? <small className="ain-overdue">{formatInstructorCount(row.writingOverdue)} quá hạn</small> : null}
      </td>
      <td data-label="Duyệt trung bình">{speed ? <span className="ain-num">{speed}</span> : <span className="ain-muted" title="Chưa đủ 5 bài trả trong 30 ngày">—</span>}</td>
      <td className="ain-actions" data-label="Hồ sơ">
        {profile && <a className="btn-secondary" href={profile} aria-label={`Mở hồ sơ ${label}`}>Mở hồ sơ</a>}
        {workspace && <a className="ain-link" href={workspace} aria-label={`Mở workspace đã audit của ${label}`}>Mở workspace <span aria-hidden="true">→</span></a>}
      </td>
    </tr>
  );
}

export function AdminInstructors() {
  const profile = useAdminProfile();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams?.get('q') || '');
  const [sort, setSort] = useState<TeacherSort>(() => parseTeacherSort(searchParams?.toString() || '') as TeacherSort);
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

  const visibleRows = useMemo(
    () => sortTeachers(filterInstructors(payload?.rows || [], query), sort) as InstructorMetric[],
    [payload, query, sort],
  );
  const summary = useMemo(() => summarizeInstructors(payload?.rows || []), [payload]);

  const replaceParams = (edit: (params: URLSearchParams) => void) => {
    const url = new URL(window.location.href);
    edit(url.searchParams);
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  };

  const updateQuery = (next: string) => {
    setQuery(next);
    replaceParams((params) => {
      if (next.trim()) params.set('q', next.trim());
      else params.delete('q');
    });
  };

  const updateSort = (key: TeacherSortKey) => {
    const next = nextTeacherSort(sort, key) as TeacherSort;
    setSort(next);
    replaceParams((params) => {
      if (next.key === 'name' && next.dir === 'asc') { params.delete('sort'); params.delete('dir'); }
      else { params.set('sort', next.key); params.set('dir', next.dir); }
    });
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
        <span>“Bài chờ duyệt” là bài Writing (không tính thi thử) đã chấm AI, đang chờ duyệt hoặc AI lỗi, ở các lớp người đó phụ trách. “Duyệt trung bình”: từ lúc AI chấm xong tới lúc giáo viên trả bài, 30 ngày gần nhất; chưa đủ 5 bài thì để trống. Khi mở workspace, mỗi request impersonation được backend ghi audit; nếu không ghi được audit, quyền truy cập bị từ chối.</span>
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
        {visibleRows.length ? <div className="ain-table-wrap">
          <table className="ain-table">
            <caption className="ain-sr">Giảng viên, lớp đang dạy, bài Writing chờ duyệt và thời gian duyệt trung bình 30 ngày. Bấm tiêu đề cột để sắp xếp.</caption>
            <thead><tr>{COLUMNS.map((column) => <SortHeader key={column.key} column={column} sort={sort} onSort={updateSort} />)}<th scope="col"><span className="ain-sr">Hồ sơ</span></th></tr></thead>
            <tbody>{visibleRows.map((row) => <InstructorRow key={row.instructorId} row={row} />)}</tbody>
          </table>
        </div>
          : <div className="ain-state is-empty"><strong>{payload.rows.length ? 'Không tìm thấy giảng viên' : 'Chưa có tài khoản giảng viên'}</strong><span>{payload.rows.length ? 'Thử tên, email hoặc mã khác.' : 'Backend chưa trả về tài khoản có role instructor.'}</span></div>}
      </section>}
    </main>
  );
}

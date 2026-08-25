'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAdminProfile } from '@/components/admin-access-gate';
import { messageOf } from '@/components/admin-directory-ui';
import {
  cellMatchesFilter, cohortFilters, cohortHref, cohortMatches,
  isOverdue, normalizeCohortDetail, normalizeCohortList,
} from '@/lib/admin-writing-cohorts-model.mjs';

type Cohort = { id: string; name: string; description: string | null; studentCount: number; activeAssignments: number; essaysPending: number; essaysDelivered: number };
type Student = { id: string; name: string | null; code: string | null };
type Column = { id: string; promptId: string; groupId: string | null; name: string | null; title: string; taskType: string | null; assignedAt: string | null };
type CellStatus = 'not_submitted' | 'pending' | 'submitted' | 'grading' | 'graded' | 'reviewed' | 'delivered' | 'failed' | 'flagged';
type Cell = { assignmentId: string; status: CellStatus; essayId: string | null; deadline: string | null; updatedAt: string | null; band: number | null };
type Detail = { cohort: { id: string; name: string; description: string | null; studentCount: number }; students: Student[]; columns: Column[]; matrix: Record<string, Record<string, Cell>>; stats: { students: number; assignments: number; essaysPending: number; essaysDelivered: number; overdue: number }; malformedCount: number };
type ListSnapshot = { account: string; rows: Cohort[]; malformed: number; readAt: string };
type DetailSnapshot = { account: string; cohortId: string; value: Detail; readAt: string };

const STATUS: Record<CellStatus, { label: string; short: string; lane: string }> = {
  not_submitted: { label: 'Chưa nộp', short: 'Chưa nộp', lane: 'muted' },
  pending: { label: 'Chờ chấm', short: 'Chờ chấm', lane: 'info' },
  submitted: { label: 'Đã nộp, chờ chấm', short: 'Đã nộp', lane: 'info' },
  grading: { label: 'Đang chấm', short: 'Đang chấm', lane: 'info' },
  graded: { label: 'Đã chấm, cần review', short: 'Cần review', lane: 'review' },
  reviewed: { label: 'Đã review, chờ trả', short: 'Chờ trả', lane: 'review' },
  delivered: { label: 'Đã trả học viên', short: 'Đã trả', lane: 'success' },
  failed: { label: 'Chấm lỗi', short: 'Lỗi', lane: 'error' },
  flagged: { label: 'Bài bị đánh dấu', short: 'Đánh dấu', lane: 'warning' },
};
const STATUS_FILTERS = [
  ['all', 'Tất cả ô'], ['needs_grade', 'Cần chấm'], ['needs_review', 'Cần review / trả'],
  ['delivered', 'Đã trả'], ['overdue', 'Quá hạn'], ['issues', 'Lỗi / đánh dấu'],
] as const;
const TASK: Record<string, string> = { task1_academic: 'Task 1 Academic', task1_general: 'Task 1 General', task2: 'Task 2' };
const formatDate = (value: string | null, withTime = false) => value ? new Intl.DateTimeFormat('vi-VN', withTime ? { dateStyle: 'short', timeStyle: 'short' } : { dateStyle: 'short' }).format(new Date(value)) : '—';

export function AdminWritingCohorts() {
  const profile = useAdminProfile(); const router = useRouter(); const params = useSearchParams();
  // `cohort_id` is the legacy deep-link shape. Read it as an alias so old
  // bookmarks survive cutover; every native navigation writes canonical `cohort`.
  const filters = useMemo(() => cohortFilters({ cohort: params?.get('cohort') || params?.get('cohort_id'), status: params?.get('status'), activity: params?.get('activity'), q: params?.get('q') }), [params]);
  const [query, setQuery] = useState(filters.q); const [listSnapshot, setListSnapshot] = useState<ListSnapshot | null>(null);
  const [detailSnapshot, setDetailSnapshot] = useState<DetailSnapshot | null>(null);
  const [listLoading, setListLoading] = useState(true); const [detailLoading, setDetailLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null); const [detailError, setDetailError] = useState<string | null>(null);
  const listRequest = useRef(0); const detailRequest = useRef(0); const accountRef = useRef(profile.id); accountRef.current = profile.id;
  const list = listSnapshot?.account === profile.id ? listSnapshot : null;
  const detail = detailSnapshot?.account === profile.id && detailSnapshot.cohortId === filters.cohort ? detailSnapshot : null;

  const navigate = useCallback((next: { cohort?: string; status?: string; activity?: string; q?: string }) => router.replace(cohortHref(next), { scroll: false }), [router]);
  const loadList = useCallback(async () => {
    const request = ++listRequest.current; const account = profile.id; setListLoading(true); setListError(null);
    try {
      const normalized = normalizeCohortList(await window.api.get<unknown>('/admin/writing/cohorts'));
      if (!normalized) throw new Error('Danh sách lớp không đúng contract.');
      if (request !== listRequest.current || accountRef.current !== account) return;
      setListSnapshot({ account, rows: normalized.rows as Cohort[], malformed: normalized.malformedCount, readAt: new Date().toISOString() });
    } catch (caught) { if (request === listRequest.current && accountRef.current === account) setListError(messageOf(caught)); }
    finally { if (request === listRequest.current && accountRef.current === account) setListLoading(false); }
  }, [profile.id]);
  const loadDetail = useCallback(async (cohortId: string) => {
    if (!cohortId) return; const request = ++detailRequest.current; const account = profile.id;
    setDetailLoading(true); setDetailError(null);
    try {
      const normalized = normalizeCohortDetail(await window.api.get<unknown>(`/admin/writing/cohorts/${encodeURIComponent(cohortId)}`));
      if (!normalized) throw new Error('Ma trận tiến độ không đúng contract.');
      if (request !== detailRequest.current || accountRef.current !== account) return;
      setDetailSnapshot({ account, cohortId, value: normalized as Detail, readAt: new Date().toISOString() });
    } catch (caught) { if (request === detailRequest.current && accountRef.current === account) setDetailError(messageOf(caught)); }
    finally { if (request === detailRequest.current && accountRef.current === account) setDetailLoading(false); }
  }, [profile.id]);

  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => { setQuery(filters.q); }, [filters.q]);
  useEffect(() => { if (filters.cohort) void loadDetail(filters.cohort); else { detailRequest.current += 1; setDetailError(null); setDetailLoading(false); } }, [filters.cohort, loadDetail]);

  const visibleCohorts = useMemo(() => (list?.rows || []).filter((row) => cohortMatches(row, filters)), [list, filters]);
  const refresh = () => { void loadList(); if (filters.cohort) void loadDetail(filters.cohort); };
  const selectCohort = (id: string) => navigate({ ...filters, cohort: id });
  const activeName = list?.rows.find((row) => row.id === filters.cohort)?.name || detail?.value.cohort.name;

  return <main className="awc-shell">
    <header className="awc-hero"><div><p className="awc-eyebrow">Writing · Cohort control</p><h1>Tiến độ theo lớp</h1><p>Mỗi cột là một lượt giao × một đề. Theo dõi từ chưa nộp đến đã trả mà không gộp mất những lần giao lại.</p></div><div className="awc-hero__actions"><a className="adm-btn-secondary" href="/admin/writing">Writing workspace</a><a className="adm-btn-primary" href="/admin/writing/assignments">Giao bài mới</a></div></header>
    <section className="awc-flow" aria-label="Chu trình Writing"><div><span>01</span><strong>Giao theo lớp</strong><small>Fan-out có biên nhận</small></div><i>→</i><div><span>02</span><strong>Theo dõi từng lượt</strong><small>Không gộp theo prompt</small></div><i>→</i><div><span>03</span><strong>Chấm & trả</strong><small>Mở đúng essay canonical</small></div></section>
    {(listError && list) && <div className="awc-warning" role="alert"><strong>Danh sách lớp đang là snapshot cũ</strong><span>{listError} · đọc lúc {formatDate(list.readAt, true)}</span><button className="adm-btn-secondary adm-btn-sm" type="button" onClick={refresh}>Thử lại</button></div>}
    {list && list.malformed > 0 && <div className="awc-warning" role="alert"><strong>Dữ liệu lớp bị loại</strong><span>{list.malformed} dòng sai contract không được hiển thị.</span></div>}
    <section className="awc-workspace">
      <aside className="awc-master" aria-label="Danh sách lớp"><header><div><p className="awc-eyebrow">Class register</p><h2>Lớp đang hoạt động</h2></div><span className="awc-count">{visibleCohorts.length}/{list?.rows.length || 0}</span></header><div className="awc-master__tools"><label><span>Tìm lớp</span><input value={query} maxLength={100} placeholder="Tên hoặc mô tả lớp…" onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') navigate({ ...filters, q: query }); }}/></label><label><span>Hoạt động</span><select value={filters.activity} onChange={(event) => navigate({ ...filters, activity: event.target.value })}><option value="all">Tất cả</option><option value="active">Có bài đang mở</option><option value="idle">Chưa có bài mở</option></select></label><button className="adm-btn-secondary" type="button" onClick={() => navigate({ ...filters, q: query })}>Áp dụng tìm kiếm</button></div>
        {listLoading && !list ? <div className="awc-state" role="status"><span className="awc-spinner"/><strong>Đang tải lớp…</strong></div> : listError && !list ? <div className="awc-state is-error" role="alert"><strong>Không tải được danh sách lớp</strong><p>{listError}</p><button className="adm-btn-secondary" type="button" onClick={() => void loadList()}>Thử lại</button></div> : !visibleCohorts.length ? <div className="awc-state"><strong>Không có lớp phù hợp</strong><p>Đổi bộ lọc hoặc kiểm tra danh sách lớp đang hoạt động.</p></div> : <div className="awc-cohorts">{visibleCohorts.map((row) => <button type="button" className={`awc-cohort${filters.cohort === row.id ? ' is-active' : ''}`} aria-pressed={filters.cohort === row.id} onClick={() => selectCohort(row.id)} key={row.id}><span className="awc-cohort__top"><strong>{row.name}</strong><small>{row.studentCount} học viên</small></span>{row.description && <span className="awc-cohort__description">{row.description}</span>}<span className="awc-cohort__metrics"><span><b>{row.activeAssignments}</b> đang mở</span><span><b>{row.essaysPending}</b> chờ chấm</span><span><b>{row.essaysDelivered}</b> đã trả</span></span></button>)}</div>}
      </aside>
      <section className="awc-detail" aria-label={activeName ? `Tiến độ lớp ${activeName}` : 'Tiến độ lớp'}>
        {!filters.cohort ? <div className="awc-placeholder"><span aria-hidden="true">↖</span><h2>Chọn một lớp</h2><p>Mở ma trận tiến độ theo từng lượt giao và từng học viên.</p></div> : detailLoading && !detail ? <div className="awc-state is-detail" role="status"><span className="awc-spinner"/><strong>Đang đọc tiến độ canonical…</strong></div> : detailError && !detail ? <div className="awc-state is-detail is-error" role="alert"><strong>Không tải được lớp {activeName || ''}</strong><p>{detailError}</p><button className="adm-btn-secondary" type="button" onClick={() => void loadDetail(filters.cohort)}>Thử lại</button></div> : detail ? <CohortMatrix detail={detail.value} staleError={detailError} readAt={detail.readAt} filter={filters.status} onFilter={(status) => navigate({ ...filters, status })} onRefresh={() => void loadDetail(filters.cohort)} /> : null}
      </section>
    </section>
  </main>;
}

function CohortMatrix({ detail, staleError, readAt, filter, onFilter, onRefresh }: { detail: Detail; staleError: string | null; readAt: string; filter: string; onFilter: (status: string) => void; onRefresh: () => void }) {
  const now = Date.now();
  return <><header className="awc-detail__head"><div><p className="awc-eyebrow">Canonical cohort snapshot</p><h2>{detail.cohort.name}</h2>{detail.cohort.description && <p>{detail.cohort.description}</p>}</div><button className="adm-btn-secondary" type="button" onClick={onRefresh}>Làm mới canonical</button></header>
    {staleError && <div className="awc-warning" role="alert"><strong>Ma trận đang là snapshot cũ</strong><span>{staleError} · đọc lúc {formatDate(readAt, true)}</span></div>}
    {detail.malformedCount > 0 && <div className="awc-warning" role="alert"><strong>Dữ liệu ma trận bị loại</strong><span>{detail.malformedCount} phần tử sai contract không được hiển thị.</span></div>}
    <div className="awc-stats"><div><span>Học viên</span><strong>{detail.stats.students}</strong></div><div><span>Bài giao cá nhân</span><strong>{detail.stats.assignments}</strong></div><div className="is-info"><span>Chờ xử lý</span><strong>{detail.stats.essaysPending}</strong></div><div className="is-success"><span>Đã trả</span><strong>{detail.stats.essaysDelivered}</strong></div><div className={detail.stats.overdue ? 'is-error' : ''}><span>Quá hạn</span><strong>{detail.stats.overdue}</strong></div></div>
    <div className="awc-matrix-toolbar"><label><span>Lọc trạng thái ô</span><select value={filter} onChange={(event) => onFilter(event.target.value)}>{STATUS_FILTERS.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label><div className="awc-legend" aria-label="Chú giải trạng thái"><span className="is-info">Cần chấm</span><span className="is-review">Cần review / trả</span><span className="is-success">Đã trả</span><span className="is-error">Lỗi / quá hạn</span></div></div>
    {!detail.students.length || !detail.columns.length ? <div className="awc-state is-detail"><strong>Chưa có ma trận tiến độ</strong><p>{!detail.students.length ? 'Lớp chưa có học viên.' : 'Lớp chưa có bài Writing được giao.'}</p><a className="adm-btn-primary" href="/admin/writing/assignments">Giao bài cho lớp</a></div> : <div className="awc-table-wrap"><table className="awc-table"><thead><tr><th className="awc-student-head">Học viên</th>{detail.columns.map((column) => <th key={column.id}><span>{column.name || 'Lượt giao legacy'}</span><strong title={column.title}>{column.title}</strong><small>{TASK[column.taskType || ''] || column.taskType || 'Không rõ dạng'} · {formatDate(column.assignedAt)}</small></th>)}</tr></thead><tbody>{detail.students.map((student) => <tr key={student.id}><th className="awc-student"><strong>{student.name || student.code || 'Học viên chưa đặt tên'}</strong><small>{student.code || 'Chưa có mã'}</small></th>{detail.columns.map((column) => <ProgressCell cell={detail.matrix[student.id]?.[column.id]} filter={filter} now={now} key={column.id}/>)}</tr>)}</tbody></table></div>}
  </>;
}

function ProgressCell({ cell, filter, now }: { cell?: Cell; filter: string; now: number }) {
  if (!cell) return <td className={filter === 'all' ? 'awc-cell is-empty' : 'awc-cell is-empty is-dim'}><span>Không giao</span></td>;
  const config = STATUS[cell.status]; const overdue = isOverdue(cell, now); const matches = cellMatchesFilter(cell, filter, now);
  const body = <><strong>{config.short}</strong>{cell.band != null && <span>Band {cell.band.toFixed(1)}</span>}{cell.deadline && <small>{overdue ? 'Quá hạn' : 'Hạn'} {formatDate(cell.deadline)}</small>}</>;
  return <td className={`awc-cell is-${overdue ? 'error' : config.lane}${matches ? '' : ' is-dim'}`} title={`${config.label}${cell.deadline ? ` · hạn ${formatDate(cell.deadline)}` : ''}`} >{cell.essayId ? <a href={`/admin/writing/grade?essay_id=${encodeURIComponent(cell.essayId)}`} aria-label={`${config.label}; mở bài Writing`}>{body}<em>Mở bài →</em></a> : <div aria-label={config.label}>{body}</div>}</td>;
}

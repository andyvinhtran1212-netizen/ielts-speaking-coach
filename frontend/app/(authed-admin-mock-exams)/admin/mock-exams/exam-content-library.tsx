'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { messageOf } from '@/components/admin-directory-ui';
import { getAdminExamContentPage } from '@/lib/admin-exam-content-api';
import { examContentStatusLabel, normalizeExamContent, vietnamDateIn } from '@/lib/admin-mock-exams-model.mjs';

type Cohort = { id: string; name?: string };
type ContentRow = {
  id: string; kind: 'reading' | 'listening' | 'writing'; code: string; title: string; status: string;
  courseLevel: string; cohortIds: string[]; examOnly: boolean; isPublic: boolean;
  mockExams: Array<{ id: string; code: string; title: string; status: string }>;
  publicPracticeEnabled: boolean; webExplanationMode: string;
  webExplanationReady: boolean; webExplanationState: string;
  webExplanationCount: number | null; webExplanationReadyCount: number | null;
  publishReady: boolean; readinessReason: string;
};
type Props = { accountId: string; cohorts: Cohort[] };
const KIND_LABEL = { reading: 'Reading', listening: 'Listening', writing: 'Writing' };

export function ExamContentLibrary({ accountId, cohorts }: Props) {
  const [kind, setKind] = useState('');
  const [cohortFilter, setCohortFilter] = useState('');
  const [visibility, setVisibility] = useState('all');
  const [levelTab, setLevelTab] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [deferredQuery, setDeferredQuery] = useState('');
  const [attention, setAttention] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [rows, setRows] = useState<ContentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totalComplete, setTotalComplete] = useState(false);
  const [levels, setLevels] = useState<string[]>([]);
  const [levelsComplete, setLevelsComplete] = useState(false);
  const [failedLevelKinds, setFailedLevelKinds] = useState<string[]>([]);
  const [failedKinds, setFailedKinds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState('');
  const [visibilityEditor, setVisibilityEditor] = useState<ContentRow | null>(null);
  const [visibilityWebExplanationMode, setVisibilityWebExplanationMode] = useState<'disabled' | 'immediate_after_capture' | 'admin_release'>('disabled');
  const [cohortEditor, setCohortEditor] = useState<ContentRow | null>(null);
  const [cohortDraft, setCohortDraft] = useState<string[]>([]);
  const [assignmentEditor, setAssignmentEditor] = useState<ContentRow | null>(null);
  const [assignmentCohort, setAssignmentCohort] = useState('');
  const [assignmentDueDate, setAssignmentDueDate] = useState(() => vietnamDateIn(7));
  const [assignmentWebExplanationMode, setAssignmentWebExplanationMode] = useState<'disabled' | 'immediate_after_capture' | 'admin_release'>('disabled');
  const [assignmentPostTestCaptureRequired, setAssignmentPostTestCaptureRequired] = useState(true);
  const [statusEditor, setStatusEditor] = useState<{ row: ContentRow; status: 'draft' | 'published' } | null>(null);
  const [levelEditor, setLevelEditor] = useState<ContentRow | null>(null);
  const [levelDraft, setLevelDraft] = useState('');
  const requestRef = useRef(0);
  const accountRef = useRef(accountId);
  accountRef.current = accountId;

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    const account = accountId;
    setLoading(true);
    try {
      const query = new URLSearchParams();
      if (kind) query.set('kind', kind);
      if (levelTab !== null) query.set('course_level', levelTab);
      if (cohortFilter) query.set('cohort_id', cohortFilter);
      if (visibility !== 'all') query.set('is_public', visibility === 'public' ? 'true' : 'false');
      if (deferredQuery) query.set('q', deferredQuery);
      if (attention !== 'all') query.set('attention', attention);
      query.set('limit', String(pageSize));
      query.set('offset', String((page - 1) * pageSize));
      const normalized = normalizeExamContent(await getAdminExamContentPage(query));
      if (request !== requestRef.current || accountRef.current !== account) return false;
      if (!normalized) throw new Error('Kho đề kỳ thi sai contract.');
      setRows(normalized.rows as ContentRow[]);
      setTotal(normalized.total);
      setTotalComplete(normalized.totalComplete);
      setLevels(normalized.levels);
      setLevelsComplete(normalized.levelsComplete);
      setFailedLevelKinds(normalized.failedLevelKinds);
      setFailedKinds(normalized.failedKinds);
      setError(null);
      return true;
    } catch (caught) {
      if (request === requestRef.current && accountRef.current === account) setError(messageOf(caught));
      return false;
    } finally {
      if (request === requestRef.current && accountRef.current === account) setLoading(false);
    }
  }, [accountId, attention, cohortFilter, deferredQuery, kind, levelTab, page, pageSize, visibility]);

  useEffect(() => { void load(); return () => { requestRef.current += 1; }; }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDeferredQuery(query.trim().slice(0, 100)), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const visible = rows;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = totalComplete ? Math.min(page, pageCount) : page;
  const pageRows = visible;
  const tabLevels = useMemo(() => [...new Set([...levels, levelTab || '', ''])].sort((a, b) => !a ? 1 : !b ? -1 : a.localeCompare(b)), [levels, levelTab]);
  const cohortName = (id: string) => cohorts.find((row) => row.id === id)?.name || id;

  useEffect(() => { setPage(1); }, [attention, cohortFilter, deferredQuery, kind, levelTab, visibility]);
  useEffect(() => { if (totalComplete && page > pageCount) setPage(pageCount); }, [page, pageCount, totalComplete]);

  const saveLevel = async (row: ContentRow, courseLevel: string) => {
    const key = `${row.kind}:${row.id}:level`;
    setBusyKey(key); setError(null);
    try {
      await window.api.patch<unknown>(`/admin/exam-content/${encodeURIComponent(row.kind)}/${encodeURIComponent(row.id)}/level`, { course_level: courseLevel.trim() });
      const confirmed = await load();
      if (confirmed) setLevelEditor(null);
      return confirmed;
    } catch (caught) {
      const message = messageOf(caught);
      await load();
      setError(message);
      return false;
    }
    finally { setBusyKey(''); }
  };

  const openCohorts = (row: ContentRow) => { setCohortEditor(row); setCohortDraft(row.cohortIds); };
  const saveCohorts = async () => {
    if (!cohortEditor) return;
    const key = `${cohortEditor.kind}:${cohortEditor.id}:cohorts`;
    setBusyKey(key); setError(null);
    try {
      await window.api.patch<unknown>(`/admin/exam-content/${encodeURIComponent(cohortEditor.kind)}/${encodeURIComponent(cohortEditor.id)}/cohorts`, { cohort_ids: cohortDraft });
      if (await load()) setCohortEditor(null);
    } catch (caught) {
      const message = messageOf(caught);
      await load();
      setError(message);
    }
    finally { setBusyKey(''); }
  };

  const openVisibility = (row: ContentRow) => {
    if (row.isPublic) {
      if (window.confirm(`Ẩn “${row.code || row.title || row.id}” khỏi kho tự luyện? Việc gán mock test và giao lớp không thay đổi.`)) void saveVisibility(row, false, 'disabled');
      return;
    }
    setVisibilityEditor(row);
    setVisibilityWebExplanationMode(
      row.webExplanationMode === 'immediate_after_capture' || row.webExplanationMode === 'admin_release'
        ? row.webExplanationMode : 'disabled',
    );
  };
  const saveVisibility = async (
    row: ContentRow,
    isPublic: boolean,
    webExplanationMode: 'disabled' | 'immediate_after_capture' | 'admin_release',
  ) => {
    if (row.kind === 'writing') return;
    const key = `${row.kind}:${row.id}:visibility`;
    setBusyKey(key); setError(null);
    try {
      if (isPublic) {
        await window.api.patch<unknown>(`/admin/mock-corrections/public-tests/${encodeURIComponent(row.kind)}/${encodeURIComponent(row.id)}`, {
          is_public: true,
          public_practice_enabled: webExplanationMode !== 'disabled',
          web_explanation_mode: webExplanationMode,
        });
      } else {
        await window.api.patch<unknown>(`/admin/mock-corrections/public-tests/${encodeURIComponent(row.kind)}/${encodeURIComponent(row.id)}`, {
          is_public: false,
          public_practice_enabled: false,
        });
      }
      setVisibilityEditor(null);
      await load();
    } catch (caught) {
      const message = messageOf(caught);
      await load();
      setError(message);
    }
    finally { setBusyKey(''); }
  };

  const saveStatus = async () => {
    if (!statusEditor) return;
    const { row, status } = statusEditor;
    const key = `${row.kind}:${row.id}:status`;
    setBusyKey(key); setError(null);
    try {
      await window.api.patch(`/admin/exam-content/${encodeURIComponent(row.kind)}/${encodeURIComponent(row.id)}/status`, { status });
      setStatusEditor(null);
      await load();
    } catch (caught) { setError(messageOf(caught)); await load(); }
    finally { setBusyKey(''); }
  };

  const examPreviewHref = (row: ContentRow) => row.kind === 'reading'
    ? `/reading/exam/session?test_id=${encodeURIComponent(row.code)}&admin_preview=1`
    : `/listening/test/session?id=${encodeURIComponent(row.id)}&admin_preview=1`;
  const reviewPreviewHref = (row: ContentRow) => row.kind === 'reading'
    ? `/reading/review?admin_test_id=${encodeURIComponent(row.code)}`
    : `/listening/review?admin_test_id=${encodeURIComponent(row.id)}`;

  const openAssignment = (row: ContentRow) => {
    setAssignmentEditor(row);
    setAssignmentCohort(row.cohortIds[0] || cohorts[0]?.id || '');
    setAssignmentWebExplanationMode(
      row.webExplanationMode === 'immediate_after_capture' || row.webExplanationMode === 'admin_release'
        ? row.webExplanationMode : 'disabled',
    );
    setAssignmentPostTestCaptureRequired(true);
  };
  const assignToClass = async () => {
    if (!assignmentEditor || !assignmentCohort) return;
    const row = assignmentEditor;
    const key = `${row.kind}:${row.id}:assignment`;
    setBusyKey(key); setError(null);
    try {
      await window.api.post(`/admin/cohorts/${encodeURIComponent(assignmentCohort)}/assignments`, {
        skill: row.kind,
        kind: 'daily',
        title: row.title || row.code,
        content_id: row.id,
        due_date: assignmentDueDate || null,
        due_time: '19:00',
        delivery_mode: 'assigned_practice',
        web_explanation_mode: assignmentWebExplanationMode,
        post_test_capture_required: assignmentWebExplanationMode !== 'disabled'
          && assignmentPostTestCaptureRequired,
      });
      setAssignmentEditor(null);
      await load();
    } catch (caught) { setError(messageOf(caught)); await load(); }
    finally { setBusyKey(''); }
  };

  return (
    <section className="mex-card mex-content" id="test-library" role="tabpanel" aria-labelledby="mex-library-tab">
      <div className="mex-section-head"><div><p className="mex-kicker">Quản lý tập trung</p><h2>Kho đề · duyệt, publish và giao bài</h2></div><button className="adm-btn-secondary" type="button" onClick={() => void load()} disabled={loading}>Tải lại</button></div>
      <p className="mex-help">Kiểm tra đề bằng đúng giao diện học viên, xem chữa bài, publish, mở public và giao lớp tại một nơi. Khi giao bài, hệ thống tự thêm lớp vào phạm vi đề.</p>
      <div className="mex-toolbar">
        <label className="mex-search"><span>Tìm đề</span><input type="search" maxLength={100} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Mã, tiêu đề hoặc cấp khóa…" /></label>
        <label><span>Kỹ năng</span><select value={kind} onChange={(event) => setKind(event.target.value)}><option value="">Tất cả</option><option value="reading">Reading</option><option value="listening">Listening</option><option value="writing">Writing</option></select></label>
        <label><span>Cấp khóa</span><select value={levelTab === null ? '__all__' : levelTab} onChange={(event) => setLevelTab(event.target.value === '__all__' ? null : event.target.value)}><option value="__all__">Tất cả</option><option value="">Chưa đặt</option>{tabLevels.filter(Boolean).map((level) => <option key={level} value={level}>{level}</option>)}</select></label>
        <label><span>Lớp</span><select value={cohortFilter} onChange={(event) => setCohortFilter(event.target.value)}><option value="">Tất cả</option>{cohorts.map((row) => <option key={row.id} value={row.id}>{row.name || row.id}</option>)}</select></label>
        <label><span>Hiển thị web</span><select value={visibility} onChange={(event) => setVisibility(event.target.value)}><option value="all">Tất cả</option><option value="public">Công khai</option><option value="private">Đang ẩn</option></select></label>
      </div>
      <div className="mex-quick-filters" aria-label="Lọc nhanh kho đề">
        {[['all', 'Tất cả'], ['action', 'Cần xử lý'], ['draft', 'Bản nháp'], ['no-level', 'Thiếu cấp khóa'], ['unassigned', 'Chưa vào Mock Test']].map(([value, label]) => <button type="button" key={value} className={attention === value ? 'is-active' : ''} aria-pressed={attention === value} onClick={() => setAttention(value)}>{label}</button>)}
      </div>
      {failedKinds.length > 0 && <div className="mex-alert is-error" role="alert">Không tải được: {failedKinds.map((item) => KIND_LABEL[item as keyof typeof KIND_LABEL] || item).join(', ')}. Danh sách đang thiếu; không chọn đề cho tới khi tải lại đủ.</div>}
      {!loading && !levelsComplete && !error && <div className="mex-alert is-warning" role="status">Danh sách cấp khóa có thể chưa đầy đủ{failedLevelKinds.length ? `: ${failedLevelKinds.map((item) => KIND_LABEL[item as keyof typeof KIND_LABEL] || item).join(', ')}` : ' trong lúc cập nhật hệ thống'}. Hãy tải lại trước khi lọc theo cấp khóa.</div>}
      {!loading && !totalComplete && !error && <div className="mex-alert is-warning" role="status">Số lượng đang hiển thị chỉ thuộc dữ liệu đọc được; tổng kho đề chưa xác nhận đầy đủ. Hãy tải lại khi kết nối ổn định.</div>}
      {error && <div className="mex-alert is-error" role="alert">{error}</div>}
      <div className="mex-level-tabs" role="tablist" aria-label="Lọc nhanh theo cấp khóa">
        <button type="button" className={levelTab === null ? 'is-active' : ''} onClick={() => setLevelTab(null)}>Tất cả <small>{totalComplete ? total : 'Chưa đủ'}</small></button>
        {tabLevels.map((level) => <button type="button" key={level || '__empty__'} className={levelTab === level ? 'is-active' : ''} onClick={() => setLevelTab(level)}>{level || 'Chưa đặt'}</button>)}
      </div>
      <div className="mex-table-wrap">
        {loading && !rows.length ? <p role="status">Đang tải kho đề…</p> : !visible.length ? <p>{totalComplete ? 'Không có đề khớp bộ lọc.' : 'Chưa thấy đề trong phần dữ liệu đã đọc. Giữ nguyên trang và thử tải lại.'}</p> : <table className="mex-table"><thead><tr><th>Kỹ năng</th><th>Mã / tiêu đề</th><th>Sẵn sàng</th><th>Hiển thị web</th><th>Mock test</th><th>Cấp khóa</th><th>Lớp</th><th>Thao tác</th></tr></thead><tbody>{pageRows.map((row) => {
          const prefix = `${row.kind}:${row.id}`;
          const assignBlocked = row.status !== 'published' || !row.publishReady;
          const assignReason = row.status !== 'published' ? 'Publish đề trước khi giao lớp.' : row.readinessReason;
          return <tr key={prefix}><td>{KIND_LABEL[row.kind]}</td><td><strong>{row.code || '—'}</strong><small>{row.title}</small></td><td><span className={`mex-pill is-${row.status}`}>{examContentStatusLabel(row.status)}</span>{row.kind !== 'writing' && row.status !== 'published' && row.publishReady ? <small className="mex-ready-copy">Đủ điều kiện publish</small> : null}{row.kind !== 'writing' && !row.publishReady ? <small className="mex-blocked-copy">{row.readinessReason || 'Đề chưa sẵn sàng.'}</small> : null}</td><td><span className={`mex-pill ${row.isPublic ? 'is-open' : ''}`}>{row.kind === 'writing' ? '—' : row.isPublic ? row.status === 'published' ? 'Công khai' : 'Public sau publish' : 'Đang ẩn'}</span>{row.publicPracticeEnabled ? <small>Có web explanation</small> : null}</td><td><div className="mex-chip-list">{row.mockExams.length ? row.mockExams.map((exam) => <span key={exam.id}>{exam.code || exam.title}</span>) : <em>Chưa gán</em>}</div></td><td><div className="mex-level-value"><span>{row.courseLevel || 'Chưa đặt'}</span><button className="adm-btn-secondary" type="button" onClick={() => { setLevelEditor(row); setLevelDraft(row.courseLevel); }} disabled={busyKey === `${prefix}:level`} aria-label={`Sửa cấp khóa ${row.code || row.title}`}>Sửa</button></div></td><td><div className="mex-chip-list">{row.cohortIds.length ? row.cohortIds.map((id) => <span key={id}>{cohortName(id)}</span>) : <em>Chưa gán</em>}</div></td><td>{row.kind !== 'writing' ? <details className="mex-row-menu" aria-label={`Thao tác ${row.code || row.title || row.id}`}><summary>Thao tác</summary><div className="mex-inline-actions"><a className="adm-btn-secondary" href={examPreviewHref(row)} target="_blank" rel="noreferrer">Thi thử</a><a className="adm-btn-secondary" href={reviewPreviewHref(row)} target="_blank" rel="noreferrer">Xem chữa bài</a>{!row.publishReady ? <a className="adm-btn-secondary" href={row.kind === 'reading' ? `/admin/reading/preview?test_id=${encodeURIComponent(row.code)}` : `/admin/listening/tests/${encodeURIComponent(row.id)}`}>{row.kind === 'reading' ? 'Kiểm tra cấu trúc' : 'Chuẩn bị audio'}</a> : null}{row.status !== 'published' ? <button className="adm-btn-primary" type="button" onClick={() => setStatusEditor({ row, status: 'published' })} disabled={!row.publishReady || busyKey === `${prefix}:status`} title={!row.publishReady ? row.readinessReason : undefined}>Publish</button> : <button className="adm-btn-secondary" type="button" onClick={() => setStatusEditor({ row, status: 'draft' })} disabled={busyKey === `${prefix}:status`}>Về draft</button>}<button className="adm-btn-secondary" type="button" onClick={() => openVisibility(row)} disabled={busyKey === `${prefix}:visibility`}>{row.isPublic ? 'Ẩn khỏi web' : 'Mở công khai'}</button><button className="adm-btn-secondary" type="button" onClick={() => openAssignment(row)} disabled={assignBlocked} title={assignBlocked ? assignReason : undefined}>Giao cho lớp</button><button className="adm-btn-secondary" type="button" onClick={() => openCohorts(row)}>Phạm vi lớp</button></div></details> : <span>Quản lý trong thư viện Writing</span>}</td></tr>;
        })}</tbody></table>}
      </div>
      {(total > 0 || !totalComplete && page > 1) && <div className="mex-pagination" aria-label="Phân trang kho đề"><span>{totalComplete ? `Hiển thị ${(currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, total)} / ${total} đề` : `Đang xem trang ${page} · số lượng chưa đầy đủ`}</span><label><span>Số dòng</span><select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value={25}>25</option><option value={50}>50</option></select></label><div><button className="adm-btn-secondary" type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1}>Trang trước</button><span>Trang {page}{totalComplete ? `/${pageCount}` : ''}</span><button className="adm-btn-secondary" type="button" onClick={() => setPage((value) => value + 1)} disabled={totalComplete ? page === pageCount : rows.length < pageSize}>Trang sau</button></div></div>}
      {levelEditor && <div className="mex-dialog-backdrop" role="presentation"><section className="mex-dialog is-small" role="dialog" aria-modal="true" aria-labelledby="mex-level-title"><div className="mex-dialog-head"><div><p className="mex-kicker">Cấp khóa</p><h2 id="mex-level-title">{levelEditor.code || levelEditor.title}</h2></div><button className="adm-btn-secondary" type="button" onClick={() => setLevelEditor(null)}>Đóng</button></div><label><span>Cấp khóa</span><input autoFocus value={levelDraft} onChange={(event) => setLevelDraft(event.target.value)} placeholder="Ví dụ: Foundation" /></label><div className="mex-dialog-actions"><button className="adm-btn-secondary" type="button" onClick={() => setLevelEditor(null)}>Hủy</button><button className="adm-btn-primary" type="button" onClick={() => void saveLevel(levelEditor, levelDraft)} disabled={busyKey.endsWith(':level')}>{busyKey.endsWith(':level') ? 'Đang lưu…' : 'Lưu cấp khóa'}</button></div></section></div>}
      {visibilityEditor && <div className="mex-dialog-backdrop" role="presentation"><section className="mex-dialog is-small" role="dialog" aria-modal="true" aria-labelledby="mex-visibility-title"><div className="mex-dialog-head"><div><p className="mex-kicker">Mở public</p><h2 id="mex-visibility-title">{visibilityEditor.code || visibilityEditor.title}</h2></div><button className="adm-btn-secondary" type="button" onClick={() => setVisibilityEditor(null)}>Đóng</button></div><label><span>Web explanation</span><select value={visibilityWebExplanationMode} onChange={(event) => setVisibilityWebExplanationMode(event.target.value as typeof visibilityWebExplanationMode)}><option value="disabled">Không hiện</option><option value="immediate_after_capture">Hiện sau tự đánh giá</option><option value="admin_release">Admin mở sau</option></select></label>{visibilityWebExplanationMode !== 'disabled' ? <div className="mex-alert is-warning">Bật web explanation được xem là xác nhận duyệt đúng 40 lời giải của đề này. Hệ thống vẫn chặn nếu thiếu object hoặc có matcher/serving blocker.</div> : null}<div className="mex-dialog-actions"><button className="adm-btn-primary" type="button" onClick={() => void saveVisibility(visibilityEditor, true, visibilityWebExplanationMode)} disabled={busyKey.endsWith(':visibility')}>{busyKey.endsWith(':visibility') ? 'Đang mở…' : 'Mở công khai'}</button></div></section></div>}
      {cohortEditor && <div className="mex-dialog-backdrop" role="presentation"><section className="mex-dialog is-small" role="dialog" aria-modal="true" aria-labelledby="mex-cohort-title"><div className="mex-dialog-head"><div><p className="mex-kicker">Replace set</p><h2 id="mex-cohort-title">Lớp dùng đề · {cohortEditor.code || cohortEditor.title}</h2></div><button className="adm-btn-secondary" type="button" onClick={() => setCohortEditor(null)}>Đóng</button></div><p className="mex-help">Lựa chọn này thay thế toàn bộ tập lớp hiện tại.</p><div className="mex-cohort-list">{cohorts.map((row) => <label key={row.id}><input type="checkbox" checked={cohortDraft.includes(row.id)} onChange={(event) => setCohortDraft((current) => event.target.checked ? [...new Set([...current, row.id])] : current.filter((id) => id !== row.id))} /><span>{row.name || row.id}</span></label>)}</div><div className="mex-dialog-actions"><button className="adm-btn-primary" type="button" onClick={() => void saveCohorts()} disabled={busyKey.endsWith(':cohorts')}>{busyKey.endsWith(':cohorts') ? 'Đang lưu…' : 'Lưu toàn bộ lớp'}</button></div></section></div>}
      {assignmentEditor && <div className="mex-dialog-backdrop" role="presentation"><section className="mex-dialog is-small" role="dialog" aria-modal="true" aria-labelledby="mex-assignment-title"><div className="mex-dialog-head"><div><p className="mex-kicker">Giao bài</p><h2 id="mex-assignment-title">{assignmentEditor.code || assignmentEditor.title}</h2></div><button className="adm-btn-secondary" type="button" onClick={() => setAssignmentEditor(null)}>Đóng</button></div><div className="mex-form-grid"><label><span>Lớp</span><select value={assignmentCohort} onChange={(event) => setAssignmentCohort(event.target.value)}><option value="">Chọn lớp</option>{cohorts.map((row) => <option key={row.id} value={row.id}>{row.name || row.id}</option>)}</select></label><label><span>Hạn nộp</span><input type="date" value={assignmentDueDate} onChange={(event) => setAssignmentDueDate(event.target.value)} /></label><label><span>Web explanation</span><select value={assignmentWebExplanationMode} onChange={(event) => setAssignmentWebExplanationMode(event.target.value as typeof assignmentWebExplanationMode)}><option value="disabled">Không hiện</option><option value="immediate_after_capture">Hiện sau tự đánh giá</option><option value="admin_release">Admin mở sau</option></select></label><label><input type="checkbox" checked={assignmentWebExplanationMode !== 'disabled' && assignmentPostTestCaptureRequired} disabled={assignmentWebExplanationMode === 'disabled'} onChange={(event) => setAssignmentPostTestCaptureRequired(event.target.checked)} /> Thu confidence trước khi hiện lời giải</label></div>{assignmentWebExplanationMode !== 'disabled' && !assignmentEditor.webExplanationReady ? <div className="mex-alert is-warning">Khi bấm giao, hệ thống sẽ xác nhận duyệt đúng 40 lời giải của đề này. Đề thiếu object hoặc có matcher/serving blocker vẫn bị chặn.</div> : null}<p className="mex-help">Đề được giao có kiểm soát; trạng thái công khai trên web không đổi. Lựa chọn web explanation chỉ áp dụng cho bài giao này.</p><div className="mex-dialog-actions"><button className="adm-btn-primary" type="button" onClick={() => void assignToClass()} disabled={!assignmentCohort || busyKey.endsWith(':assignment')}>{busyKey.endsWith(':assignment') ? 'Đang giao…' : 'Giao cho cả lớp'}</button></div></section></div>}
      {statusEditor && <div className="mex-dialog-backdrop" role="presentation"><section className="mex-dialog is-small" role="dialog" aria-modal="true" aria-labelledby="mex-status-title"><div className="mex-dialog-head"><div><p className="mex-kicker">Trạng thái đề</p><h2 id="mex-status-title">{statusEditor.status === 'published' ? 'Publish' : 'Đưa về draft'} · {statusEditor.row.code || statusEditor.row.title}</h2></div><button className="adm-btn-secondary" type="button" onClick={() => setStatusEditor(null)}>Đóng</button></div><p className="mex-help">{statusEditor.status === 'published' ? 'Sau khi publish, đề mới có thể giao cho lớp. Trạng thái public vẫn được quản lý riêng.' : 'Đề sẽ không thể giao mới. Nếu còn bài giao đang nhận nộp, hệ thống sẽ chặn thao tác này.'}</p><div className="mex-dialog-actions"><button className="adm-btn-primary" type="button" onClick={() => void saveStatus()} disabled={busyKey.endsWith(':status')}>{busyKey.endsWith(':status') ? 'Đang lưu…' : 'Xác nhận'}</button></div></section></div>}
    </section>
  );
}

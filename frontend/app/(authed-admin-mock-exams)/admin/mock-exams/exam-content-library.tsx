'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { messageOf } from '@/components/admin-directory-ui';
import { filterContentByLevel, normalizeExamContent, vietnamDateIn } from '@/lib/admin-mock-exams-model.mjs';

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
  const [levelFilter, setLevelFilter] = useState('');
  const [cohortFilter, setCohortFilter] = useState('');
  const [visibility, setVisibility] = useState('all');
  const [levelTab, setLevelTab] = useState<string | null>(null);
  const [rows, setRows] = useState<ContentRow[]>([]);
  const [levels, setLevels] = useState<string[]>([]);
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
      if (levelFilter) query.set('course_level', levelFilter);
      if (cohortFilter) query.set('cohort_id', cohortFilter);
      if (visibility !== 'all') query.set('is_public', visibility === 'public' ? 'true' : 'false');
      const normalized = normalizeExamContent(await window.api.get<unknown>(`/admin/exam-content${query.size ? `?${query}` : ''}`));
      if (request !== requestRef.current || accountRef.current !== account) return false;
      if (!normalized) throw new Error('Kho đề kỳ thi sai contract.');
      setRows(normalized.rows as ContentRow[]);
      setLevels(normalized.levels);
      setFailedKinds(normalized.failedKinds);
      setError(null);
      return true;
    } catch (caught) {
      if (request === requestRef.current && accountRef.current === account) setError(messageOf(caught));
      return false;
    } finally {
      if (request === requestRef.current && accountRef.current === account) setLoading(false);
    }
  }, [accountId, cohortFilter, kind, levelFilter, visibility]);

  useEffect(() => { void load(); return () => { requestRef.current += 1; }; }, [load]);

  const visible = useMemo(() => filterContentByLevel(rows, levelTab) as ContentRow[], [levelTab, rows]);
  const tabLevels = useMemo(() => [...new Set(rows.map((row) => row.courseLevel))].sort((a, b) => !a ? 1 : !b ? -1 : a.localeCompare(b)), [rows]);
  const cohortName = (id: string) => cohorts.find((row) => row.id === id)?.name || id;

  const saveLevel = async (row: ContentRow, courseLevel: string) => {
    const key = `${row.kind}:${row.id}:level`;
    setBusyKey(key); setError(null);
    try {
      await window.api.patch<unknown>(`/admin/exam-content/${encodeURIComponent(row.kind)}/${encodeURIComponent(row.id)}/level`, { course_level: courseLevel.trim() });
      return await load();
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
          public_practice_enabled: webExplanationMode !== 'disabled',
          web_explanation_mode: webExplanationMode,
        });
        await window.api.patch<unknown>(`/admin/exam-content/${encodeURIComponent(row.kind)}/${encodeURIComponent(row.id)}/visibility`, { is_public: true });
      } else {
        await window.api.patch<unknown>(`/admin/exam-content/${encodeURIComponent(row.kind)}/${encodeURIComponent(row.id)}/visibility`, { is_public: false });
        await window.api.patch<unknown>(`/admin/mock-corrections/public-tests/${encodeURIComponent(row.kind)}/${encodeURIComponent(row.id)}`, { public_practice_enabled: false });
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
    <section className="mex-card mex-content" id="test-library">
      <div className="mex-section-head"><div><p className="mex-kicker">Quản lý tập trung</p><h2>Kho đề · duyệt, publish và giao bài</h2></div><button className="adm-btn-secondary" type="button" onClick={() => void load()} disabled={loading}>Tải lại</button></div>
      <p className="mex-help">Kiểm tra đề bằng đúng giao diện học viên, xem chữa bài, publish, mở public và giao lớp tại một nơi. Khi giao bài, hệ thống tự thêm lớp vào phạm vi đề.</p>
      <div className="mex-toolbar">
        <label><span>Kỹ năng</span><select value={kind} onChange={(event) => setKind(event.target.value)}><option value="">Tất cả</option><option value="reading">Reading</option><option value="listening">Listening</option><option value="writing">Writing</option></select></label>
        <label><span>Cấp khóa</span><select value={levelFilter} onChange={(event) => setLevelFilter(event.target.value)}><option value="">Tất cả</option>{levels.map((level) => <option key={level} value={level}>{level}</option>)}</select></label>
        <label><span>Lớp</span><select value={cohortFilter} onChange={(event) => setCohortFilter(event.target.value)}><option value="">Tất cả</option>{cohorts.map((row) => <option key={row.id} value={row.id}>{row.name || row.id}</option>)}</select></label>
        <label><span>Hiển thị web</span><select value={visibility} onChange={(event) => setVisibility(event.target.value)}><option value="all">Tất cả</option><option value="public">Công khai</option><option value="private">Đang ẩn</option></select></label>
      </div>
      {failedKinds.length > 0 && <div className="mex-alert is-error" role="alert">Không tải được: {failedKinds.map((item) => KIND_LABEL[item as keyof typeof KIND_LABEL] || item).join(', ')}. Danh sách đang thiếu; không chọn đề cho tới khi tải lại đủ.</div>}
      {error && <div className="mex-alert is-error" role="alert">{error}</div>}
      <div className="mex-level-tabs" role="tablist" aria-label="Lọc nhanh theo cấp khóa">
        <button type="button" className={levelTab === null ? 'is-active' : ''} onClick={() => setLevelTab(null)}>Tất cả <small>{rows.length}</small></button>
        {tabLevels.map((level) => <button type="button" key={level || '__empty__'} className={levelTab === level ? 'is-active' : ''} onClick={() => setLevelTab(level)}>{level || 'Chưa đặt'} <small>{rows.filter((row) => row.courseLevel === level).length}</small></button>)}
      </div>
      <div className="mex-table-wrap">
        {loading && !rows.length ? <p role="status">Đang tải kho đề…</p> : !visible.length ? <p>Không có đề khớp bộ lọc.</p> : <table className="mex-table"><thead><tr><th>Kỹ năng</th><th>Mã / tiêu đề</th><th>Sẵn sàng</th><th>Hiển thị web</th><th>Mock test</th><th>Cấp khóa</th><th>Lớp</th><th>Thao tác</th></tr></thead><tbody>{visible.map((row) => {
          const prefix = `${row.kind}:${row.id}`;
          const assignBlocked = row.status !== 'published' || !row.publishReady;
          const assignReason = row.status !== 'published' ? 'Publish đề trước khi giao lớp.' : row.readinessReason;
          return <tr key={prefix}><td>{KIND_LABEL[row.kind]}</td><td><strong>{row.code || '—'}</strong><small>{row.title}</small></td><td><span className={`mex-pill is-${row.status}`}>{row.status === 'published' ? 'Đã publish' : row.status === 'draft' ? 'Bản nháp' : row.status}</span>{row.kind !== 'writing' && row.status !== 'published' && row.publishReady ? <small className="mex-ready-copy">Đủ điều kiện publish</small> : null}{row.kind !== 'writing' && !row.publishReady ? <small className="mex-blocked-copy">{row.readinessReason || 'Đề chưa sẵn sàng.'}</small> : null}</td><td><span className={`mex-pill ${row.isPublic ? 'is-open' : ''}`}>{row.kind === 'writing' ? '—' : row.isPublic ? row.status === 'published' ? 'Công khai' : 'Public sau publish' : 'Đang ẩn'}</span>{row.publicPracticeEnabled ? <small>Có web explanation</small> : null}</td><td><div className="mex-chip-list">{row.mockExams.length ? row.mockExams.map((exam) => <span key={exam.id}>{exam.code || exam.title}</span>) : <em>Chưa gán</em>}</div></td><td><input aria-label={`Cấp khóa ${row.code || row.title}`} defaultValue={row.courseLevel} key={`${prefix}:${row.courseLevel}`} onBlur={(event) => { const input = event.currentTarget; if (input.value.trim() !== row.courseLevel) void saveLevel(row, input.value).then((confirmed) => { if (!confirmed) input.value = row.courseLevel; }); }} disabled={busyKey === `${prefix}:level`} /></td><td><div className="mex-chip-list">{row.cohortIds.length ? row.cohortIds.map((id) => <span key={id}>{cohortName(id)}</span>) : <em>Chưa gán</em>}</div></td><td><div className="mex-inline-actions">{row.kind !== 'writing' ? <><a className="adm-btn-secondary" href={examPreviewHref(row)} target="_blank" rel="noreferrer">Thi thử</a><a className="adm-btn-secondary" href={reviewPreviewHref(row)} target="_blank" rel="noreferrer">Xem chữa bài</a>{!row.publishReady ? <a className="adm-btn-secondary" href={row.kind === 'reading' ? `/admin/reading/preview?test_id=${encodeURIComponent(row.code)}` : `/admin/listening/tests/${encodeURIComponent(row.id)}`}>{row.kind === 'reading' ? 'Kiểm tra cấu trúc' : 'Chuẩn bị audio'}</a> : null}{row.status !== 'published' ? <button className="adm-btn-primary" type="button" onClick={() => setStatusEditor({ row, status: 'published' })} disabled={!row.publishReady || busyKey === `${prefix}:status`} title={!row.publishReady ? row.readinessReason : undefined}>Publish</button> : <button className="adm-btn-secondary" type="button" onClick={() => setStatusEditor({ row, status: 'draft' })} disabled={busyKey === `${prefix}:status`}>Về draft</button>}<button className="adm-btn-secondary" type="button" onClick={() => openVisibility(row)} disabled={busyKey === `${prefix}:visibility`}>{row.isPublic ? 'Ẩn khỏi web' : 'Mở công khai'}</button><button className="adm-btn-secondary" type="button" onClick={() => openAssignment(row)} disabled={assignBlocked} title={assignBlocked ? assignReason : undefined}>Giao cho lớp</button><button className="adm-btn-secondary" type="button" onClick={() => openCohorts(row)}>Phạm vi lớp</button></> : <span>Quản lý trong thư viện Writing</span>}</div></td></tr>;
        })}</tbody></table>}
      </div>
      {visibilityEditor && <div className="mex-dialog-backdrop" role="presentation"><section className="mex-dialog is-small" role="dialog" aria-modal="true" aria-labelledby="mex-visibility-title"><div className="mex-dialog-head"><div><p className="mex-kicker">Mở public</p><h2 id="mex-visibility-title">{visibilityEditor.code || visibilityEditor.title}</h2></div><button className="adm-btn-secondary" type="button" onClick={() => setVisibilityEditor(null)}>Đóng</button></div><label><span>Web explanation</span><select value={visibilityWebExplanationMode} onChange={(event) => setVisibilityWebExplanationMode(event.target.value as typeof visibilityWebExplanationMode)}><option value="disabled">Không hiện</option><option value="immediate_after_capture">Hiện sau tự đánh giá</option><option value="admin_release">Admin mở sau</option></select></label>{visibilityWebExplanationMode !== 'disabled' ? <div className="mex-alert is-warning">Bật web explanation được xem là xác nhận duyệt đúng 40 lời giải của đề này. Hệ thống vẫn chặn nếu thiếu object hoặc có matcher/serving blocker.</div> : null}<div className="mex-dialog-actions"><button className="adm-btn-primary" type="button" onClick={() => void saveVisibility(visibilityEditor, true, visibilityWebExplanationMode)} disabled={busyKey.endsWith(':visibility')}>{busyKey.endsWith(':visibility') ? 'Đang mở…' : 'Mở công khai'}</button></div></section></div>}
      {cohortEditor && <div className="mex-dialog-backdrop" role="presentation"><section className="mex-dialog is-small" role="dialog" aria-modal="true" aria-labelledby="mex-cohort-title"><div className="mex-dialog-head"><div><p className="mex-kicker">Replace set</p><h2 id="mex-cohort-title">Lớp dùng đề · {cohortEditor.code || cohortEditor.title}</h2></div><button className="adm-btn-secondary" type="button" onClick={() => setCohortEditor(null)}>Đóng</button></div><p className="mex-help">Lựa chọn này thay thế toàn bộ tập lớp hiện tại.</p><div className="mex-cohort-list">{cohorts.map((row) => <label key={row.id}><input type="checkbox" checked={cohortDraft.includes(row.id)} onChange={(event) => setCohortDraft((current) => event.target.checked ? [...new Set([...current, row.id])] : current.filter((id) => id !== row.id))} /><span>{row.name || row.id}</span></label>)}</div><div className="mex-dialog-actions"><button className="adm-btn-primary" type="button" onClick={() => void saveCohorts()} disabled={busyKey.endsWith(':cohorts')}>{busyKey.endsWith(':cohorts') ? 'Đang lưu…' : 'Lưu toàn bộ lớp'}</button></div></section></div>}
      {assignmentEditor && <div className="mex-dialog-backdrop" role="presentation"><section className="mex-dialog is-small" role="dialog" aria-modal="true" aria-labelledby="mex-assignment-title"><div className="mex-dialog-head"><div><p className="mex-kicker">Giao bài</p><h2 id="mex-assignment-title">{assignmentEditor.code || assignmentEditor.title}</h2></div><button className="adm-btn-secondary" type="button" onClick={() => setAssignmentEditor(null)}>Đóng</button></div><div className="mex-form-grid"><label><span>Lớp</span><select value={assignmentCohort} onChange={(event) => setAssignmentCohort(event.target.value)}><option value="">Chọn lớp</option>{cohorts.map((row) => <option key={row.id} value={row.id}>{row.name || row.id}</option>)}</select></label><label><span>Hạn nộp</span><input type="date" value={assignmentDueDate} onChange={(event) => setAssignmentDueDate(event.target.value)} /></label><label><span>Web explanation</span><select value={assignmentWebExplanationMode} onChange={(event) => setAssignmentWebExplanationMode(event.target.value as typeof assignmentWebExplanationMode)}><option value="disabled">Không hiện</option><option value="immediate_after_capture">Hiện sau tự đánh giá</option><option value="admin_release">Admin mở sau</option></select></label><label><input type="checkbox" checked={assignmentWebExplanationMode !== 'disabled' && assignmentPostTestCaptureRequired} disabled={assignmentWebExplanationMode === 'disabled'} onChange={(event) => setAssignmentPostTestCaptureRequired(event.target.checked)} /> Thu confidence trước khi hiện lời giải</label></div>{assignmentWebExplanationMode !== 'disabled' && !assignmentEditor.webExplanationReady ? <div className="mex-alert is-warning">Khi bấm giao, hệ thống sẽ xác nhận duyệt đúng 40 lời giải của đề này. Đề thiếu object hoặc có matcher/serving blocker vẫn bị chặn.</div> : null}<p className="mex-help">Đề được giao có kiểm soát; trạng thái công khai trên web không đổi. Lựa chọn web explanation chỉ áp dụng cho bài giao này.</p><div className="mex-dialog-actions"><button className="adm-btn-primary" type="button" onClick={() => void assignToClass()} disabled={!assignmentCohort || busyKey.endsWith(':assignment')}>{busyKey.endsWith(':assignment') ? 'Đang giao…' : 'Giao cho cả lớp'}</button></div></section></div>}
      {statusEditor && <div className="mex-dialog-backdrop" role="presentation"><section className="mex-dialog is-small" role="dialog" aria-modal="true" aria-labelledby="mex-status-title"><div className="mex-dialog-head"><div><p className="mex-kicker">Trạng thái đề</p><h2 id="mex-status-title">{statusEditor.status === 'published' ? 'Publish' : 'Đưa về draft'} · {statusEditor.row.code || statusEditor.row.title}</h2></div><button className="adm-btn-secondary" type="button" onClick={() => setStatusEditor(null)}>Đóng</button></div><p className="mex-help">{statusEditor.status === 'published' ? 'Sau khi publish, đề mới có thể giao cho lớp. Trạng thái public vẫn được quản lý riêng.' : 'Đề sẽ không thể giao mới. Nếu còn bài giao đang nhận nộp, hệ thống sẽ chặn thao tác này.'}</p><div className="mex-dialog-actions"><button className="adm-btn-primary" type="button" onClick={() => void saveStatus()} disabled={busyKey.endsWith(':status')}>{busyKey.endsWith(':status') ? 'Đang lưu…' : 'Xác nhận'}</button></div></section></div>}
    </section>
  );
}

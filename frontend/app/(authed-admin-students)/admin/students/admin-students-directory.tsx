'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import { useAdminProfile } from '@/components/admin-access-gate';
import { Dialog, Field, messageOf, StatusBanner } from '@/components/admin-directory-ui';
import { assignmentHref } from '@/lib/admin-writing-assignments-model.mjs';
import {
  cohortTruth,
  formatBandGoal,
  mergeStudentDetail,
  normalizeCohortPicker,
  normalizeStudent,
  normalizeStudentsPayload,
  studentDraft,
  studentSummary,
  validateStudentDraft,
} from '@/lib/admin-students-model.mjs';

import type { Banner, CohortOption, ProfileState, Student, StudentDraft } from './admin-student-types';

const LIMIT = 200;

function DisplayCount({ value }: { value: number | null }) {
  return value == null ? <span className="acd-unknown">Chưa đọc được</span> : <>{value.toLocaleString('vi-VN')}</>;
}

function dateLabel(value: unknown) {
  if (typeof value !== 'string' || !value) return '—';
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('vi-VN');
}

function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function bandFromEssay(value: unknown) {
  const essay = record(value);
  const feedback = Array.isArray(essay.writing_feedback) ? record(essay.writing_feedback[0]) : record(essay.writing_feedback);
  return feedback.overall_band_score ?? null;
}

function ProfileDialog({ profile, onClose }: { profile: ProfileState | null; onClose: () => void }) {
  const detail = profile?.detail || profile?.fallback;
  const writing = record(profile?.writing);
  const stats = record(writing.stats);
  const listening = record(profile?.detail?.listening);
  const essays = array(writing.recent_essays);
  const assignments = array(writing.recent_assignments);
  const history = array(profile?.detail?.essay_history);
  const title = detail?.full_name || profile?.fallback.full_name || 'Hồ sơ học viên';
  const subtitle = `${detail?.student_code || '—'} · Hiện tại ${detail?.current_band_estimate ?? '—'} · Mục tiêu ${detail?.target_band ?? '—'}`;
  return (
    <Dialog
      open={Boolean(profile)}
      title={title}
      description={subtitle}
      onClose={onClose}
      actions={<>
        {profile && <a className="adm-btn-secondary" href={assignmentHref({}, { studentId: profile.id })} aria-label={`Giao bài Writing cho ${title}`}>Giao bài Writing</a>}
        {profile && <a className="adm-btn-secondary" href={`/admin/writing/new?student_id=${encodeURIComponent(profile.id)}`} aria-label={`Gửi bài chấm cho ${title}`}>Gửi bài chấm</a>}
        <button className="adm-btn-primary" type="button" onClick={onClose}>Đóng</button>
      </>}
    >
      {profile?.loading ? <div className="asd-loading" role="status"><span className="acd-spinner" aria-hidden="true" />Đang tải hồ sơ chuẩn…</div> : null}
      {!profile?.loading && profile?.errors.length ? <div className="acd-warning" role="alert">{profile.errors.join(' ')}</div> : null}
      {!profile?.loading && profile ? <div className="asd-profile">
        <div className="asd-profile__badges">
          <span className={`adm-status-pill ${detail?.user_id ? 'is-active' : 'is-archived'}`}>{detail?.user_id ? 'Đã kích hoạt tài khoản' : 'Chưa kích hoạt'}</span>
          <span className="adm-chip">{cohortTruth(detail).label}</span>
          {detail?.target_date && <span className="adm-chip">Hạn {dateLabel(detail.target_date)}</span>}
        </div>
        {detail?.persona_notes && <section className="asd-note"><h3>Ghi chú học tập</h3><p>{detail.persona_notes}</p></section>}
        <section><h3>Writing</h3><div className="asd-stats">
          <div><span>Tổng bài</span><strong>{String(stats.total_essays ?? '—')}</strong></div>
          <div><span>Đã chấm</span><strong>{String(stats.graded_count ?? '—')}</strong></div>
          <div><span>Gắn cờ</span><strong>{String(stats.flagged_count ?? '—')}</strong></div>
          <div><span>Band TB 5 bài</span><strong>{String(stats.average_band_last5 ?? '—')}</strong></div>
        </div></section>
        <div className="asd-profile__columns">
          <section><h3>Bài viết gần đây</h3><ul>{essays.length ? essays.map((item, index) => {
            const essay = record(item); const band = bandFromEssay(essay);
            return <li key={String(essay.id || index)}><a href={`/pages/admin/writing/grade.html?essay_id=${encodeURIComponent(String(essay.id || ''))}`}>{dateLabel(essay.created_at)} · {band == null ? String(essay.status || '—') : `Band ${String(band)}`}</a>{essay.is_flagged ? <small>Đã gắn cờ</small> : null}</li>;
          }) : <li>Chưa có bài viết.</li>}</ul></section>
          <section><h3>Bài đã giao</h3><ul>{assignments.length ? assignments.map((item, index) => {
            const assignment = record(item); const prompt = record(assignment.writing_prompts);
            return <li key={String(assignment.id || index)}>{String(prompt.title || 'Bài chưa đặt tên')} <small>{String(assignment.status || '—')}</small></li>;
          }) : <li>Chưa có bài giao.</li>}</ul></section>
        </div>
        <section><h3>Listening</h3>{profile.detail && !profile.detail.user_id ? <p className="asd-muted">Chưa kích hoạt tài khoản — chưa có dữ liệu listening.</p> : Object.keys(listening).length ? <div className="asd-stats">
          <div><span>Tổng lượt</span><strong>{String(listening.attempts_total ?? 0)}</strong></div>
          <div><span>Độ chính xác TB</span><strong>{listening.avg_accuracy == null ? '—' : `${Math.round(Number(listening.avg_accuracy) * 100)}%`}</strong></div>
          <div><span>Bỏ dở</span><strong>{String(listening.attempts_abandoned ?? 0)}</strong></div>
          <div><span>Chép chính tả</span><strong>{String(listening.dictation_total ?? 0)}</strong></div>
        </div> : <p className="asd-muted">Không đọc được dữ liệu listening.</p>}</section>
        <section><h3>Lịch sử nộp bài</h3><ul className="asd-history">{history.length ? history.map((item, index) => {
          const row = record(item);
          return <li key={String(row.id || index)}><a href={`/pages/admin/writing/grade.html?essay_id=${encodeURIComponent(String(row.id || ''))}`}>{dateLabel(row.created_at)} · {String(row.task_type || '—')}</a><small>{String(row.status || '—')}</small></li>;
        }) : <li>Chưa có bài nộp.</li>}</ul></section>
      </div> : null}
    </Dialog>
  );
}

export function AdminStudentsDirectory() {
  const admin = useAdminProfile();
  const [students, setStudents] = useState<Student[]>([]);
  const [cohorts, setCohorts] = useState<CohortOption[]>([]);
  const [hasSnapshot, setHasSnapshot] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cohortError, setCohortError] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCohort, setBulkCohort] = useState('');
  const [draft, setDraft] = useState<StudentDraft | null>(null);
  const [profile, setProfile] = useState<ProfileState | null>(null);
  const [busy, setBusy] = useState(false);
  const [csvErrors, setCsvErrors] = useState<string[]>([]);
  const requestSequence = useRef(0);
  const csvInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const loadStudents = useCallback(async (search: string, silent = false) => {
    const requestId = ++requestSequence.current;
    if (!silent) setLoading(true);
    setLoadError(null);
    try {
      const path = `/admin/students?limit=${LIMIT}${search ? `&search=${encodeURIComponent(search)}` : ''}`;
      const rows = normalizeStudentsPayload(await window.api.get<unknown>(path)) as Student[];
      if (requestId !== requestSequence.current) return false;
      setStudents(rows);
      setSelected(new Set());
      setHasSnapshot(true);
      setLoading(false);
      return true;
    } catch (caught) {
      if (requestId !== requestSequence.current) return false;
      setLoadError(messageOf(caught));
      setLoading(false);
      return false;
    }
  }, []);

  const loadCohorts = useCallback(async () => {
    setCohortError(null);
    try {
      setCohorts(normalizeCohortPicker(await window.api.get<unknown>('/admin/cohorts?is_active=true')) as CohortOption[]);
      return true;
    } catch (caught) {
      setCohortError(messageOf(caught));
      return false;
    }
  }, []);

  useEffect(() => {
    setStudents([]); setCohorts([]); setHasSnapshot(false); setBanner(null); setQuery(''); setDebouncedQuery(''); setSelected(new Set());
    void Promise.all([loadStudents('', false), loadCohorts()]);
    return () => { requestSequence.current += 1; };
  }, [admin.id, loadStudents, loadCohorts]);

  useEffect(() => {
    if (!hasSnapshot && debouncedQuery === '') return;
    void loadStudents(debouncedQuery);
  }, [debouncedQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  const summary = useMemo(() => studentSummary(students), [students]);
  const showingStale = Boolean(loadError && hasSnapshot);
  const lookupFailed = students.some((student) => student.cohort_lookup_failed);
  const allSelected = students.length > 0 && students.every((student) => selected.has(student.id));

  const canonicalReload = async (success: string) => {
    const fresh = await loadStudents(debouncedQuery, true);
    setBanner(fresh ? { kind: 'success', text: success } : { kind: 'error', text: `${success} Tuy nhiên chưa tải lại được dữ liệu chuẩn; hãy bấm Tải lại.` });
  };

  const submitDraft = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || busy) return;
    const validation = validateStudentDraft(draft) as { ok: boolean; error?: string; body?: Record<string, unknown> };
    if (!validation.ok || !validation.body) { setDraft({ ...draft, error: validation.error || 'Dữ liệu không hợp lệ.' }); return; }
    setBusy(true); setBanner(null);
    try {
      if (draft.id) await window.api.patch(`/admin/students/${encodeURIComponent(draft.id)}`, validation.body);
      else await window.api.post('/admin/students', validation.body);
      const success = draft.id ? 'Đã cập nhật hồ sơ học viên.' : 'Đã tạo học viên.';
      setDraft(null);
      await canonicalReload(success);
    } catch (caught) {
      setDraft({ ...draft, error: messageOf(caught) });
    } finally { setBusy(false); }
  };

  const assignSelected = async () => {
    if (!bulkCohort || !selected.size || busy) return;
    setBusy(true); setBanner(null);
    try {
      const result = await window.api.post<{ assigned?: number }>(`/admin/cohorts/${encodeURIComponent(bulkCohort)}/students/bulk`, { student_ids: [...selected] });
      // The write already succeeded even if the following canonical read fails.
      // Clear the action inputs now so a stale retry cannot submit it twice.
      setSelected(new Set());
      setBulkCohort('');
      await canonicalReload(`Đã thêm ${result.assigned ?? selected.size} học viên vào lớp; các lớp khác được giữ nguyên.`);
    } catch (caught) { setBanner({ kind: 'error', text: messageOf(caught) }); }
    finally { setBusy(false); }
  };

  const openProfile = async (student: Student) => {
    setProfile({ id: student.id, fallback: student, detail: null, writing: null, errors: [], loading: true });
    const [detailResult, writingResult] = await Promise.allSettled([
      window.api.get<unknown>(`/admin/students/${encodeURIComponent(student.id)}`),
      window.api.get<unknown>(`/admin/writing/students/${encodeURIComponent(student.id)}/summary`),
    ]);
    const rawDetail = detailResult.status === 'fulfilled' ? normalizeStudent(detailResult.value) as Student | null : null;
    const detail = mergeStudentDetail(rawDetail, student) as Student | null;
    const writing = writingResult.status === 'fulfilled' ? record(writingResult.value) : null;
    const errors: string[] = [];
    if (!detail) errors.push('Không tải được hồ sơ và dữ liệu Listening.');
    if (!writing) errors.push('Không tải được tổng quan Writing.');
    setProfile((current) => current?.id === student.id ? { ...current, detail, writing, errors, loading: false } : current);
  };

  const importCsv = async (file: File | undefined) => {
    if (!file || busy) return;
    const form = new FormData(); form.append('file', file);
    setBusy(true); setBanner(null); setCsvErrors([]);
    try {
      const result = await window.api.upload<{ imported?: number; errors?: unknown[] }>('/admin/students/import', form);
      const errors = array(result.errors).map((item) => typeof item === 'string' ? item : JSON.stringify(item));
      setCsvErrors(errors);
      await canonicalReload(`Đã import ${result.imported ?? 0} học viên${errors.length ? `; ${errors.length} dòng cần kiểm tra.` : '.'}`);
    } catch (caught) { setBanner({ kind: 'error', text: messageOf(caught) }); }
    finally { setBusy(false); if (csvInput.current) csvInput.current.value = ''; }
  };

  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(students.map((student) => student.id)));
  const toggleOne = (id: string) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  return <main className="acd-shell asd-shell">
    <header className="acd-header"><div><p className="acd-eyebrow">Danh bạ học viên</p><h1>Lớp <span>& Học viên</span></h1><p>Quản lý hồ sơ, trạng thái kích hoạt và xếp lớp từ dữ liệu backend chuẩn.</p></div><div className="asd-header-actions">
      <input ref={csvInput} className="sr-only" type="file" accept=".csv,text/csv" onChange={(event) => void importCsv(event.target.files?.[0])} />
      <button className="adm-btn-secondary" type="button" onClick={() => csvInput.current?.click()} disabled={busy}>Import CSV</button>
      <button className="adm-btn-primary" type="button" onClick={() => setDraft(studentDraft() as StudentDraft)} disabled={busy}>Thêm học viên</button>
    </div></header>

    <nav className="acd-tabs" aria-label="Lớp và học viên">
      <a href="/admin/classes"><span>Lớp</span><small>Danh mục · sĩ số · trạng thái</small></a>
      <a className="is-active" href="/admin/students" aria-current="page"><span>Học viên</span><small>Hồ sơ · xếp lớp · nhập CSV</small></a>
    </nav>

    <section className="acd-kpis" aria-label="Tổng quan học viên">
      <div className="acd-kpi"><span>Trong kết quả</span><strong><DisplayCount value={hasSnapshot ? summary.total : null} /></strong></div>
      <div className="acd-kpi"><span>Chưa xếp lớp</span><strong><DisplayCount value={hasSnapshot ? summary.unassigned : null} /></strong></div>
      <div className="acd-kpi"><span>Mục tiêu trong 90 ngày</span><strong><DisplayCount value={hasSnapshot ? summary.upcoming : null} /></strong></div>
    </section>

    <StatusBanner banner={banner} />
    {lookupFailed && !loadError && <div className="acd-warning" role="alert">Không đối chiếu được tên lớp. Học viên đã có liên kết lớp vẫn được giữ ở trạng thái “không đọc được”, không biến thành “chưa xếp lớp”.</div>}
    {cohortError && <div className="acd-warning" role="alert">Không tải được danh mục lớp hoạt động: {cohortError}. Tạm khóa thao tác xếp lớp.</div>}
    {csvErrors.length ? <details className="asd-import-errors"><summary>{csvErrors.length} dòng CSV chưa import được</summary><ol>{csvErrors.map((error, index) => <li key={`${index}-${error}`}>{error}</li>)}</ol></details> : null}

    <section className="acd-workspace" aria-label="Danh sách học viên">
      <div className="asd-toolbar"><Field label="Tìm học viên"><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tên hoặc mã học viên…" disabled={busy} /></Field><button className="adm-btn-secondary" type="button" onClick={() => void loadStudents(debouncedQuery)} disabled={loading || busy}>{loading ? 'Đang tải…' : 'Tải lại'}</button></div>
      {selected.size ? <div className="asd-bulk" role="region" aria-label="Thêm lớp hàng loạt"><strong>{selected.size} đã chọn · không gỡ lớp hiện có</strong><select aria-label="Lớp cần thêm" value={bulkCohort} onChange={(event) => setBulkCohort(event.target.value)} disabled={Boolean(cohortError) || busy}><option value="">Chọn lớp hoạt động…</option>{cohorts.map((cohort) => <option key={cohort.id} value={cohort.id}>{cohort.name}</option>)}</select><button className="adm-btn-primary adm-btn-sm" type="button" onClick={() => void assignSelected()} disabled={!bulkCohort || busy}>Thêm vào lớp</button><button className="adm-btn-secondary adm-btn-sm" type="button" onClick={() => setSelected(new Set())} disabled={busy}>Bỏ chọn</button></div> : null}
      <div className="acd-result-bar"><strong>{loadError ? (showingStale ? `${students.length} học viên · dữ liệu lần tải trước` : 'Chưa đọc được danh sách') : students.length === LIMIT ? '200+ học viên' : `${students.length} học viên`}</strong><span>{students.length === LIMIT ? 'Thu hẹp tìm kiếm để đếm chính xác.' : 'Kết quả tìm kiếm từ backend.'}</span></div>
      {loadError && <div className={showingStale ? 'acd-warning' : 'acd-state is-error'} role="alert"><strong>Không tải được danh sách mới nhất</strong><span>{loadError}{showingStale ? ' Dữ liệu bên dưới có thể đã cũ.' : ''}</span><button className="adm-btn-secondary" type="button" onClick={() => void loadStudents(debouncedQuery)} disabled={loading || busy}>Thử lại</button></div>}
      {!loadError && loading && !hasSnapshot ? <div className="acd-state" role="status"><span className="acd-spinner" aria-hidden="true" />Đang tải danh sách học viên…</div> : null}
      {!loadError && !loading && !students.length ? <div className="acd-state"><strong>{debouncedQuery ? 'Không có học viên khớp tìm kiếm' : 'Chưa có học viên nào'}</strong><span>{debouncedQuery ? 'Thử tên hoặc mã khác.' : 'Thêm hồ sơ đầu tiên hoặc import CSV.'}</span></div> : null}
      {(students.length > 0) ? <div className="acd-table-scroll"><table className="acd-table asd-table"><thead><tr><th className="asd-check"><input type="checkbox" aria-label="Chọn tất cả học viên trong kết quả" checked={allSelected} onChange={toggleAll} disabled={busy} /></th><th>Học viên</th><th>Lớp</th><th>Tài khoản</th><th>Mục tiêu</th><th><span className="sr-only">Thao tác</span></th></tr></thead><tbody>{students.map((student) => {
        const cohort = cohortTruth(student);
        return <tr key={student.id}><td className="asd-check"><input type="checkbox" aria-label={`Chọn ${student.full_name}`} checked={selected.has(student.id)} onChange={() => toggleOne(student.id)} disabled={busy} /></td><td className="asd-student-cell"><button className="asd-student-name" type="button" onClick={() => void openProfile(student)}><strong>{student.full_name}</strong><code>{student.student_code}</code></button></td><td className="asd-cohort-cell">{student.cohorts.length ? <div className="asd-cohort-list" aria-label={`Các lớp của ${student.full_name}`}>{student.cohorts.map((item) => <span className="adm-chip" key={item.id}>{item.name || 'Không đọc được tên lớp'}</span>)}{student.membership_lookup_failed || student.cohort_lookup_failed ? <span className="asd-cohort-warning">⚠ lookup failed</span> : null}</div> : <span className={`asd-cohort is-${cohort.kind}`}>{cohort.label}</span>}</td><td className="asd-account-cell"><span className={`adm-status-pill ${student.user_id ? 'is-active' : 'is-archived'}`}>{student.user_id ? 'Đã kích hoạt' : 'Chưa kích hoạt'}</span></td><td className="asd-goal-cell"><div className="asd-goal"><strong>{formatBandGoal(student)}</strong>{student.target_date && <span>{dateLabel(student.target_date)}</span>}</div></td><td><div className="acd-actions"><a className="adm-btn-secondary adm-btn-sm" href={assignmentHref({}, { studentId: student.id })} aria-label={`Giao bài Writing cho ${student.full_name}`}>Giao bài Writing</a><a className="adm-btn-secondary adm-btn-sm" href={`/admin/writing/new?student_id=${encodeURIComponent(student.id)}`} aria-label={`Gửi bài chấm cho ${student.full_name}`}>Gửi bài chấm</a><button className="adm-btn-secondary adm-btn-sm" type="button" onClick={() => setDraft(studentDraft(student) as StudentDraft)} aria-label={`Sửa hồ sơ ${student.full_name}`} disabled={busy}>Sửa</button></div></td></tr>;
      })}</tbody></table></div> : null}
    </section>

    <Dialog open={Boolean(draft)} title={draft?.id ? 'Sửa hồ sơ học viên' : 'Thêm học viên'} description="Các trường tuỳ chọn để trống sẽ được xoá khỏi hồ sơ khi lưu." busy={busy} onClose={() => setDraft(null)} actions={<><button className="adm-btn-secondary" type="button" onClick={() => setDraft(null)} disabled={busy}>Hủy</button><button className="adm-btn-primary" type="submit" form="asd-student-form" disabled={busy}>{busy ? 'Đang lưu…' : draft?.id ? 'Lưu thay đổi' : 'Tạo học viên'}</button></>}>
      <form id="asd-student-form" className="acd-form asd-form" onSubmit={submitDraft}>
        <Field label="Mã học viên"><input autoFocus required maxLength={64} value={draft?.studentCode || ''} onChange={(event) => draft && setDraft({ ...draft, studentCode: event.target.value, error: '' })} /></Field>
        <Field label="Họ tên"><input required maxLength={255} value={draft?.fullName || ''} onChange={(event) => draft && setDraft({ ...draft, fullName: event.target.value, error: '' })} /></Field>
        <div className="asd-form__row"><Field label="Band hiện tại"><input type="number" min="0" max="9" step="0.5" value={draft?.currentBand || ''} onChange={(event) => draft && setDraft({ ...draft, currentBand: event.target.value, error: '' })} /></Field><Field label="Band mục tiêu"><input type="number" min="0" max="9" step="0.5" value={draft?.targetBand || ''} onChange={(event) => draft && setDraft({ ...draft, targetBand: event.target.value, error: '' })} /></Field></div>
        <Field label="Ngày mục tiêu"><input type="date" value={draft?.targetDate || ''} onChange={(event) => draft && setDraft({ ...draft, targetDate: event.target.value, error: '' })} /></Field>
        <Field label="Ghi chú học tập"><textarea rows={4} value={draft?.notes || ''} onChange={(event) => draft && setDraft({ ...draft, notes: event.target.value, error: '' })} /></Field>
        {draft?.error && <div className="acd-inline-error" role="alert">{draft.error}</div>}
      </form>
    </Dialog>
    <ProfileDialog profile={profile} onClose={() => setProfile(null)} />
  </main>;
}

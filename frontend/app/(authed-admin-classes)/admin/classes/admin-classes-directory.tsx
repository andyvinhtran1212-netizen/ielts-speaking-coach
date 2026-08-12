'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import { useAdminProfile } from '@/components/admin-access-gate';
import {
  cohortDraft,
  cohortSummary,
  courseOptionLabel,
  normalizeCohortsPayload,
  normalizeCoursesPayload,
  selectCohorts,
  validateCohortDraft,
} from '@/lib/admin-classes-model.mjs';

import type { Banner, Cohort, CohortDraft, CohortPayload, Course } from './admin-class-types';
import { Dialog, Field, messageOf, StatusBanner } from './admin-class-ui';

type ConfirmState = null | { cohort: Cohort; nextActive: boolean };

function Count({ value }: { value: number | null }) {
  return value == null ? <span className="acd-unknown">Chưa đọc được</span> : <>{value.toLocaleString('vi-VN')}</>;
}

function CourseCell({ cohort, lookupFailed }: { cohort: Cohort; lookupFailed: boolean }) {
  if (cohort.course) return (
    <div className="acd-course-cell">
      {cohort.course.code && <span className="adm-chip">{cohort.course.code}</span>}
      <span>{cohort.course.name}</span>
      {!cohort.course.is_active && <small>Đã lưu trữ</small>}
    </div>
  );
  if (cohort.course_id) return <span className="acd-unknown">{lookupFailed ? 'Không đọc được khoá' : 'Khoá không còn trong danh mục'}</span>;
  return <span className="acd-muted">Chưa gán khoá</span>;
}

function RosterCell({ cohort }: { cohort: Cohort }) {
  if (cohort.member_count == null) return <span className="acd-unknown">Không đọc được sĩ số</span>;
  return (
    <div className="acd-roster-cell">
      <strong>{cohort.member_count.toLocaleString('vi-VN')} học viên</strong>
      {cohort.unactivated_count == null
        ? <span className="acd-unknown">Chưa đọc được số chưa kích hoạt</span>
        : cohort.unactivated_count > 0 && <span>{cohort.unactivated_count.toLocaleString('vi-VN')} chưa kích hoạt</span>}
    </div>
  );
}

export function AdminClassesDirectory() {
  const profile = useAdminProfile();
  const [payload, setPayload] = useState<CohortPayload>({ cohorts: [], rollup_failed: false, course_lookup_failed: false });
  const [courses, setCourses] = useState<Course[]>([]);
  const [hasCohortSnapshot, setHasCohortSnapshot] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [coursesError, setCoursesError] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [status, setStatus] = useState('active');
  const [courseId, setCourseId] = useState('');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<CohortDraft | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [mutationBusy, setMutationBusy] = useState(false);
  const sequence = useRef(0);

  const loadDirectory = useCallback(async (silent = false) => {
    const requestId = ++sequence.current;
    if (!silent) setLoading(true);
    setLoadError(null);
    setCoursesError(null);
    const [cohortResult, courseResult] = await Promise.allSettled([
      window.api.get<unknown>('/admin/cohorts?with_rollup=true'),
      window.api.get<unknown>('/admin/courses'),
    ]);
    if (requestId !== sequence.current) return false;
    let canonical = true;
    if (cohortResult.status === 'fulfilled') {
      setPayload(normalizeCohortsPayload(cohortResult.value) as CohortPayload);
      setHasCohortSnapshot(true);
    } else {
      canonical = false;
      setLoadError(messageOf(cohortResult.reason));
    }
    if (courseResult.status === 'fulfilled') {
      setCourses(normalizeCoursesPayload(courseResult.value) as Course[]);
    } else {
      canonical = false;
      setCoursesError(messageOf(courseResult.reason));
    }
    setLoading(false);
    return canonical;
  }, []);

  useEffect(() => {
    setPayload({ cohorts: [], rollup_failed: false, course_lookup_failed: false });
    setCourses([]);
    setHasCohortSnapshot(false);
    setBanner(null);
    setStatus('active');
    setCourseId('');
    setSearch('');
    void loadDirectory();
    return () => { sequence.current += 1; };
  }, [profile.id, loadDirectory]);

  const rows = useMemo(
    () => selectCohorts(payload.cohorts, { status, courseId, search }) as Cohort[],
    [payload.cohorts, status, courseId, search],
  );
  const summary = useMemo(
    () => cohortSummary(payload.cohorts, payload.rollup_failed),
    [payload.cohorts, payload.rollup_failed],
  );
  const selectedCourseKnown = !draft?.courseId || courses.some((course) => course.id === draft.courseId);
  const showingStaleCohorts = Boolean(loadError && hasCohortSnapshot);

  const mutate = async (action: () => Promise<unknown>, success: string) => {
    if (mutationBusy) return;
    setMutationBusy(true);
    setBanner(null);
    try {
      await action();
      const reloaded = await loadDirectory(true);
      setBanner(reloaded
        ? { kind: 'success', text: success }
        : { kind: 'error', text: `${success} Tuy nhiên chưa tải lại được toàn bộ dữ liệu chuẩn; hãy bấm Tải lại.` });
    } catch (caught) {
      setBanner({ kind: 'error', text: messageOf(caught) });
    } finally {
      setMutationBusy(false);
    }
  };

  const submitDraft = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || mutationBusy) return;
    const validation = validateCohortDraft(draft) as { ok: boolean; error?: string; body?: Record<string, unknown> };
    if (!validation.ok || !validation.body) {
      setDraft({ ...draft, error: validation.error || 'Dữ liệu lớp không hợp lệ.' });
      return;
    }
    setMutationBusy(true);
    try {
      if (draft.id) await window.api.patch(`/admin/cohorts/${encodeURIComponent(draft.id)}`, validation.body);
      else await window.api.post('/admin/cohorts', validation.body);
      const wasEdit = Boolean(draft.id);
      const reloaded = await loadDirectory(true);
      setDraft(null);
      setBanner(reloaded
        ? { kind: 'success', text: wasEdit ? 'Đã lưu thông tin lớp.' : 'Đã tạo lớp.' }
        : { kind: 'error', text: 'Đã lưu lớp nhưng chưa tải lại được toàn bộ dữ liệu chuẩn.' });
    } catch (caught) {
      setDraft({ ...draft, error: messageOf(caught) });
    } finally {
      setMutationBusy(false);
    }
  };

  const runConfirm = async () => {
    if (!confirm || mutationBusy) return;
    const current = confirm;
    setConfirm(null);
    await mutate(
      () => window.api.patch(`/admin/cohorts/${encodeURIComponent(current.cohort.id)}`, { is_active: current.nextActive }),
      current.nextActive ? 'Đã khôi phục lớp.' : 'Đã lưu trữ lớp.',
    );
  };

  const clearFilters = () => { setStatus('active'); setCourseId(''); setSearch(''); };

  return (
    <main className="acd-shell">
      <header className="acd-header">
        <div>
          <p className="acd-eyebrow">Vận hành lớp học</p>
          <h1>Lớp <span>& Học viên</span></h1>
          <p>Theo dõi đúng sĩ số, trạng thái kích hoạt và khóa học trước khi mở workspace của từng lớp.</p>
        </div>
        <button className="adm-btn-primary" type="button" onClick={() => setDraft(cohortDraft() as CohortDraft)} disabled={mutationBusy}>Tạo lớp</button>
      </header>

      <nav className="acd-tabs" aria-label="Lớp và học viên">
        <a className="is-active" href="/admin/classes" aria-current="page"><span>Lớp</span><small>Danh mục · sĩ số · trạng thái</small></a>
        <a href="/pages/admin/classes/index.html?tab=students"><span>Học viên</span><small>Hồ sơ · xếp lớp · nhập CSV</small></a>
      </nav>

      <section className="acd-kpis" aria-label="Tổng quan lớp học">
        <div className="acd-kpi"><span>Lớp đang hoạt động</span><strong>{hasCohortSnapshot ? `${summary.active.toLocaleString('vi-VN')} / ${summary.total.toLocaleString('vi-VN')}` : <span className="acd-unknown">Chưa đọc được</span>}</strong></div>
        <div className="acd-kpi"><span>Học viên trong lớp active</span><strong><Count value={hasCohortSnapshot ? summary.students : null} /></strong></div>
        <div className="acd-kpi"><span>Chưa kích hoạt</span><strong><Count value={hasCohortSnapshot ? summary.unactivated : null} /></strong></div>
      </section>

      <StatusBanner banner={banner} />
      {payload.rollup_failed && !loadError && <div className="acd-warning" role="alert">Không đọc được sĩ số các lớp. Các ô sĩ số được giữ ở trạng thái “không đọc được”, không thay bằng 0.</div>}
      {payload.course_lookup_failed && !loadError && <div className="acd-warning" role="alert">Backend không đối chiếu được khóa học của lớp. Các liên kết khóa hiện tại được giữ nguyên.</div>}
      {coursesError && <div className="acd-warning" role="alert">Không tải được danh mục khóa học: {coursesError}. Bộ lọc khóa và lựa chọn khóa trong form tạm khóa.</div>}

      <section className="acd-workspace" aria-label="Danh sách lớp">
        <div className="acd-toolbar">
          <Field label="Trạng thái">
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="active">Đang hoạt động</option>
              <option value="archived">Đã lưu trữ</option>
              <option value="all">Tất cả</option>
            </select>
          </Field>
          <Field label="Khóa học">
            <select value={courseId} onChange={(event) => setCourseId(event.target.value)} disabled={Boolean(coursesError)}>
              <option value="">Tất cả khóa</option>
              {courses.map((course) => <option key={course.id} value={course.id}>{courseOptionLabel(course)}</option>)}
            </select>
          </Field>
          <Field label="Tìm lớp">
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tên lớp hoặc tiền tố mã…" />
          </Field>
          <button className="adm-btn-secondary" type="button" onClick={clearFilters} disabled={status === 'active' && !courseId && !search}>Xóa lọc</button>
          <button className="adm-btn-secondary" type="button" onClick={() => void loadDirectory()} disabled={loading || mutationBusy}>{loading ? 'Đang tải…' : 'Tải lại'}</button>
        </div>

        <div className="acd-result-bar"><strong>{loadError ? (showingStaleCohorts ? `${rows.length.toLocaleString('vi-VN')} lớp · dữ liệu lần tải trước` : 'Chưa đọc được danh sách') : `${rows.length.toLocaleString('vi-VN')} lớp`}</strong><span>Số liệu tổng quan chỉ tính lớp đang hoạt động.</span></div>
        {loadError && <div className={showingStaleCohorts ? 'acd-warning' : 'acd-state is-error'} role="alert"><strong>Không tải được danh sách lớp mới nhất</strong><span>{loadError}{showingStaleCohorts ? ' Dữ liệu bên dưới có thể đã cũ.' : ''}</span><button className="adm-btn-secondary" type="button" onClick={() => void loadDirectory()}>Thử lại</button></div>}
        {!loadError && loading && !payload.cohorts.length ? <div className="acd-state" role="status"><span className="acd-spinner" aria-hidden="true" />Đang tải dữ liệu lớp…</div> : null}
        {!loadError && !loading && rows.length === 0 ? <div className="acd-state"><strong>{payload.cohorts.length ? 'Không có lớp khớp bộ lọc' : 'Chưa có lớp nào'}</strong><span>{payload.cohorts.length ? 'Thử đổi từ khóa, khóa học hoặc trạng thái.' : 'Tạo lớp đầu tiên để bắt đầu.'}</span></div> : null}
        {(!loadError || payload.cohorts.length > 0) && rows.length > 0 ? (
          <div className="acd-table-scroll" data-testid="classes-table-scroll">
            <table className="acd-table">
              <thead><tr><th>Lớp học</th><th>Khóa học</th><th>Sĩ số</th><th>Tiền tố mã</th><th>Trạng thái</th><th><span className="sr-only">Thao tác</span></th></tr></thead>
              <tbody>{rows.map((cohort) => <tr key={cohort.id}>
                <td><div className="acd-class-cell"><a href={`/pages/admin/classes/index.html?cohort_id=${encodeURIComponent(cohort.id)}`}>{cohort.name}</a>{cohort.description && <span>{cohort.description}</span>}</div></td>
                <td><CourseCell cohort={cohort} lookupFailed={payload.course_lookup_failed} /></td>
                <td><RosterCell cohort={cohort} /></td>
                <td><code>{cohort.code_prefix || '—'}</code></td>
                <td><span className={`adm-status-pill ${cohort.is_active ? 'is-active' : 'is-archived'}`}>{cohort.is_active ? 'Đang hoạt động' : 'Đã lưu trữ'}</span></td>
                <td><div className="acd-actions">
                  <a className="adm-btn-secondary adm-btn-sm" href={`/pages/admin/classes/index.html?cohort_id=${encodeURIComponent(cohort.id)}`}>Mở lớp</a>
                  <button className="adm-btn-secondary adm-btn-sm" type="button" onClick={() => setDraft(cohortDraft(cohort) as CohortDraft)} disabled={mutationBusy}>Sửa</button>
                  <button className="adm-btn-secondary adm-btn-sm" type="button" onClick={() => setConfirm({ cohort, nextActive: !cohort.is_active })} disabled={mutationBusy}>{cohort.is_active ? 'Lưu trữ' : 'Khôi phục'}</button>
                </div></td>
              </tr>)}</tbody>
            </table>
          </div>
        ) : null}
      </section>

      <Dialog
        open={Boolean(draft)}
        title={draft?.id ? 'Sửa thông tin lớp' : 'Tạo lớp'}
        description={draft?.id ? 'Các trường để trống sẽ được xóa khỏi bản ghi khi lưu.' : 'Tạo một đợt học mới và có thể gắn với khóa học hiện có.'}
        busy={mutationBusy}
        onClose={() => setDraft(null)}
        actions={<>
          <button className="adm-btn-secondary" type="button" onClick={() => setDraft(null)} disabled={mutationBusy}>Hủy</button>
          <button className="adm-btn-primary" type="submit" form="acd-cohort-form" disabled={mutationBusy}>{mutationBusy ? 'Đang lưu…' : draft?.id ? 'Lưu thay đổi' : 'Tạo lớp'}</button>
        </>}
      >
        <form id="acd-cohort-form" className="acd-form" onSubmit={submitDraft}>
          <Field label="Tên lớp"><input autoFocus required maxLength={200} value={draft?.name || ''} onChange={(event) => draft && setDraft({ ...draft, name: event.target.value, error: '' })} /></Field>
          <Field label="Khóa học" hint={coursesError ? 'Không đọc được danh mục; giá trị hiện tại được giữ nguyên khi lưu.' : 'Bao gồm cả khóa đã lưu trữ để không làm mất liên kết lịch sử.'}>
            <select value={draft?.courseId || ''} onChange={(event) => draft && setDraft({ ...draft, courseId: event.target.value, error: '' })} disabled={Boolean(coursesError)}>
              <option value="">Chưa gán khóa</option>
              {draft?.courseId && !selectedCourseKnown && <option value={draft.courseId}>Khóa hiện tại (không đọc được tên)</option>}
              {courses.map((course) => <option key={course.id} value={course.id}>{courseOptionLabel(course)}</option>)}
            </select>
          </Field>
          <Field label="Tiền tố mã" hint="Tối đa 20 ký tự."><input maxLength={20} value={draft?.codePrefix || ''} onChange={(event) => draft && setDraft({ ...draft, codePrefix: event.target.value, error: '' })} placeholder="Ví dụ: AUG4" /></Field>
          <Field label="Mô tả"><textarea rows={4} value={draft?.description || ''} onChange={(event) => draft && setDraft({ ...draft, description: event.target.value, error: '' })} placeholder="Lịch học hoặc ghi chú vận hành…" /></Field>
          {draft?.error && <div className="acd-inline-error" role="alert">{draft.error}</div>}
        </form>
      </Dialog>

      <Dialog
        open={Boolean(confirm)}
        title={confirm?.nextActive ? 'Khôi phục lớp?' : 'Lưu trữ lớp?'}
        description={confirm?.nextActive
          ? <>Lớp <strong>{confirm.cohort.name}</strong> sẽ xuất hiện lại trong danh sách đang hoạt động.</>
          : <>Lớp <strong>{confirm?.cohort.name}</strong> được lưu trữ mềm; sĩ số và lịch sử không bị xóa.</>}
        busy={mutationBusy}
        onClose={() => setConfirm(null)}
        actions={<>
          <button className="adm-btn-secondary" type="button" onClick={() => setConfirm(null)} disabled={mutationBusy}>Hủy</button>
          <button className="adm-btn-primary" type="button" onClick={() => void runConfirm()} disabled={mutationBusy}>{mutationBusy ? 'Đang lưu…' : confirm?.nextActive ? 'Khôi phục' : 'Lưu trữ'}</button>
        </>}
      />
    </main>
  );
}

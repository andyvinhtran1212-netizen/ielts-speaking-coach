'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import {
  assignmentTone,
  buildInstructorMatrix,
  instructorApiPath,
  instructorGradeHref,
  normalizeInstructorAssignments,
  normalizeInstructorCodes,
  normalizeInstructorCohorts,
  normalizeInstructorProfile,
  normalizeInstructorPrompts,
  normalizeInstructorQueue,
  normalizeInstructorStudents,
  normalizeInstructorSummary,
} from '@/lib/instructor-dashboard-model.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

type Tab = 'roster' | 'classes' | 'assign' | 'grade';
type Banner = { tone: 'success' | 'danger' | 'warning'; message: string } | null;
type DataState = {
  cohorts: any[];
  students: any[];
  prompts: any[];
  codes: any[];
  assignments: any[];
  queue: any[];
};

const EMPTY_DATA: DataState = {
  cohorts: [], students: [], prompts: [], codes: [], assignments: [], queue: [],
};

function messageOf(caught: unknown) {
  return caught instanceof Error ? caught.message : String(caught || 'Lỗi không xác định.');
}

function readImpersonation() {
  const values = new URLSearchParams(window.location.search).getAll('as_instructor');
  if (values.length > 1) throw new Error('URL có nhiều as_instructor. Hãy mở lại workspace từ trang Admin.');
  return values[0]?.trim() || null;
}

function formatDate(value: string | null) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : new Intl.DateTimeFormat('vi-VN').format(parsed);
}

function StatusPill({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`ins-pill is-${tone}`}>{children}</span>;
}

function EmptyRow({ columns, children }: { columns: number; children: ReactNode }) {
  return <tr><td colSpan={columns} className="ins-empty">{children}</td></tr>;
}

export function InstructorDashboard() {
  const { status, user } = useAuth();
  const [tab, setTab] = useState<Tab>('roster');
  const [phase, setPhase] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading');
  const [asInstructor, setAsInstructor] = useState<string | null>(null);
  const [data, setData] = useState<DataState>(EMPTY_DATA);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [assignmentTarget, setAssignmentTarget] = useState<'cohort' | 'student'>('cohort');
  const [drawerStudentId, setDrawerStudentId] = useState<string | null>(null);
  const [drawerSummary, setDrawerSummary] = useState<any>(null);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const sequence = useRef(0);
  const drawerSequence = useRef(0);
  const accountKey = status === 'signed-in' && user?.id ? user.id : '';
  const accountRef = useRef(accountKey);
  accountRef.current = accountKey;

  const requestPath = useCallback((path: string, target = asInstructor) => (
    instructorApiPath(path, target)
  ), [asInstructor]);

  const loadAll = useCallback(async (
    target: string | null,
    requestId = ++sequence.current,
    ownerId = accountRef.current,
  ) => {
    if (!ownerId || ownerId !== accountRef.current) return null;
    setLoadError(null);
    const paths = [
      '/instructor/cohorts',
      '/instructor/students',
      '/instructor/prompts',
      '/instructor/codes',
      '/instructor/assignments',
      '/instructor/reviews/queue',
    ].map((path) => instructorApiPath(path, target));
    try {
      const raw = await Promise.all(paths.map((path) => window.api.get<unknown>(path)));
      const normalized: DataState = {
        cohorts: normalizeInstructorCohorts(raw[0]),
        students: normalizeInstructorStudents(raw[1]),
        prompts: normalizeInstructorPrompts(raw[2]),
        codes: normalizeInstructorCodes(raw[3]),
        assignments: normalizeInstructorAssignments(raw[4]),
        queue: normalizeInstructorQueue(raw[5]),
      } as DataState;
      if (Object.values(normalized).some((value) => value === null)) {
        throw new Error('Backend trả dữ liệu giảng viên không đúng định dạng.');
      }
      if (requestId !== sequence.current || ownerId !== accountRef.current) return null;
      setData(normalized);
      setPhase('ready');
      return normalized;
    } catch (caught) {
      if (requestId === sequence.current && ownerId === accountRef.current) {
        setLoadError(messageOf(caught));
        setPhase((current) => current === 'ready' ? current : 'error');
      }
      return null;
    }
  }, []);

  useEffect(() => {
    if (status === 'signed-out') {
      window.location.replace('/login');
      return;
    }
    if (status !== 'signed-in' || !user?.id) return;
    const requestId = ++sequence.current;
    setPhase('loading');
    setData(EMPTY_DATA);
    setBanner(null);
    setPending(null);
    setDrawerStudentId(null);
    setDrawerSummary(null);
    setDrawerError(null);
    (async () => {
      try {
        const ready = await whenGlobalReady(() => typeof window.api?.get === 'function', 'window.api (instructor)');
        if (!ready) throw new Error('Không tải được công cụ kết nối. Hãy tải lại trang.');
        const normalizedProfile = normalizeInstructorProfile(await window.api.get<unknown>('/auth/me'));
        if (!normalizedProfile) throw new Error('Không xác nhận được vai trò tài khoản.');
        if (requestId !== sequence.current) return;
        if (!['instructor', 'admin'].includes(normalizedProfile.role)) {
          setPhase('denied');
          return;
        }
        const requested = readImpersonation();
        const effective = normalizedProfile.role === 'admin' ? requested : null;
        setAsInstructor(effective);
        await loadAll(effective, requestId, user.id);
      } catch (caught) {
        if (requestId === sequence.current) {
          setLoadError(messageOf(caught));
          setPhase('error');
        }
      }
    })();
    return () => { sequence.current += 1; drawerSequence.current += 1; };
  }, [status, user?.id, loadAll]);

  const cohortNames = useMemo(() => new Map(data.cohorts.map((cohort) => [cohort.id, cohort.name])), [data.cohorts]);
  const matrix = useMemo(() => buildInstructorMatrix(data.students, data.prompts, data.assignments), [data]);

  const refresh = async () => {
    const ownerId = accountRef.current;
    setPending('refresh');
    await loadAll(asInstructor, undefined, ownerId);
    if (ownerId === accountRef.current) setPending(null);
  };

  const mutate = async (key: string, action: () => Promise<unknown>, success: string) => {
    if (pending) return;
    const ownerId = accountRef.current;
    setPending(key);
    setBanner(null);
    try {
      await action();
      if (ownerId !== accountRef.current) return false;
      const refreshed = await loadAll(asInstructor, undefined, ownerId);
      if (!refreshed) {
        setBanner({
          tone: 'warning',
          message: 'Thao tác đã được gửi nhưng chưa xác nhận được dữ liệu canonical. Hãy làm mới trước khi tiếp tục.',
        });
        return false;
      }
      setBanner({ tone: 'success', message: success });
      return true;
    } catch (caught) {
      if (ownerId !== accountRef.current) return false;
      const refreshed = await loadAll(asInstructor, undefined, ownerId);
      setBanner({
        tone: 'danger',
        message: refreshed
          ? `${messageOf(caught)} Dữ liệu canonical đã được tải lại; hệ thống không tự gửi lại mutation.`
          : `${messageOf(caught)} Chưa xác nhận được trạng thái canonical; hệ thống không tự gửi lại mutation. Hãy làm mới trước khi tiếp tục.`,
      });
      return false;
    } finally {
      if (ownerId === accountRef.current) setPending(null);
    }
  };

  const createCohort = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get('name') || '').trim();
    if (!name) return;
    void mutate('cohort', () => window.api.post(requestPath('/instructor/cohorts'), { name }), 'Đã tạo lớp.').then((ok) => { if (ok) form.reset(); });
  };

  const mintCodes = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const cohortId = String(values.get('cohort_id') || '').trim();
    const count = Math.max(1, Math.min(50, Number(values.get('count')) || 1));
    const body: Record<string, unknown> = { count };
    if (cohortId) body.cohort_id = cohortId;
    void mutate('codes', () => window.api.post(requestPath('/instructor/codes'), body), 'Đã tạo mã ghi danh.');
  };

  const createPrompt = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const body = {
      title: String(values.get('title') || '').trim(),
      task_type: String(values.get('task_type') || ''),
      prompt_text: String(values.get('prompt_text') || '').trim(),
    };
    if (!body.title || !body.prompt_text) return;
    void mutate('prompt', () => window.api.post(requestPath('/instructor/prompts'), body), 'Đã tạo đề bài.').then((ok) => { if (ok) form.reset(); });
  };

  const createAssignment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const promptId = String(values.get('prompt_id') || '');
    const target = String(values.get('target') || 'cohort');
    const deadline = String(values.get('deadline') || '') || null;
    const analysisLevel = Number(values.get('analysis_level')) || 3;
    const gradingTier = String(values.get('grading_tier') || 'standard');
    if (!promptId) return setBanner({ tone: 'danger', message: 'Chưa chọn đề bài.' });
    if (target === 'cohort') {
      const cohortId = String(values.get('cohort_id') || '');
      if (!cohortId) return setBanner({ tone: 'danger', message: 'Chưa chọn lớp.' });
      const body: Record<string, unknown> = { prompt_ids: [promptId], cohort_id: cohortId, analysis_level: analysisLevel, grading_tier: gradingTier };
      if (deadline) body.deadline = deadline;
      void mutate('assignment', () => window.api.post(requestPath('/instructor/assignments/fan-out'), body), 'Đã giao bài cho lớp.');
      return;
    }
    const studentId = String(values.get('student_id') || '');
    if (!studentId) return setBanner({ tone: 'danger', message: 'Chưa chọn học viên.' });
    const body: Record<string, unknown> = { prompt_id: promptId, student_id: studentId, analysis_level: analysisLevel, grading_tier: gradingTier };
    if (deadline) body.deadline = deadline;
    void mutate('assignment', () => window.api.post(requestPath('/instructor/assignments'), body), 'Đã giao bài cho học viên.');
  };

  const openStudent = async (studentId: string) => {
    const ownerId = accountRef.current;
    const requestId = ++drawerSequence.current;
    setDrawerStudentId(studentId);
    setDrawerSummary(null);
    setDrawerError(null);
    try {
      const raw = await window.api.get<unknown>(requestPath(`/instructor/students/${encodeURIComponent(studentId)}/summary`));
      const normalized = normalizeInstructorSummary(raw);
      if (!normalized) throw new Error('Dữ liệu hồ sơ học viên không đúng định dạng.');
      if (requestId === drawerSequence.current && ownerId === accountRef.current) setDrawerSummary(normalized);
    } catch (caught) {
      if (requestId === drawerSequence.current && ownerId === accountRef.current) setDrawerError(messageOf(caught));
    }
  };

  const closeDrawer = () => {
    drawerSequence.current += 1;
    setDrawerStudentId(null);
    setDrawerSummary(null);
    setDrawerError(null);
  };

  useEffect(() => {
    if (!drawerStudentId) return undefined;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') closeDrawer(); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [drawerStudentId]);

  const claimAndGrade = async (item: any) => {
    if (pending) return;
    const ownerId = accountRef.current;
    setPending(`review:${item.reviewId}`);
    setBanner(null);
    try {
      if (item.status !== 'claimed') {
        await window.api.post(requestPath(`/instructor/reviews/${encodeURIComponent(item.reviewId)}/claim`), {});
      }
      if (ownerId !== accountRef.current) return;
      const refreshed = await loadAll(asInstructor, undefined, ownerId);
      const reconciled = refreshed?.queue.find((row) => row.reviewId === item.reviewId && row.status === 'claimed');
      if (!reconciled) {
        setBanner({ tone: 'warning', message: 'Chưa xác nhận được quyền chấm từ dữ liệu canonical. Hệ thống không tự gửi lại yêu cầu nhận bài.' });
        setPending(null);
        return;
      }
      window.location.assign(instructorGradeHref(item.essayId, item.reviewId, asInstructor));
    } catch (caught: any) {
      if (ownerId !== accountRef.current) return;
      const refreshed = await loadAll(asInstructor, undefined, ownerId);
      const reconciled = refreshed?.queue.find((row) => row.reviewId === item.reviewId && row.status === 'claimed');
      if (reconciled) {
        window.location.assign(instructorGradeHref(item.essayId, item.reviewId, asInstructor));
        return;
      }
      const prefix = caught?.status === 403 ? 'Bài này không thuộc bạn.'
        : caught?.status === 409 ? 'Bài đã được người khác nhận chấm.' : messageOf(caught);
      setBanner({ tone: 'danger', message: prefix });
      setPending(null);
    }
  };

  const signOut = async () => {
    try { await (window.getSupabase?.() as any)?.auth?.signOut?.(); } catch { /* redirect still clears page state */ }
    window.location.replace('/');
  };

  if (phase === 'loading') return <main className="ins-state" role="status">Đang kiểm tra quyền và tải workspace…</main>;
  if (phase === 'denied') return <main className="ins-state" role="alert"><strong>Bạn không có quyền truy cập trang giảng viên.</strong><a href="/home">Quay lại trang học</a></main>;
  if (phase === 'error') return <main className="ins-state is-error" role="alert"><strong>Không mở được workspace giảng viên.</strong><span>{loadError}</span><button type="button" onClick={() => window.location.reload()}>Tải lại</button></main>;

  return (
    <>
      <header className="ins-top">
        <a href="/home" className="ins-brand">Aver<span>.</span>Learning</a>
        <span className="ins-role">Giảng viên</span>
        <div className="ins-top__actions">
          <a href="/home">← Về trang học</a>
          <button type="button" onClick={() => void refresh()} disabled={pending === 'refresh'}>{pending === 'refresh' ? 'Đang tải…' : 'Làm mới'}</button>
          <button type="button" onClick={() => void signOut()}>Đăng xuất</button>
        </div>
      </header>

      <nav className="ins-tabs" aria-label="Không gian giảng viên">
        {([['roster', 'Học viên'], ['classes', 'Lớp & Mã'], ['assign', 'Giao bài'], ['grade', 'Chấm bài']] as const).map(([key, label]) => (
          <button type="button" key={key} className={tab === key ? 'is-active' : ''} onClick={() => setTab(key)}>{label}</button>
        ))}
      </nav>

      <main className="ins-main">
        {asInstructor && <aside className="ins-banner is-warning"><span>Đang xem như giảng viên <code>{asInstructor}</code>. Mỗi request được backend ghi audit.</span><a href="/admin/instructors">Thoát impersonation</a></aside>}
        {banner && <div className={`ins-banner is-${banner.tone}`} role={banner.tone === 'danger' ? 'alert' : 'status'}>{banner.message}</div>}
        {loadError && <div className="ins-banner is-danger" role="alert"><span>Không thể làm mới; đang giữ snapshot trước đó. {loadError}</span><button type="button" onClick={() => void refresh()}>Thử lại</button></div>}

        {tab === 'roster' && <section aria-labelledby="roster-title">
          <div className="ins-heading"><div><p>Danh sách phụ trách</p><h1 id="roster-title">Học viên của tôi</h1></div><strong>{data.students.length}</strong></div>
          <div className="ins-card ins-table-wrap"><table className="ins-table"><thead><tr><th>Học viên</th><th>Mã HV</th><th>Lớp</th><th>Tài khoản</th></tr></thead><tbody>
            {data.students.length ? data.students.map((student) => <tr key={student.id} className="is-clickable" onClick={() => void openStudent(student.id)}><td><button type="button" className="ins-row-link">{student.fullName}</button></td><td><code>{student.studentCode}</code></td><td>{student.cohortId ? cohortNames.get(student.cohortId) || 'Lớp không xác định' : '—'}</td><td><StatusPill tone={student.userId ? 'success' : 'neutral'}>{student.userId ? 'Đã kích hoạt' : 'Chưa kích hoạt'}</StatusPill></td></tr>)
              : <EmptyRow columns={4}>Chưa có học viên. Tạo mã ghi danh ở tab “Lớp & Mã”.</EmptyRow>}
          </tbody></table></div>
        </section>}

        {tab === 'classes' && <section aria-labelledby="classes-title">
          <div className="ins-heading"><div><p>Quản lý roster</p><h1 id="classes-title">Lớp & Mã ghi danh</h1></div></div>
          <div className="ins-grid">
            <article className="ins-card"><h2>Lớp của tôi</h2><form className="ins-form-row" onSubmit={createCohort}><label><span>Tên lớp mới</span><input name="name" required placeholder="VD: Lớp IELTS tối T2-4" /></label><button type="submit" disabled={!!pending}>{pending === 'cohort' ? 'Đang tạo…' : 'Tạo lớp'}</button></form>
              <div className="ins-table-wrap"><table className="ins-table"><thead><tr><th>Lớp</th><th>Ngày tạo</th></tr></thead><tbody>{data.cohorts.length ? data.cohorts.map((cohort) => <tr key={cohort.id}><td>{cohort.name}</td><td>{formatDate(cohort.createdAt)}</td></tr>) : <EmptyRow columns={2}>Chưa có lớp.</EmptyRow>}</tbody></table></div>
            </article>
            <article className="ins-card"><h2>Mã ghi danh học viên</h2><p className="ins-note">Mã cấp quyền học viên; backend luôn chặn cấp role giảng viên.</p><form className="ins-form-row" onSubmit={mintCodes}><label><span>Gắn vào lớp</span><select name="cohort_id"><option value="">Không gắn lớp</option>{data.cohorts.map((cohort) => <option key={cohort.id} value={cohort.id}>{cohort.name}</option>)}</select></label><label><span>Số mã</span><input name="count" type="number" min="1" max="50" defaultValue="1" /></label><button type="submit" disabled={!!pending}>{pending === 'codes' ? 'Đang tạo…' : 'Tạo mã'}</button></form>
              <div className="ins-table-wrap"><table className="ins-table"><thead><tr><th>Mã</th><th>Trạng thái</th><th>Lớp</th></tr></thead><tbody>{data.codes.length ? data.codes.map((code) => <tr key={code.id}><td><code className="ins-code">{code.code}</code></td><td><StatusPill tone={code.isUsed ? 'success' : 'neutral'}>{code.isUsed ? 'Đã dùng' : 'Chưa dùng'}</StatusPill></td><td>{code.cohortId ? cohortNames.get(code.cohortId) || 'Lớp không xác định' : '—'}</td></tr>) : <EmptyRow columns={3}>Chưa có mã.</EmptyRow>}</tbody></table></div>
            </article>
          </div>
        </section>}

        {tab === 'assign' && <section aria-labelledby="assign-title">
          <div className="ins-heading"><div><p>Writing workflow</p><h1 id="assign-title">Giao bài</h1></div></div>
          <div className="ins-grid">
            <article className="ins-card"><h2>Giao một đề bài</h2>{!data.prompts.length && <p className="ins-empty">Tạo đề bài nhanh trước khi giao.</p>}<form className="ins-form" onSubmit={createAssignment}><label><span>Đề bài</span><select name="prompt_id" required><option value="">Chọn đề bài</option>{data.prompts.map((prompt) => <option key={prompt.id} value={prompt.id}>{prompt.title}</option>)}</select></label><fieldset><legend>Giao cho</legend><label className="ins-radio"><input type="radio" name="target" value="cohort" checked={assignmentTarget === 'cohort'} onChange={() => setAssignmentTarget('cohort')} /> Cả lớp</label><label className="ins-radio"><input type="radio" name="target" value="student" checked={assignmentTarget === 'student'} onChange={() => setAssignmentTarget('student')} /> Học viên lẻ</label></fieldset>{assignmentTarget === 'cohort' ? <label><span>Lớp</span><select name="cohort_id"><option value="">Chọn lớp</option>{data.cohorts.map((cohort) => <option key={cohort.id} value={cohort.id}>{cohort.name}</option>)}</select></label> : <label><span>Học viên lẻ</span><select name="student_id"><option value="">Chọn học viên</option>{data.students.map((student) => <option key={student.id} value={student.id}>{student.fullName} ({student.studentCode})</option>)}</select></label>}<label><span>Hạn nộp</span><input name="deadline" type="datetime-local" /></label><label><span>Độ sâu phản hồi</span><select name="analysis_level" defaultValue="3">{[1,2,3,4,5].map((level) => <option key={level} value={level}>L{level}</option>)}</select></label><label><span>Tier chấm AI</span><select name="grading_tier" defaultValue="standard"><option value="standard">Standard — 1 lượt AI</option><option value="deep">Deep — 3 lượt AI</option></select></label><button type="submit" disabled={!!pending}>{pending === 'assignment' ? 'Đang giao…' : 'Giao bài'}</button></form></article>
            <article className="ins-card"><h2>Tạo đề bài nhanh</h2><form className="ins-form" onSubmit={createPrompt}><label><span>Tiêu đề</span><input name="title" required placeholder="VD: Task 2 — Technology" /></label><label><span>Dạng</span><select name="task_type" defaultValue="task2"><option value="task2">Task 2</option><option value="task1_academic">Task 1 (Academic)</option><option value="task1_general">Task 1 (General)</option></select></label><label><span>Đề bài</span><textarea name="prompt_text" rows={7} required /></label><button type="submit" disabled={!!pending}>{pending === 'prompt' ? 'Đang tạo…' : 'Tạo đề bài'}</button></form></article>
          </div>
          <article className="ins-card"><h2>Ma trận nộp bài</h2><div className="ins-table-wrap"><table className="ins-table"><thead>{matrix.columns.length ? <tr><th>Học viên</th>{matrix.columns.map((column: any) => <th key={column.id}>{column.title}</th>)}</tr> : null}</thead><tbody>{matrix.columns.length ? matrix.rows.map((row: any) => <tr key={row.student.id}><td>{row.student.fullName}</td>{row.cells.map((cell: any, index: number) => { const status = assignmentTone(cell); return <td key={matrix.columns[index].id}><StatusPill tone={status.tone}>{status.label}</StatusPill></td>; })}</tr>) : <EmptyRow columns={1}>Chưa giao bài nào.</EmptyRow>}</tbody></table></div><p className="ins-note">Trạng thái lấy từ assignment canonical; “Trễ” chỉ áp dụng khi chưa nộp và deadline đã qua.</p></article>
        </section>}

        {tab === 'grade' && <section aria-labelledby="grade-title">
          <div className="ins-heading"><div><p>Owner-scoped queue</p><h1 id="grade-title">Hàng chờ chấm</h1></div><strong>{data.queue.length}</strong></div>
          <div className="ins-card ins-table-wrap"><table className="ins-table"><thead><tr><th>Học viên</th><th>Dạng</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{data.queue.length ? data.queue.map((item) => <tr key={item.reviewId}><td>{item.studentEmail || item.essayId}</td><td>{item.taskType || '—'}</td><td><StatusPill tone={item.status === 'claimed' ? 'warning' : 'neutral'}>{item.status}</StatusPill></td><td><button type="button" onClick={() => void claimAndGrade(item)} disabled={!!pending}>{pending === `review:${item.reviewId}` ? 'Đang xác nhận…' : item.status === 'claimed' ? 'Chấm tiếp' : 'Nhận chấm'}</button></td></tr>) : <EmptyRow columns={4}>Không có bài chờ chấm.</EmptyRow>}</tbody></table></div>
        </section>}
      </main>

      {drawerStudentId && <><button type="button" className="ins-drawer-backdrop" aria-label="Đóng hồ sơ học viên" onClick={closeDrawer} /><aside className="ins-drawer" aria-label="Hồ sơ học viên" aria-live="polite"><button type="button" className="ins-drawer__close" onClick={closeDrawer} aria-label="Đóng">×</button>{drawerError && <div className="ins-banner is-danger" role="alert">{drawerError}</div>}{!drawerError && !drawerSummary && <p className="ins-empty">Đang tải hồ sơ…</p>}{drawerSummary && <><p className="ins-kicker">Hồ sơ học viên</p><h2>{drawerSummary.student.fullName}</h2><p className="ins-note">{drawerSummary.student.studentCode}{drawerSummary.student.targetBand ? ` · Mục tiêu ${drawerSummary.student.targetBand}` : ''}</p><dl className="ins-stats"><div><dt>Tổng bài</dt><dd>{drawerSummary.stats.totalEssays}</dd></div><div><dt>Đã chấm</dt><dd>{drawerSummary.stats.gradedCount}</dd></div><div><dt>Gắn cờ</dt><dd>{drawerSummary.stats.flaggedCount}</dd></div><div><dt>Band TB 5 bài</dt><dd>{drawerSummary.stats.averageBandLast5 ?? '—'}</dd></div></dl><h3>Bài gần đây</h3><div className="ins-table-wrap"><table className="ins-table"><thead><tr><th>Dạng</th><th>Trạng thái</th></tr></thead><tbody>{drawerSummary.recentEssays.length ? drawerSummary.recentEssays.map((essay: any) => <tr key={essay.id}><td>{essay.taskType}</td><td>{essay.status}</td></tr>) : <EmptyRow columns={2}>Chưa có bài.</EmptyRow>}</tbody></table></div></>}</aside></>}
    </>
  );
}

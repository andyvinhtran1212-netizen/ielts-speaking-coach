'use client';

// Danh bạ học viên (ADMINIA-0074 FR-020, FR-021, FR-028, FR-034, FR-035;
// plan 5.4; G09-T10). One row per person from GET /admin/learners (G09-T03).
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { useAdminProfile } from '@/components/admin-access-gate';
import { Dialog, Field, messageOf, StatusBanner } from '@/components/admin-directory-ui';
import { LearnerSummary } from '@/components/admin/learner-summary';
import { getAdminCohorts } from '@/lib/admin-cohorts-api';
import {
  getLearnerDirectory,
  getLearnerSummary,
  type LearnerDirectoryWire,
  type LearnerRowWire,
  type LearnerSummaryWire,
} from '@/lib/admin-learners-api';
import {
  ATTENTION_OPTIONS,
  COURSES_PENDING_TEXT,
  CREDITS_OPTIONS,
  KIND_OPTIONS,
  NOTIFY_HANDOFF_KEY,
  PAGE_SIZE,
  ROLE_OPTIONS,
  STATUS_OPTIONS,
  assignableIds,
  attentionText,
  cohortsText,
  coursesText,
  creditsText,
  directoryApiQuery,
  directoryCsv,
  directoryQueryString,
  kindText,
  lastActiveText,
  notifyHandoff,
  notifyHref,
  parseDirectoryQuery,
  profileHref,
} from '@/lib/admin-learners-model.mjs';
import { normalizeCohortPicker, studentDraft, validateStudentDraft } from '@/lib/admin-students-model.mjs';
import { assignmentHref } from '@/lib/admin-writing-assignments-model.mjs';

type State = ReturnType<typeof parseDirectoryQuery>;
type Banner = { kind: 'success' | 'error'; text: string } | null;
type Cohort = { id: string; name: string };
type Draft = ReturnType<typeof studentDraft> & { error?: string };
type Quick = { row: LearnerRowWire; summary: LearnerSummaryWire | null; failed: string[]; error: string | null };

function saveCsv(text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'danh-ba-hoc-vien.csv';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function AdminLearners() {
  const admin = useAdminProfile();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  // Keyed on the string: the params object is not stable across renders.
  const queryText = search?.toString() ?? '';
  const state = useMemo(() => parseDirectoryQuery(queryText), [queryText]);
  const [data, setData] = useState<LearnerDirectoryWire | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draftQ, setDraftQ] = useState(state.q);
  const [cohorts, setCohorts] = useState<Cohort[] | null>(null);
  const [selected, setSelected] = useState<Map<string, LearnerRowWire>>(new Map());
  const [bulkCohort, setBulkCohort] = useState('');
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);
  const [csvErrors, setCsvErrors] = useState<string[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [quick, setQuick] = useState<Quick | null>(null);
  const sequence = useRef(0);
  const current = useRef(state);
  current.current = state;
  const csvInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async (s: State) => {
    const id = ++sequence.current;
    setLoading(true);
    setLoadError(null);
    try {
      const out = await getLearnerDirectory(directoryApiQuery(s));
      if (id !== sequence.current) return false;
      setData(out);
      return true;
    } catch (caught) {
      if (id !== sequence.current) return false;
      console.warn('[admin-learners] directory load failed', caught);
      setLoadError(messageOf(caught));
      return false;
    } finally {
      if (id === sequence.current) setLoading(false);
    }
  }, []);

  // Only the newest request fills the table (sequence guard in load); rows of
  // the previous query are cleared so they cannot be selected meanwhile.
  useEffect(() => { setDraftQ(state.q); setData(null); void load(state); }, [load, state]);
  useEffect(() => { setSelected(new Map()); }, [state, admin.id]);
  useEffect(() => {
    getAdminCohorts({ isActive: true })
      .then((out) => setCohorts(normalizeCohortPicker(out) as Cohort[]))
      .catch((caught) => { console.warn('[admin-learners] cohorts failed', caught); setCohorts(null); });
  }, [admin.id]);

  // Search waits for a pause in typing, then lands in the URL like every filter.
  useEffect(() => {
    const next = draftQ.trim();
    if (next === state.q) return undefined;
    const timer = window.setTimeout(() => go({ q: next }), 350);
    return () => window.clearTimeout(timer);
  }, [draftQ]); // eslint-disable-line react-hooks/exhaustive-deps

  function go(next: Partial<State>) {
    router.push(`${pathname}${directoryQueryString({ ...state, page: 1, ...next })}`);
  }

  const reload = async (success: string) => {
    const fresh = await load(current.current);
    setBanner(fresh ? { kind: 'success', text: success }
      : { kind: 'error', text: `${success} Chưa tải lại được danh bạ; bấm Tải lại.` });
  };

  const items = data?.items ?? [];
  const pages = data ? Math.max(1, Math.ceil(data.total / (data.page_size || PAGE_SIZE))) : 1;
  const chosen = [...selected.values()];
  const allChecked = items.length > 0 && items.every((r) => selected.has(r.ref));
  const filtered = Boolean(state.q || state.cohort || state.status || state.attention || state.role !== 'user,student');

  const toggle = (row: LearnerRowWire) => setSelected((prev) => {
    const next = new Map(prev);
    if (next.has(row.ref)) next.delete(row.ref); else next.set(row.ref, row);
    return next;
  });
  const toggleAll = () => setSelected((prev) => {
    const next = new Map(prev);
    if (allChecked) items.forEach((r) => next.delete(r.ref)); else items.forEach((r) => next.set(r.ref, r));
    return next;
  });

  const assign = async () => {
    if (!bulkCohort || busy) return;
    const { ids, skipped } = assignableIds(chosen);
    if (!ids.length) { setBanner({ kind: 'error', text: 'Không ai trong số đã chọn có hồ sơ học viên để thêm vào lớp.' }); return; }
    setBusy(true); setBanner(null);
    try {
      const out = await window.api.post<{ assigned?: number }>(
        `/admin/cohorts/${encodeURIComponent(bulkCohort)}/students/bulk`, { student_ids: ids });
      setSelected(new Map()); setBulkCohort('');
      const skippedText = skipped.length ? ` Bỏ qua ${skipped.length} người chưa có hồ sơ học viên: ${skipped.join(', ')}.` : '';
      await reload(`Đã thêm ${out?.assigned ?? ids.length} học viên vào lớp; các lớp khác giữ nguyên.${skippedText}`);
    } catch (caught) {
      setBanner({ kind: 'error', text: messageOf(caught) });
    } finally { setBusy(false); }
  };

  const remind = () => {
    try { window.sessionStorage.setItem(NOTIFY_HANDOFF_KEY, notifyHandoff(chosen)); } catch { /* names are a convenience */ }
    router.push(notifyHref(chosen));
  };

  const importCsv = async (file: File | undefined) => {
    if (!file || busy) return;
    const form = new FormData(); form.append('file', file);
    setBusy(true); setBanner(null); setCsvErrors([]);
    try {
      const out = await window.api.upload<{ imported?: number; errors?: unknown[] }>('/admin/students/import', form);
      const errors = (Array.isArray(out?.errors) ? out.errors : []).map((e) => (typeof e === 'string' ? e : JSON.stringify(e)));
      setCsvErrors(errors);
      await reload(`Đã import ${out?.imported ?? 0} học viên${errors.length ? `; ${errors.length} dòng cần kiểm tra.` : '.'}`);
    } catch (caught) { setBanner({ kind: 'error', text: messageOf(caught) }); }
    finally { setBusy(false); if (csvInput.current) csvInput.current.value = ''; }
  };

  const submitDraft = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || busy) return;
    const check = validateStudentDraft(draft) as { ok: boolean; error?: string; body?: Record<string, unknown> };
    if (!check.ok || !check.body) { setDraft({ ...draft, error: check.error || 'Dữ liệu không hợp lệ.' }); return; }
    setBusy(true); setBanner(null);
    try {
      await window.api.post('/admin/students', check.body);
      setDraft(null);
      await reload('Đã tạo học viên.');
    } catch (caught) { setDraft({ ...draft, error: messageOf(caught) }); }
    finally { setBusy(false); }
  };

  const openQuick = async (row: LearnerRowWire) => {
    setQuick({ row, summary: null, failed: [], error: null });
    try {
      const out = await getLearnerSummary(row.ref);
      const { sources_failed: failed, ...summary } = out;
      setQuick((cur) => (cur?.row.ref === row.ref ? { ...cur, summary, failed: failed ?? [] } : cur));
    } catch (caught) {
      setQuick((cur) => (cur?.row.ref === row.ref ? { ...cur, error: messageOf(caught) } : cur));
    }
  };

  return (
    <main className="la-shell">
      <header className="la-header">
        <div>
          <h1>Học viên</h1>
          <p className="subtitle">Mỗi người một dòng, gồm tài khoản đăng nhập và hồ sơ học viên. Bấm tên để mở hồ sơ.</p>
        </div>
        <div className="la-header__actions">
          <input ref={csvInput} className="sr-only" type="file" accept=".csv,text/csv" aria-label="Chọn tệp CSV học viên"
            onChange={(e) => void importCsv(e.target.files?.[0])} />
          <button className="adm-btn-secondary" type="button" disabled={busy} onClick={() => csvInput.current?.click()}>Import CSV</button>
          <button className="adm-btn-primary" type="button" disabled={busy} onClick={() => setDraft(studentDraft() as Draft)}>Thêm học viên</button>
        </div>
      </header>

      <form className="la-filters" role="search" aria-label="Lọc danh bạ" onSubmit={(e) => { e.preventDefault(); go({ q: draftQ.trim() }); }}>
        <Field label="Tìm">
          <input type="search" value={draftQ} maxLength={128} placeholder="Tên, email, mã học viên, mã kích hoạt"
            onChange={(e) => setDraftQ(e.target.value)} />
        </Field>
        <Field label="Dạng học viên" hint={COURSES_PENDING_TEXT}>
          <select disabled value="">{KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        </Field>
        <Field label="Lớp">
          <select value={state.cohort} disabled={!cohorts} onChange={(e) => go({ cohort: e.target.value })}>
            <option value="">{cohorts ? 'Tất cả lớp' : 'Chưa tải được danh sách lớp'}</option>
            {(cohorts ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Trạng thái">
          <select value={state.status} onChange={(e) => go({ status: e.target.value })}>
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value} disabled={Boolean(o.needsCourses)}>
              {o.label}{o.needsCourses ? ' (chưa có)' : ''}</option>)}
          </select>
        </Field>
        <Field label="Vai trò">
          <select value={state.role} onChange={(e) => go({ role: e.target.value })}>
            {ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
        <Field label="Cần chú ý">
          <select value={state.attention} onChange={(e) => go({ attention: e.target.value })}>
            {ATTENTION_OPTIONS.map((o) => <option key={o.value} value={o.value} disabled={Boolean(o.needsCourses)}>
              {o.label}{o.needsCourses ? ' (chưa có)' : ''}</option>)}
          </select>
        </Field>
        <Field label="Lượt chấm còn" hint={COURSES_PENDING_TEXT}>
          <select disabled value="">{CREDITS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        </Field>
      </form>

      <StatusBanner banner={banner} />
      {csvErrors.length ? (
        <details className="la-import-errors"><summary>{csvErrors.length} dòng CSV chưa import được</summary>
          <ol>{csvErrors.map((e, i) => <li key={`${i}-${e}`}>{e}</li>)}</ol></details>
      ) : null}
      {data?.sources_failed?.length ? (
        <p className="la-warning" role="status">
          Chưa đọc được: {data.sources_failed.join(', ')}. Ô liên quan ghi “chưa có” hoặc “không đọc được”, không phải trống.
        </p>
      ) : null}
      {data?.undecided?.length ? (
        <p className="la-note" role="status">
          {data.undecided.length} người chưa xác định được có trễ hay không nên chưa có trong kết quả lọc này.
        </p>
      ) : null}

      {chosen.length ? (
        <div className="la-bulk" role="toolbar" aria-label="Thao tác với người đã chọn">
          <strong>Đã chọn {chosen.length} người</strong>
          <select aria-label="Lớp cần gán" value={bulkCohort} disabled={!cohorts || busy} onChange={(e) => setBulkCohort(e.target.value)}>
            <option value="">Gán vào lớp…</option>
            {(cohorts ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button className="adm-btn-primary adm-btn-sm" type="button" disabled={!bulkCohort || busy} onClick={() => void assign()}>Gán</button>
          <button className="adm-btn-secondary adm-btn-sm" type="button" disabled={busy} onClick={remind}>Gửi nhắc đăng ký lại…</button>
          <button className="adm-btn-secondary adm-btn-sm" type="button" disabled title={COURSES_PENDING_TEXT}>Gia hạn quyền luyện lại…</button>
          <button className="adm-btn-secondary adm-btn-sm" type="button" disabled={busy} onClick={() => saveCsv(directoryCsv(chosen))}>Xuất danh sách (CSV)</button>
          <button className="adm-btn-secondary adm-btn-sm" type="button" disabled={busy} onClick={() => setSelected(new Map())}>Bỏ chọn</button>
          <small>Thu hồi quyền, gỡ khỏi lớp, khoá tài khoản: làm trong Vùng nguy hiểm của từng hồ sơ.</small>
        </div>
      ) : null}

      <div className="la-result">
        <strong>{data ? `${data.total.toLocaleString('vi-VN')} người · sắp theo tên` : loading ? 'Đang tải…' : ''}</strong>
        {state.role === 'user,student' ? <span>Mặc định ẩn tài khoản giáo viên và quản trị; đổi ở bộ lọc Vai trò.</span> : null}
      </div>

      {loadError ? (
        <div className="la-warning" role="alert">
          Chưa tải được danh bạ: {loadError}{' '}
          <button className="adm-btn-secondary adm-btn-sm" type="button" onClick={() => void load(current.current)}>Tải lại</button>
        </div>
      ) : null}
      {!data && loading && !loadError ? <p className="la-empty" role="status">Đang tải danh bạ…</p> : null}
      {data && !items.length ? (
        filtered
          ? <p className="la-empty">Không có ai khớp bộ lọc. Bộ lọc vẫn giữ nguyên ở trên để thấy vì sao.</p>
          : <p className="la-empty">Danh bạ chưa có ai. <button className="adm-btn-primary adm-btn-sm" type="button" onClick={() => setDraft(studentDraft() as Draft)}>Tạo học viên đầu tiên</button></p>
      ) : null}

      {items.length ? (
        <div className="la-table-scroll">
          <table className="la-table">
            <thead>
              <tr>
                <th scope="col"><input type="checkbox" aria-label="Chọn tất cả trên trang" checked={allChecked} onChange={toggleAll} /></th>
                <th scope="col">Học viên ↑</th>
                <th scope="col">Dạng</th>
                <th scope="col">Khoá và hạn</th>
                <th scope="col">Lớp</th>
                <th scope="col">Lượt chấm còn</th>
                <th scope="col">Hoạt động gần nhất</th>
                <th scope="col">Cần chú ý</th>
                <th scope="col"><span className="sr-only">Xem nhanh</span></th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.ref}>
                  <td><input type="checkbox" aria-label={`Chọn ${row.name}`} checked={selected.has(row.ref)} onChange={() => toggle(row)} /></td>
                  <td>
                    <a className="la-name" href={profileHref(row.ref)}>{row.name}</a>
                    <div className="la-sub">{[row.email, row.student_code].filter(Boolean).join(' · ')}</div>
                    {row.account_state === 'locked' ? <span className="la-chip">Đã khoá</span> : null}
                    {row.profile_state === 'archived' ? <span className="la-chip">Lưu trữ</span> : null}
                  </td>
                  <td>{kindText(row)}</td>
                  <td>{coursesText(row)}</td>
                  <td>{cohortsText(row)}</td>
                  <td>{creditsText(row)}</td>
                  <td>{lastActiveText(row.last_active_at)}</td>
                  <td className={row.attention?.length ? 'is-attention' : undefined}>{attentionText(row)}</td>
                  <td>
                    <button className="adm-btn-secondary adm-btn-sm" type="button" aria-label={`Xem nhanh ${row.name}`}
                      onClick={() => void openQuick(row)}>Xem nhanh</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {data && pages > 1 ? (
        <nav className="la-pager" aria-label="Trang">
          <button className="adm-btn-secondary adm-btn-sm" type="button" disabled={state.page <= 1} onClick={() => go({ page: state.page - 1 })}>‹ Trước</button>
          <span>Trang {state.page} trên {pages}</span>
          <button className="adm-btn-secondary adm-btn-sm" type="button" disabled={state.page >= pages} onClick={() => go({ page: state.page + 1 })}>Sau ›</button>
        </nav>
      ) : null}

      <Dialog
        open={Boolean(quick)}
        title={quick ? `Xem nhanh · ${quick.row.name}` : 'Xem nhanh'}
        panelClassName="la-drawer"
        backdropClassName="la-drawer-backdrop"
        onClose={() => setQuick(null)}
        actions={quick ? (
          <>
            <a className="adm-btn-primary" href={profileHref(quick.row.ref)}>Mở hồ sơ</a>
            <a className="adm-btn-secondary" href={notifyHref([quick.row])}
              onClick={() => { try { window.sessionStorage.setItem(NOTIFY_HANDOFF_KEY, notifyHandoff([quick.row])); } catch { /* convenience */ } }}>Gửi nhắc</a>
            {quick.row.student_id && quick.row.cohorts?.length ? (
              <a className="adm-btn-secondary" href={assignmentHref({}, { studentId: quick.row.student_id })}>Giao bài…</a>
            ) : null}
          </>
        ) : null}
      >
        {quick?.error ? <p className="la-warning" role="alert">Chưa tải được tóm tắt: {quick.error}</p> : null}
        {quick && !quick.summary && !quick.error ? <p className="la-empty" role="status">Đang tải…</p> : null}
        {quick?.summary ? <LearnerSummary summary={quick.summary} sourcesFailed={quick.failed} /> : null}
      </Dialog>

      <Dialog
        open={Boolean(draft)}
        title="Thêm học viên"
        description="Các trường tuỳ chọn có thể để trống."
        busy={busy}
        onClose={() => setDraft(null)}
        actions={<>
          <button className="adm-btn-secondary" type="button" disabled={busy} onClick={() => setDraft(null)}>Huỷ</button>
          <button className="adm-btn-primary" type="submit" form="la-student-form" disabled={busy}>{busy ? 'Đang lưu…' : 'Tạo học viên'}</button>
        </>}
      >
        <form id="la-student-form" className="acd-form" onSubmit={submitDraft}>
          <Field label="Mã học viên"><input required maxLength={64} value={draft?.studentCode || ''}
            onChange={(e) => draft && setDraft({ ...draft, studentCode: e.target.value, error: '' })} /></Field>
          <Field label="Họ tên"><input required maxLength={255} value={draft?.fullName || ''}
            onChange={(e) => draft && setDraft({ ...draft, fullName: e.target.value, error: '' })} /></Field>
          {draft?.error ? <div className="acd-inline-error" role="alert">{draft.error}</div> : null}
        </form>
      </Dialog>
    </main>
  );
}

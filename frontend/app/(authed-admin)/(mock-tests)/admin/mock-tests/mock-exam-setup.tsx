'use client';

// MOCKORG-0086 FR-141…FR-144 (G09-T32): "Tổ chức kỳ thi", three steps and a
// review. Every write goes to the API and the page then reads it back; the
// form keeps unsaved edits on screen when a save fails.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button, Dialog, Notice, PageState, TextField } from '@/components/ui';
import { messageOf } from '@/components/admin-directory-ui';
import { getBrowserJsonAt, patchBrowserJsonAt, postBrowserJsonAt } from '@/lib/browser-api';
import {
  MODE_LABELS,
  SETUP_STEPS,
  SKILLS,
  SKILL_NAMES,
  audienceNote,
  audienceSummary,
  buildCreateBody,
  buildPatchBody,
  formFromExam,
  missingCopy,
  LISTENING_BUFFER_SECONDS,
  modeLine,
  newExamCode,
  normalizeAudience,
  normalizeOrgExamList,
  notReadyMissing,
  scheduleMissing,
  setupStep,
  toggleSkill,
  vnDateTime,
  vnLocalToIso,
} from '@/lib/mock-exam-org-model.mjs';
import type { components } from '@/types/api';
import type { ApiPostJson } from '@/lib/openapi-contract';

import styles from './mock-exam-org.module.css';

type OrgExam = import('@/lib/mock-exam-org-model.mjs').OrgExam;
type Form = import('@/lib/mock-exam-org-model.mjs').SetupForm;
type Audience = import('@/lib/mock-exam-org-model.mjs').Audience;
// The server supplies the default for refresh_cohorts when it is omitted.
type AudiencePatch = Partial<components['schemas']['AudiencePatch']>;
type StepId = import('@/lib/mock-exam-org-model.mjs').SetupStepId;
type ApiError = Error & { status?: number; code?: string | null; detail?: unknown };
type PickerKind = 'listening' | 'reading' | 'writing-task1' | 'writing-task2';
type PickerRow = { id: string; title?: string; test_id?: string; task_type?: string; full_audio_duration_seconds?: number | null };
type Cohort = { id: string; name: string; is_active?: boolean };
type Student = { id: string; full_name: string; student_code?: string; user_id?: string | null };

const STEP_NOTE: Record<StepId, string> = { papers: 'Kỹ năng và đề', audience: 'Ai thi', mode: 'Ngày giờ', review: 'Lên lịch' };
const EXAMS_PATH = '/admin/mock-exams';
const AUDIENCE_PATH = '/admin/mock-exams/{exam_id}/audience';
const SCHEDULE_FIELDS = [
  'skills', 'exam_mode', 'listening_test_id', 'reading_test_id', 'writing_task1_prompt_id',
  'writing_task2_prompt_id', 'starts_at', 'open_from', 'open_until',
];

function stepHref(examId: string | null, step: StepId) {
  return examId ? `/admin/mock-tests/${encodeURIComponent(examId)}/setup?step=${step}` : `/admin/mock-tests/new?step=${step}`;
}

function hhmm(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function PaperPicker({ kind, label, value, onChange }: { kind: PickerKind; label: string; value: string; onChange: (value: string, row: PickerRow | null) => void }) {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<PickerRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ kind, q: query.trim(), limit: '25', offset: '0' });
        const page = await window.api.get<{ items?: PickerRow[] }>(`/admin/mock-exams/picker?${params}`);
        if (dead) return;
        if (!page || !Array.isArray(page.items)) throw new Error('Kho đề trả về dữ liệu sai định dạng.');
        setRows(page.items.filter((row) => row && typeof row.id === 'string'));
        setError(null);
      } catch (caught) {
        if (!dead) setError(messageOf(caught));
      }
    }, query ? 250 : 0);
    return () => { dead = true; window.clearTimeout(timer); };
  }, [kind, query]);
  const known = rows.some((row) => row.id === value);
  return (
    <div className={styles.row}>
      <label className={styles.field}><span>Tìm đề {label}</span>
        <input type="search" value={query} maxLength={100} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <label className={styles.field}><span>Đề {label} · chỉ hiện đề đã đăng</span>
        <select value={value} onChange={(event) => onChange(event.target.value, rows.find((row) => row.id === event.target.value) || null)}>
          <option value="">Chưa chọn</option>
          {value && !known && <option value={value}>Đề đã chọn</option>}
          {rows.map((row) => <option key={row.id} value={row.id}>{row.title || 'Đề chưa có tên'}{row.task_type ? ` · ${row.task_type}` : ''}</option>)}
        </select>
      </label>
      {error && <span className={styles.help} role="alert">Không tải được kho đề: {error}</span>}
    </div>
  );
}

export function MockExamSetup({ examId: initialId }: { examId: string | null }) {
  const examId = useRef(initialId);
  const [exam, setExam] = useState<OrgExam | null>(null);
  const [form, setForm] = useState<Form>(() => formFromExam(null));
  const [audience, setAudience] = useState<Audience | null>(null);
  // Audio length of a Listening paper picked but not saved yet (FR-143 N).
  const [pickedAudio, setPickedAudio] = useState<{ id: string; seconds: number } | null>(null);
  const [step, setStep] = useState<StepId>(() => (typeof window === 'undefined' ? 'papers' : setupStep(new URL(window.location.href).searchParams.get('step')) as StepId));
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'missing' | 'not-draft' | 'error'>(initialId ? 'loading' : 'ready');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false);
  // The last audience read failed: the list on screen (if any) is not current
  // and must never be taken for an empty one (CR #2640).
  const [audienceError, setAudienceError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const saveInProgress = useRef(false);
  const [saveError, setSaveError] = useState<{ at: string; message: string } | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [serverMissing, setServerMissing] = useState<string[] | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [dialog, setDialog] = useState<'cohorts' | 'students' | null>(null);
  const request = useRef(0);

  const readExam = useCallback(async (id: string) => {
    const list = normalizeOrgExamList(await window.api.get<unknown>('/admin/mock-exams'));
    if (!list) throw new Error('Danh sách kỳ thi sai định dạng.');
    return list.rows.find((row) => row.id === id) || null;
  }, []);

  /** The stored list, or null when it could not be read (never an empty stand-in). */
  const readAudience = useCallback(async (id: string): Promise<Audience | null> => {
    try {
      const response = await getBrowserJsonAt(AUDIENCE_PATH, `/admin/mock-exams/${encodeURIComponent(id)}/audience`);
      const value = normalizeAudience(response);
      if (!value) throw new Error('Danh sách người thi sai định dạng.');
      setAudience(value);
      setAudienceError(null);
      setDisabled(false);
      return value;
    } catch (caught) {
      const error = caught as ApiError;
      if (error.code === 'audiences_disabled') setDisabled(true);
      else setAudienceError(messageOf(caught));
      return null;
    }
  }, []);

  const reload = useCallback(async (id: string, resetForm: boolean) => {
    const mine = ++request.current;
    try {
      const found = await readExam(id);
      if (mine !== request.current) return;
      if (!found) { setLoadState('missing'); return; }
      if (found.status !== 'draft') { setExam(found); setLoadState('not-draft'); return; }
      setExam(found);
      if (resetForm) setForm(formFromExam(found));
      setLoadState('ready');
      await readAudience(id);
    } catch (caught) {
      if (mine === request.current) { setLoadError(messageOf(caught)); setLoadState('error'); }
    }
  }, [readAudience, readExam]);

  useEffect(() => {
    if (initialId) void reload(initialId, true);
    return () => { request.current += 1; };
  }, [initialId, reload]);

  const goTo = (next: StepId, targetId = examId.current) => {
    setStep(next);
    window.history.replaceState(window.history.state, '', stepHref(targetId, next));
  };

  /** Return the stored exam ID, including when nothing needs to be written. */
  const saveExam = async (nextStep: StepId): Promise<string | null> => {
    setActionError(null);
    const at = hhmm(new Date());
    if (!examId.current) {
      const built = buildCreateBody(form, newExamCode(), nextStep);
      if (!built.ok) { setSaveError({ at, message: built.error }); return null; }
      try {
        let created: ApiPostJson<typeof EXAMS_PATH>;
        try {
          created = await postBrowserJsonAt(EXAMS_PATH, EXAMS_PATH, built.value);
        } catch (caught) {
          // A code collision is the only 409 of create: one retry with a new code.
          if ((caught as ApiError).status !== 409) throw caught;
          created = await postBrowserJsonAt(EXAMS_PATH, EXAMS_PATH, { ...built.value, code: newExamCode() });
        }
        if (!created?.id) throw new Error('Máy chủ không trả mã kỳ thi vừa tạo.');
        examId.current = created.id;
        window.history.replaceState(window.history.state, '', stepHref(created.id, nextStep));
        await reload(created.id, true);
        setSaveError(null);
        setSavedAt(at);
        return created.id;
      } catch (caught) {
        setSaveError({ at, message: messageOf(caught) });
        return null;
      }
    }
    if (!exam) return null;
    const built = buildPatchBody(form, exam, nextStep);
    if (!built.ok) { setSaveError({ at, message: built.error }); return null; }
    const windowChanged = form.mode === 'self_paced' && ('open_from' in built.value || 'open_until' in built.value);
    if (!Object.keys(built.value).length) { setSaveError(null); return exam.id; }
    try {
      // Self-paced windows live on each person's row: read the list first and
      // refuse to change the window while it cannot be read (CR #2640).
      let rows = 0;
      if (windowChanged) {
        const current = disabled ? { items: [] } : await readAudience(exam.id);
        if (!current) {
          setSaveError({ at, message: 'Chưa đọc được danh sách người thi nên chưa đổi khoảng mở. Thử lại khi danh sách tải được' });
          return null;
        }
        rows = current.items.length;
      }
      await patchBrowserJsonAt('/admin/mock-exams/{exam_id}', `/admin/mock-exams/${encodeURIComponent(exam.id)}`, built.value);
      const windowError = windowChanged && rows ? await pushWindow(exam.id, form) : null;
      await reload(exam.id, true);
      if (windowError) {
        setSaveError({ at, message: `Đã lưu kỳ thi nhưng chưa cập nhật khoảng mở cho danh sách người thi (${windowError}). Bấm Lưu lại hoặc Lên lịch để gửi lại` });
        return null;
      }
      if (SCHEDULE_FIELDS.some((field) => field in built.value)) setServerMissing(null);
      setSaveError(null);
      setSavedAt(at);
      return exam.id;
    } catch (caught) {
      setSaveError({ at, message: messageOf(caught) });
      return null;
    }
  };

  const save = async (nextStep: StepId): Promise<string | null> => {
    if (saveInProgress.current) return null;
    saveInProgress.current = true;
    setSaving(true);
    try {
      return await saveExam(nextStep);
    } finally {
      saveInProgress.current = false;
      setSaving(false);
    }
  };

  const changeStep = async (next: StepId) => {
    if (next === step || saveInProgress.current) return;
    // Auto-save on every step change; a failed save keeps the edits on the page.
    const savedId = form.title.trim() ? await save(next) : null;
    goTo(next, savedId ?? examId.current);
  };

  const patchAudience = async (body: AudiencePatch) => {
    if (!exam) return;
    setActionError(null);
    try {
      const response = await patchBrowserJsonAt(AUDIENCE_PATH, `/admin/mock-exams/${encodeURIComponent(exam.id)}/audience`, body);
      const value = normalizeAudience(response);
      if (value?.mirrorFailed) setActionError('Đã lưu danh sách nhưng chưa ghi được lượt giao. Bấm lại thao tác vừa rồi để thử lại.');
      else if (value) setServerMissing(null);
    } catch (caught) {
      setActionError(messageOf(caught));
    }
    // Read the stored list back whatever happened (no optimistic rows).
    await readAudience(exam.id);
  };

  const schedule = async () => {
    if (!exam) return;
    if (!(await save('review'))) return;
    setScheduling(true);
    setServerMissing(null);
    setActionError(null);
    try {
      // Every selected row must carry the window the schedule checks; re-send it
      // (idempotent) so a refresh-added row or an earlier failed window PATCH
      // cannot leave the page "ready" while the server answers 422 (CR #2640).
      if (form.mode === 'self_paced' && !disabled) {
        const windowError = await pushWindow(exam.id, form);
        if (windowError) {
          setActionError(`Chưa cập nhật được khoảng mở cho danh sách người thi: ${windowError}. Chưa lên lịch.`);
          await readAudience(exam.id);
          return;
        }
      }
      await postBrowserJsonAt('/admin/mock-exams/{exam_id}/schedule', `/admin/mock-exams/${encodeURIComponent(exam.id)}/schedule`);
      window.location.assign('/admin/mock-tests');
    } catch (caught) {
      const missing = notReadyMissing(caught);
      if (missing) setServerMissing(missing);
      else setActionError(messageOf(caught));
      await reload(exam.id, false);
    } finally {
      setScheduling(false);
    }
  };

  const missing = useMemo(() => serverMissing || scheduleMissing(exam, audience), [audience, exam, serverMissing]);
  const summary = useMemo(() => audienceSummary(audience?.items || []), [audience]);
  const dirty = !exam || (() => { const built = buildPatchBody(form, exam, null); return !built.ok || Object.keys(built.value).length > 0; })();
  const visibleSavedAt = saveError ? null : savedAt;

  if (loadState === 'loading') return <main className={styles.page}><PageState kind="loading" title="Đang mở kỳ thi…" /></main>;
  if (loadState === 'error') return <main className={styles.page}><PageState kind="error" title="Chưa mở được kỳ thi" body={loadError} action={<Button variant="secondary" onClick={() => examId.current && void reload(examId.current, true)}>Thử lại</Button>} /></main>;
  if (loadState === 'missing') return <main className={styles.page}><PageState kind="error" title="Không tìm thấy kỳ thi" body="Kỳ thi này không còn trong danh sách." action={<Button href="/admin/mock-tests">Về danh sách kỳ thi</Button>} /></main>;
  if (loadState === 'not-draft') return <main className={styles.page}><PageState kind="locked" title="Kỳ thi đã lên lịch" body="Trang này chỉ soạn kỳ thi ở Nháp. Kỳ thi đã lên lịch được theo dõi ở trang kỳ thi." action={<Button href={`/admin/mock-tests?view=console&tab=live&exam_id=${encodeURIComponent(exam?.id || '')}`}>Mở kỳ thi</Button>} /></main>;

  const skillsOn = form.skills;
  // The Listening seat clock: the saved paper's from the server, a newly picked
  // one's audio + 2 minutes, else the server's default (30 + 2).
  const listeningSeconds = form.listeningTestId && form.listeningTestId === exam?.listeningTestId
    ? exam.listeningSeconds
    : pickedAudio && pickedAudio.id === form.listeningTestId ? pickedAudio.seconds + LISTENING_BUFFER_SECONDS : null;
  const line = modeLine(form, exam, listeningSeconds);
  const examSkills = exam?.skills || skillsOn;

  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <div>
          <h1>Tổ chức kỳ thi{form.title.trim() ? ` · ${form.title.trim()}` : ''}</h1>
          <p>Nháp{visibleSavedAt ? ` · đã lưu lúc ${visibleSavedAt}` : exam ? '' : ' · chưa lưu'}</p>
        </div>
        <div className={styles.actions}>
          <Button variant="secondary" href="/admin/mock-tests">Về danh sách</Button>
          <Button variant="secondary" loading={saving} loadingLabel="Đang lưu…" onClick={() => void save(step)}>Lưu nháp</Button>
        </div>
      </header>

      {saveError && (
        <Notice kind="warning" title="Lưu nháp không thành công" action={<Button size="sm" variant="secondary" disabled={saving} onClick={() => void save(step)}>Lưu lại</Button>}>
          Chưa lưu được nháp lúc {saveError.at}: {saveError.message.replace(/[.\s]+$/, '')}. Thay đổi vẫn còn trên trang này; đừng đóng tab.
        </Notice>
      )}
      {disabled && <Notice kind="warning" title="Danh sách người thi chưa bật">Hệ thống này chưa bật danh sách người thi mới (cờ mock_exam_audiences), nên chưa thêm người thi hay lên lịch được ở đây.</Notice>}
      {actionError && <Notice kind="error">{actionError}</Notice>}

      <nav aria-label="Các bước tổ chức kỳ thi">
        <ol className={styles.steps}>
          {SETUP_STEPS.map((s, i) => (
            <li key={s.id}>
              <button type="button" className={styles.stepButton} aria-current={step === s.id ? 'step' : undefined} disabled={saving} onClick={() => void changeStep(s.id)}>
                <strong>{i + 1} · {s.label}</strong>
                <small>{STEP_NOTE[s.id]}</small>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      {step === 'papers' && (
        <section className={styles.section} aria-labelledby="mts-papers">
          <h2 id="mts-papers">Đề</h2>
          <TextField label="Tên kỳ thi" value={form.title} maxLength={200} onChange={(value) => setForm({ ...form, title: value })} />
          <div>
            <p className={styles.help}>Kỹ năng dự thi · mặc định đủ bốn; bỏ bớt được, cần ít nhất một</p>
            <div className={styles.skills} role="group" aria-label="Kỹ năng dự thi">
              {SKILLS.map((skill) => (
                <button key={skill} type="button" className={styles.skill} aria-pressed={skillsOn.includes(skill)} onClick={() => setForm({ ...form, skills: toggleSkill(skillsOn, skill) })}>
                  {SKILL_NAMES[skill]}
                </button>
              ))}
            </div>
          </div>
          {!skillsOn.length && <Notice kind="warning">Chưa chọn kỹ năng nào. Chọn ít nhất một kỹ năng để chọn đề.</Notice>}
          {skillsOn.includes('listening') && <PaperPicker kind="listening" label="Listening" value={form.listeningTestId} onChange={(value, row) => { setForm({ ...form, listeningTestId: value }); setPickedAudio(row?.full_audio_duration_seconds ? { id: value, seconds: row.full_audio_duration_seconds } : null); }} />}
          {skillsOn.includes('reading') && <PaperPicker kind="reading" label="Reading" value={form.readingTestId} onChange={(value) => setForm({ ...form, readingTestId: value })} />}
          {skillsOn.includes('writing') && <PaperPicker kind="writing-task1" label="Writing Task 1" value={form.writingTask1PromptId} onChange={(value) => setForm({ ...form, writingTask1PromptId: value })} />}
          {skillsOn.includes('writing') && <PaperPicker kind="writing-task2" label="Writing Task 2" value={form.writingTask2PromptId} onChange={(value) => setForm({ ...form, writingTask2PromptId: value })} />}
          {skillsOn.includes('speaking') && (
            <p className={styles.help}>
              Speaking: {exam?.hasSpeakingPaper ? 'đã có đề Speaking.' : 'chưa chọn được đề Speaking ở trang này. Bỏ Speaking khỏi kỹ năng dự thi để lên lịch, hoặc chờ phần chọn đề Speaking.'}
            </p>
          )}
          <p className={styles.help}>Thứ tự làm bài cố định: Listening → Reading → Writing, Speaking ghi âm sau cùng; kỹ năng không dự thi thì bỏ qua. Đề Listening chỉ lên lịch được khi audio đủ mọi đoạn.</p>
        </section>
      )}

      {step === 'audience' && (
        <section className={styles.section} aria-labelledby="mts-audience">
          <h2 id="mts-audience">Người thi</h2>
          {!exam ? (
            <PageState kind="empty" title="Lưu nháp trước khi thêm người thi" body="Nhập tên kỳ thi ở bước Đề rồi bấm Lưu nháp." action={<Button disabled={saving} onClick={() => void save('audience')}>Lưu nháp</Button>} />
          ) : (
            <>
              <div className={styles.row}>
                <Button variant="secondary" disabled={disabled} onClick={() => setDialog('cohorts')}>+ Thêm lớp</Button>
                <Button variant="secondary" disabled={disabled} onClick={() => setDialog('students')}>+ Thêm học viên</Button>
                <Button variant="secondary" disabled>Dùng nhóm đã lưu</Button>
                {audience?.items.some((i) => i.sourceKind === 'cohort') && <Button variant="secondary" disabled={disabled} onClick={() => void patchAudience(audienceAddBody({ refresh_cohorts: true }, form))}>Cập nhật theo lớp</Button>}
              </div>
              <p className={styles.help}>Nhóm đã lưu chưa có trên hệ thống này. Ba nguồn cộng dồn vào một danh sách; học viên có trong hai nguồn chỉ hiện một dòng, cột Nguồn ghi nguồn đầu tiên.</p>
              {audienceError && <Notice kind="error" title="Chưa đọc được danh sách người thi" action={<Button size="sm" variant="secondary" onClick={() => exam && void readAudience(exam.id)}>Tải lại</Button>}>{audienceError}. Danh sách dưới đây có thể chưa mới; chưa đổi được khoảng mở cho tới khi tải lại được.</Notice>}
              {!audienceError && audience && audience.items.length === 0 && <PageState kind="empty" title="Chưa có người thi" body="Thêm lớp hoặc thêm học viên." />}
              {audience && audience.items.length > 0 && (
                <>
                  <p><strong>{summary.selected} người được chọn</strong> <span className={styles.help}>{summary.line}. Bỏ chọn để loại một người khỏi kỳ thi.</span></p>
                  <table className={styles.table}>
                    <thead><tr><th scope="col">Chọn</th><th scope="col">Học viên</th><th scope="col">Lớp / nguồn</th><th scope="col">Kỹ năng dự thi</th><th scope="col" className={styles.hideNarrow}>Ghi chú</th></tr></thead>
                    <tbody>
                      {audience.items.map((item) => (
                        <tr key={item.studentId}>
                          <td><input type="checkbox" aria-label={`Chọn ${item.name}`} checked={item.selected} disabled={!item.userId || disabled} onChange={(event) => void patchAudience({ set: [{ student_id: item.studentId, selected: event.target.checked }] })} /></td>
                          <td>{item.name}</td>
                          <td>{item.source}</td>
                          <td>
                            <div className={styles.skills} role="group" aria-label={`Kỹ năng của ${item.name}`}>
                              {examSkills.map((skill) => {
                                const on = item.skills.includes(skill);
                                const next = toggleSkill(item.skills, skill);
                                return <button key={skill} type="button" className={styles.skill} aria-pressed={on} disabled={disabled || (on && next.length === 0)} onClick={() => void patchAudience({ set: [{ student_id: item.studentId, skills: next }] })}>{SKILL_NAMES[skill]}</button>;
                              })}
                            </div>
                          </td>
                          <td className={styles.hideNarrow}>{audienceNote(item) || 'Không có'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className={styles.help}>Ô kỹ năng tô đậm là kỹ năng người đó dự thi; bấm để bỏ hoặc thêm cho riêng người đó. Kỹ năng bỏ ở bước Đề không hiện ở đây.</p>
                </>
              )}
            </>
          )}
        </section>
      )}

      {step === 'mode' && (
        <section className={styles.section} aria-labelledby="mts-mode">
          <h2 id="mts-mode">Cách thi</h2>
          <div className={styles.modes} role="radiogroup" aria-label="Cách thi">
            <label className={styles.mode}>
              <span><input type="radio" name="mts-mode" checked={form.mode === 'live'} onChange={() => setForm({ ...form, mode: 'live' })} /> <strong>{MODE_LABELS.live}</strong></span>
              <small>Mọi người thi cùng lúc, đồng hồ chung; giám thị mở từng phần và thu bài.</small>
            </label>
            <label className={styles.mode}>
              <span><input type="radio" name="mts-mode" checked={form.mode === 'self_paced'} onChange={() => setForm({ ...form, mode: 'self_paced' })} /> <strong>{MODE_LABELS.self_paced}</strong></span>
              <small>Mỗi người tự bắt đầu trong khoảng mở; đã bắt đầu thì làm liền các phần, không nghỉ giữa các phần.</small>
            </label>
          </div>
          {form.mode === 'live' ? (
            <>
              <label className={styles.field}><span>Ngày giờ bắt đầu (giờ Việt Nam)</span>
                <input type="datetime-local" value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} />
              </label>
              <p className={styles.help}>Giám thị bấm &quot;Bắt đầu phần&quot; để mở từng phần cho cả phòng và thu bài khi hết giờ. Người nộp sớm chờ tới khi phần sau được mở.</p>
              <label><input type="checkbox" checked={form.allowEarlyAdvance} onChange={(event) => setForm({ ...form, allowEarlyAdvance: event.target.checked })} /> Cho sang phần sau khi nộp sớm</label>
            </>
          ) : (
            <>
              <div className={styles.row}>
                <label className={styles.field}><span>Mở từ (giờ Việt Nam)</span>
                  <input type="datetime-local" value={form.openFrom} onChange={(event) => setForm({ ...form, openFrom: event.target.value })} />
                </label>
                <label className={styles.field}><span>Đến (giờ Việt Nam)</span>
                  <input type="datetime-local" value={form.openUntil} onChange={(event) => setForm({ ...form, openUntil: event.target.value })} />
                </label>
              </div>
              {line && <p><strong>{line}</strong></p>}
              <p className={styles.help}>Làm liền các phần, không nghỉ giữa các phần. Đã bấm bắt đầu thì các phần chạy liền nhau; phần đang làm dở tự nộp khi hết giờ phần hoặc khi khoảng mở kết thúc.</p>
            </>
          )}
          <p className={styles.help}>Mỗi phần làm một lần. Muốn cho một người làm lại thì dùng &quot;Cho thi bù…&quot; ở trang kỳ thi.</p>
          <p className={styles.help}>Chế độ trả kết quả: Giáo viên công bố. Thí sinh không thấy điểm tới khi giáo viên trả kết quả ở trang kỳ thi.</p>
        </section>
      )}

      {step === 'review' && (
        <section className={styles.section} aria-labelledby="mts-review">
          <h2 id="mts-review">Xem lại</h2>
          <dl className={styles.summary}>
            <div><dt>Kỳ thi</dt><dd>{form.title.trim() || 'Chưa có tên'}</dd><Button size="sm" variant="text" disabled={saving} onClick={() => void changeStep('papers')}>Sửa</Button></div>
            <div><dt>Kỹ năng và đề</dt><dd>{skillsOn.map((s) => SKILL_NAMES[s]).join(', ') || 'Chưa chọn'}</dd><Button size="sm" variant="text" disabled={saving} onClick={() => void changeStep('papers')}>Sửa</Button></div>
            <div><dt>Người thi</dt><dd>{audienceError ? 'Chưa đọc được danh sách' : audience ? `${summary.selected} người${summary.unselected ? ` · ${summary.unselected} người không chọn` : ''}` : 'Chưa có'}</dd><Button size="sm" variant="text" disabled={saving} onClick={() => void changeStep('audience')}>Sửa</Button></div>
            <div><dt>Cách thi</dt><dd>{MODE_LABELS[form.mode as keyof typeof MODE_LABELS]} · {form.mode === 'live' ? (vnDateTime(vnLocalToIso(form.startsAt)) || 'chưa có ngày giờ') : `${vnDateTime(vnLocalToIso(form.openFrom)) || 'chưa có giờ mở'} – ${vnDateTime(vnLocalToIso(form.openUntil)) || 'chưa có giờ đóng'}`}</dd><Button size="sm" variant="text" disabled={saving} onClick={() => void changeStep('mode')}>Sửa</Button></div>
            <div><dt>Trả kết quả</dt><dd>Giáo viên công bố</dd><span /></div>
          </dl>
          {dirty && <Notice kind="info">Còn thay đổi chưa lưu; bấm Lên lịch sẽ lưu trước.</Notice>}
          {missing.length > 0 && (
            <Notice kind="warning" title="Chưa lên lịch được">
              <ul className={styles.missing}>{missing.map((code) => <li key={code}>{missingCopy(code)}</li>)}</ul>
              Nháp vẫn được lưu.
            </Notice>
          )}
          <p className={styles.help}>Bấm xong, {summary.selected} người được chọn thấy kỳ thi trong mục Thi thử.</p>
          <div className={styles.actions}>
            <Button loading={scheduling} loadingLabel="Đang lên lịch…" disabled={saving || missing.length > 0 || disabled || !exam || Boolean(audienceError)} onClick={() => void schedule()}>Lên lịch</Button>
          </div>
        </section>
      )}

      <div className={styles.actions}>
        {step !== 'papers' && <Button variant="secondary" disabled={saving} onClick={() => void changeStep(SETUP_STEPS[SETUP_STEPS.findIndex((s) => s.id === step) - 1].id)}>Quay lại</Button>}
        {step !== 'review' && <Button disabled={saving} onClick={() => void changeStep(SETUP_STEPS[SETUP_STEPS.findIndex((s) => s.id === step) + 1].id)}>Tiếp tục</Button>}
        {visibleSavedAt && <span className={styles.saved}>Đã lưu lúc {visibleSavedAt}</span>}
      </div>

      {exam && <CohortDialog open={dialog === 'cohorts'} onClose={() => setDialog(null)} onAdd={async (ids) => { setDialog(null); await patchAudience(audienceAddBody({ add_cohort_ids: ids }, form)); }} />}
      {exam && <StudentDialog open={dialog === 'students'} onClose={() => setDialog(null)} present={new Set(audience?.items.map((i) => i.studentId))} onAdd={async (id) => { await patchAudience(audienceAddBody({ add_student_ids: [id] }, form)); }} />}
    </main>
  );
}

/** A self-paced add carries the window so new rows get it too (rows hold the window). */
function windowOf(form: Form) {
  const window: components['schemas']['AudienceWindow'] = {};
  const from = vnLocalToIso(form.openFrom);
  const until = vnLocalToIso(form.openUntil);
  if (from) window.open_from = from;
  if (until) window.open_until = until;
  return window;
}

/** Rows added on a self-paced exam carry its window, refresh included (CR #2640). */
function audienceAddBody(body: AudiencePatch, form: Form): AudiencePatch {
  if (form.mode !== 'self_paced') return body;
  const window = windowOf(form);
  return Object.keys(window).length ? { ...body, window } : body;
}

/** PATCH the window onto every audience row; the error text, or null when stored and mirrored. */
async function pushWindow(examId: string, form: Form): Promise<string | null> {
  const body = windowOf(form);
  if (!Object.keys(body).length) return null;
  try {
    const request: AudiencePatch = { window: body };
    const response = await patchBrowserJsonAt(AUDIENCE_PATH, `/admin/mock-exams/${encodeURIComponent(examId)}/audience`, request);
    const value = normalizeAudience(response);
    if (!value) return 'máy chủ trả danh sách sai định dạng';
    if (value.mirrorFailed) return 'đã lưu danh sách nhưng chưa ghi được lượt giao';
    return null;
  } catch (caught) {
    return messageOf(caught);
  }
}

function CohortDialog({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (ids: string[]) => Promise<void> }) {
  const [cohorts, setCohorts] = useState<Cohort[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => {
    if (!open) return;
    let dead = false;
    setPicked([]);
    void (async () => {
      try {
        const body = await window.api.get<{ cohorts?: Cohort[] }>('/admin/cohorts?is_active=true');
        if (!dead) setCohorts(Array.isArray(body?.cohorts) ? body.cohorts.filter((c) => c && typeof c.id === 'string') : []);
      } catch (caught) {
        if (!dead) setError(messageOf(caught));
      }
    })();
    return () => { dead = true; };
  }, [open]);
  return (
    <Dialog open={open} onClose={onClose} title="Thêm lớp · chọn được nhiều lớp" actions={<><Button disabled={!picked.length} onClick={() => void onAdd(picked)}>Thêm lớp đã chọn</Button><Button variant="secondary" onClick={onClose}>Đóng</Button></>}>
      {error ? <Notice kind="error">Chưa tải được danh sách lớp: {error}</Notice> : cohorts === null ? <p role="status">Đang tải lớp…</p> : cohorts.length === 0 ? <p>Chưa có lớp nào đang mở.</p> : (
        <ul className={styles.missing}>
          {cohorts.map((c) => (
            <li key={c.id}><label><input type="checkbox" checked={picked.includes(c.id)} onChange={(event) => setPicked(event.target.checked ? [...picked, c.id] : picked.filter((id) => id !== c.id))} /> {c.name}</label></li>
          ))}
        </ul>
      )}
      <p className={styles.help}>Thêm lớp chụp danh sách lúc thêm; học viên vào lớp sau đó được thêm bằng &quot;Cập nhật theo lớp&quot;.</p>
    </Dialog>
  );
}

function StudentDialog({ open, onClose, onAdd, present }: { open: boolean; onClose: () => void; onAdd: (id: string) => Promise<void>; present: Set<string> }) {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<Student[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open || query.trim().length < 2) { setRows([]); return undefined; }
    let dead = false;
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ search: query.trim(), limit: '20' });
        const body = await window.api.get<Student[]>(`/admin/students?${params}`);
        if (!dead) { setRows(Array.isArray(body) ? body.filter((s) => s && typeof s.id === 'string') : []); setError(null); }
      } catch (caught) {
        if (!dead) setError(messageOf(caught));
      }
    }, 250);
    return () => { dead = true; window.clearTimeout(timer); };
  }, [open, query]);
  return (
    <Dialog open={open} onClose={onClose} title="Thêm học viên · tìm theo tên hoặc mã học viên" actions={<Button variant="secondary" onClick={onClose}>Đóng</Button>}>
      <label className={styles.field}><span>Tìm học viên</span><input type="search" value={query} maxLength={128} onChange={(event) => setQuery(event.target.value)} /></label>
      {error && <Notice kind="error">Chưa tìm được: {error}</Notice>}
      <ul className={styles.missing}>
        {rows.map((s) => (
          <li key={s.id}>
            {s.full_name}{s.student_code ? ` · ${s.student_code}` : ''}{' '}
            {present.has(s.id) ? <span className={styles.help}>Đã có trong danh sách</span> : <Button size="sm" variant="secondary" onClick={() => void onAdd(s.id)}>Thêm</Button>}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

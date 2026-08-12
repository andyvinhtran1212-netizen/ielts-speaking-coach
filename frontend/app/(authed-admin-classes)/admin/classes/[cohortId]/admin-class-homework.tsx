'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import { Dialog, Field, messageOf, StatusBanner } from '@/components/admin-directory-ui';
import {
  assignmentSummary,
  dueParts,
  homeworkDraft,
  normalizeActionLog,
  normalizeAssignmentsPayload,
  normalizeCatalog,
  normalizeQuestions,
  selectAssignments,
  validateHomeworkDraft,
} from '@/lib/admin-class-homework-model.mjs';

import type { Banner, Member } from './admin-class-detail-types';
import type {
  ActionLogPayload,
  CatalogOption,
  ClassAssignment,
  DueDraft,
  HomeworkDraft,
  QuestionOption,
} from './admin-class-homework-types';

type ConfirmState = { kind: 'delete'; assignment: ClassAssignment } | null;
type BackfillState = { assignment: ClassAssignment; studentIds: string[]; error: string } | null;

const SKILL_LABEL = { speaking: 'Speaking', reading: 'Reading', listening: 'Listening', course: 'Bài tập theo buổi' };

function formatDue(value: string | null) {
  if (!value) return 'Không hạn';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Hạn không đọc được';
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short',
  }).format(date);
}

function formatLogWhen(value: string | null) {
  if (!value) return 'Không rõ lúc';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Không rõ lúc';
  return new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function statusOf(row: ClassAssignment, now = Date.now()) {
  if (row.status === 'archived') return { label: 'Đã đóng', tone: 'is-archived' };
  const due = row.due_at ? Date.parse(row.due_at) : Number.NaN;
  if (Number.isFinite(due) && due < now) return { label: 'Hết hạn', tone: 'is-archived' };
  if (Number.isFinite(due) && due <= now + 48 * 60 * 60 * 1000) return { label: 'Sắp đến hạn', tone: 'is-warning' };
  return { label: 'Đang mở', tone: 'is-active' };
}

function assignmentSub(row: ClassAssignment) {
  const config = row.content_config || {};
  const label = row.skill === 'speaking'
    ? [String(config.topic || ''), String(config.mode || ''), config.part ? `Part ${config.part}` : ''].filter(Boolean).join(' · ')
    : [SKILL_LABEL[row.skill], String(config.test_title || '')].filter(Boolean).join(' · ');
  return label || SKILL_LABEL[row.skill];
}

function errorDetail(caught: unknown) {
  return caught && typeof caught === 'object' ? (caught as { detail?: unknown }).detail : null;
}

function actionDetail(row: ActionLogPayload['actions'][number]) {
  const details = row.details || {};
  if (row.action === 'due_change') {
    const flips = details.flips && typeof details.flips === 'object' ? details.flips as Record<string, unknown> : {};
    const bits = [`${formatDue(typeof details.previous_due_at === 'string' ? details.previous_due_at : null)} → ${formatDue(typeof details.due_at === 'string' ? details.due_at : null)}`];
    if (Number(flips.to_ontime || 0)) bits.push(`${Number(flips.to_ontime)} lượt trễ thành đúng hạn`);
    if (Number(flips.to_late || 0)) bits.push(`${Number(flips.to_late)} lượt đúng hạn thành trễ`);
    return bits.join(' · ');
  }
  if (row.action === 'return_work') {
    const restored = Number(details.draft_restored || 0);
    return `${restored ? `${restored} câu được đưa lại vào ô nhập` : 'Không khôi phục được câu nào'}${details.score_cleared ? ' · điểm của mục đã xoá' : ''}`;
  }
  return '';
}

export function AdminClassHomework({ cohortId, members, refreshKey, onMutation }: {
  cohortId: string;
  members: Member[];
  refreshKey: number;
  onMutation: () => void;
}) {
  const [assignments, setAssignments] = useState<ClassAssignment[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reconcileFailed, setReconcileFailed] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<HomeworkDraft | null>(null);
  const [catalog, setCatalog] = useState<CatalogOption[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [questions, setQuestions] = useState<QuestionOption[]>([]);
  const [questionsPerGive, setQuestionsPerGive] = useState(1);
  const [questionsLoading, setQuestionsLoading] = useState(false);
  const [dueEditor, setDueEditor] = useState<DueDraft | null>(null);
  const [backfill, setBackfill] = useState<BackfillState>(null);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [actionLog, setActionLog] = useState<ActionLogPayload | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState('');
  const listSequence = useRef(0);
  const catalogSequence = useRef(0);
  const questionSequence = useRef(0);
  const logSequence = useRef(0);
  const previewAudio = useRef<HTMLAudioElement | null>(null);
  const [previewingQuestion, setPreviewingQuestion] = useState<string | null>(null);

  const loadAssignments = useCallback(async (silent = false) => {
    const requestId = ++listSequence.current;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const value = await window.api.get<unknown>(`/admin/cohorts/${encodeURIComponent(cohortId)}/assignments`);
      if (requestId !== listSequence.current) return false;
      const normalized = normalizeAssignmentsPayload(value) as { assignments: ClassAssignment[]; reconcile_failed: boolean } | null;
      if (!normalized) throw new Error('Dữ liệu bài giao không đúng định dạng.');
      setAssignments(normalized.assignments);
      setReconcileFailed(normalized.reconcile_failed);
      setLoading(false);
      return true;
    } catch (caught) {
      if (requestId !== listSequence.current) return false;
      setError(messageOf(caught));
      setLoading(false);
      return false;
    }
  }, [cohortId]);

  useEffect(() => {
    setAssignments(null); setError(null); setReconcileFailed(false); setBanner(null); setLoading(false);
    setSearch(''); setStatus('all'); setEditor(null); setDueEditor(null); setBackfill(null); setConfirm(null);
    setActionLog(null); setLogOpen(false); setLogError('');
  }, [cohortId]);

  useEffect(() => {
    void loadAssignments();
    return () => { listSequence.current += 1; };
  }, [cohortId, refreshKey, loadAssignments]);

  useEffect(() => () => {
    catalogSequence.current += 1; questionSequence.current += 1; logSequence.current += 1;
    previewAudio.current?.pause(); previewAudio.current = null;
  }, [cohortId]);

  const loadCatalog = useCallback(async (draft: HomeworkDraft) => {
    const requestId = ++catalogSequence.current;
    setCatalog([]); setCatalogError(''); setCatalogLoading(true);
    let path = '';
    let kind = '';
    if (draft.kind === 'lesson') {
      path = `/admin/cohorts/${encodeURIComponent(cohortId)}/speaking-lesson-sets`; kind = 'lesson';
    } else if (draft.skill === 'speaking') {
      path = `/admin/cohorts/${encodeURIComponent(cohortId)}/speaking-topics?part=${draft.part}`; kind = 'speaking';
    } else if (draft.skill === 'course') {
      path = `/admin/cohorts/${encodeURIComponent(cohortId)}/course-banks`; kind = 'course';
    } else {
      path = `/admin/exam-content?kind=${draft.skill}`; kind = 'exam';
    }
    try {
      const value = await window.api.get<unknown>(path);
      if (requestId !== catalogSequence.current) return;
      const normalized = normalizeCatalog(value, kind, draft.skill) as CatalogOption[] | null;
      if (!normalized) throw new Error('Dữ liệu kho nội dung không đúng định dạng.');
      setCatalog(normalized);
    } catch (caught) {
      if (requestId !== catalogSequence.current) return;
      setCatalogError(messageOf(caught));
    } finally {
      if (requestId === catalogSequence.current) setCatalogLoading(false);
    }
  }, [cohortId]);

  useEffect(() => {
    if (!editor) return;
    setQuestions([]); setQuestionsPerGive(1);
    void loadCatalog(editor);
  }, [editor?.kind, editor?.skill, editor?.part, Boolean(editor), loadCatalog]);

  const loadQuestions = useCallback(async (draft: HomeworkDraft) => {
    if (!draft.contentId) { setQuestions([]); return; }
    const requestId = ++questionSequence.current;
    setQuestions([]); setQuestionsLoading(true);
    const path = draft.kind === 'lesson'
      ? `/admin/cohorts/${encodeURIComponent(cohortId)}/speaking-lesson-sets/${encodeURIComponent(draft.contentId)}/questions`
      : `/admin/cohorts/${encodeURIComponent(cohortId)}/speaking-topics/${encodeURIComponent(draft.contentId)}/questions?part=${draft.part}`;
    try {
      const normalized = normalizeQuestions(await window.api.get<unknown>(path)) as { items: QuestionOption[]; questions_per_give: number } | null;
      if (requestId !== questionSequence.current) return;
      if (!normalized) throw new Error('Dữ liệu câu hỏi không đúng định dạng.');
      setQuestions(normalized.items);
      setQuestionsPerGive(normalized.questions_per_give);
    } catch (caught) {
      if (requestId === questionSequence.current) setEditor((current) => current ? { ...current, error: messageOf(caught) } : current);
    } finally {
      if (requestId === questionSequence.current) setQuestionsLoading(false);
    }
  }, [cohortId]);

  useEffect(() => {
    if (!editor || editor.questionMode !== 'manual' || !editor.contentId || (editor.skill !== 'speaking' && editor.kind !== 'lesson')) return;
    void loadQuestions(editor);
  }, [editor?.questionMode, editor?.contentId, editor?.kind, editor?.skill, editor?.part, loadQuestions]);

  useEffect(() => {
    previewAudio.current?.pause();
    previewAudio.current = null;
    setPreviewingQuestion(null);
  }, [editor?.questionMode, editor?.contentId, editor?.kind, editor?.skill, editor?.part]);

  const summary = useMemo(() => assignmentSummary(assignments || []), [assignments]);
  const visible = useMemo(() => selectAssignments(assignments || [], { search, status }) as ClassAssignment[], [assignments, search, status]);

  const canonicalMutation = async (success: string) => {
    const canonical = await loadAssignments(true);
    onMutation();
    setBanner(canonical ? { kind: 'success', text: success } : { kind: 'error', text: `${success} Chưa đọc lại được danh sách chuẩn.` });
    return canonical;
  };

  const submitHomework = async (event: FormEvent) => {
    event.preventDefault();
    if (!editor || busy) return;
    const validation = validateHomeworkDraft(editor, catalog, questions, questionsPerGive) as { ok: boolean; error?: string; body?: Record<string, unknown> };
    if (!validation.ok || !validation.body) { setEditor({ ...editor, error: validation.error || 'Bài giao không hợp lệ.' }); return; }
    setBusy(true);
    try {
      const result = await window.api.post<{ student_count?: number; unactivated_count?: number }>(`/admin/cohorts/${encodeURIComponent(cohortId)}/assignments`, validation.body);
      closeEditor();
      const base = `Đã giao bài cho ${result?.student_count || 0} học viên.`;
      const canonical = await canonicalMutation(base);
      if (canonical && result?.unactivated_count) setBanner({ kind: 'error', text: `${base} ${result.unactivated_count} bạn chưa kích hoạt nên chưa nhận được bài.` });
    } catch (caught) { setEditor({ ...editor, error: messageOf(caught) }); }
    finally { setBusy(false); }
  };

  const setAssignmentStatus = async (assignment: ClassAssignment, next: 'published' | 'archived') => {
    if (busy) return;
    setBusy(true); setBanner(null);
    try {
      await window.api.patch(`/admin/cohorts/${encodeURIComponent(cohortId)}/assignments/${encodeURIComponent(assignment.id)}`, { status: next });
      await canonicalMutation(next === 'archived' ? 'Đã đóng bài. Học viên không còn thấy bài này.' : 'Đã mở lại bài giao.');
    } catch (caught) { setBanner({ kind: 'error', text: messageOf(caught) }); }
    finally { setBusy(false); }
  };

  const deleteAssignment = async () => {
    if (!confirm || busy) return;
    const assignment = confirm.assignment;
    setConfirm(null); setBusy(true); setBanner(null);
    try {
      await window.api.delete(`/admin/cohorts/${encodeURIComponent(cohortId)}/assignments/${encodeURIComponent(assignment.id)}`);
      await canonicalMutation('Đã xoá bài giao chưa có bài nộp.');
    } catch (caught) { setBanner({ kind: 'error', text: messageOf(caught) }); }
    finally { setBusy(false); }
  };

  const openDue = (assignment: ClassAssignment) => {
    const parts = dueParts(assignment.due_at);
    setDueEditor({ assignment, dueDate: parts.date, dueTime: parts.time, confirmed: null, warning: '', error: '' });
  };

  const saveDue = async () => {
    if (!dueEditor || busy) return;
    const date = dueEditor.dueDate || null;
    const time = date ? dueEditor.dueTime || '19:00' : null;
    const confirmed = dueEditor.confirmed?.date === date && dueEditor.confirmed?.time === time ? dueEditor.confirmed : null;
    setBusy(true);
    try {
      const result = await window.api.patch<{ due_at?: string | null; audit_logged?: boolean }>(`/admin/cohorts/${encodeURIComponent(cohortId)}/assignments/${encodeURIComponent(dueEditor.assignment.id)}/due`, {
        due_date: date, due_time: time, expected_due_at: dueEditor.assignment.due_at,
        confirm_rewrites: Boolean(confirmed), confirmed_flips: confirmed?.flips || null,
      });
      setDueEditor(null);
      await canonicalMutation(result?.due_at ? 'Đã đổi hạn theo giờ Việt Nam.' : 'Đã bỏ hạn nộp.');
      if (result?.audit_logged === false) setBanner({ kind: 'error', text: 'Đã đổi hạn nhưng không ghi được nhật ký thao tác.' });
      if (logOpen) void loadLog();
    } catch (caught) {
      const detail = errorDetail(caught) as { needs_confirm?: boolean; stale_confirmation?: boolean; flips?: { to_ontime?: number; to_late?: number }; conflict?: boolean; current_due_at?: string | null; message?: string } | null;
      if (detail?.needs_confirm && detail.flips) {
        const flips = { to_ontime: Number(detail.flips.to_ontime || 0), to_late: Number(detail.flips.to_late || 0) };
        setDueEditor({ ...dueEditor, confirmed: { date, time, flips }, warning: `${detail.stale_confirmation ? 'Số lượt vừa thay đổi. ' : ''}${flips.to_ontime} lượt trễ sẽ thành đúng hạn; ${flips.to_late} lượt đúng hạn sẽ thành trễ. Bấm “Vẫn đổi hạn” nếu chấp nhận viết lại hồ sơ này.`, error: '' });
      } else if (detail?.conflict && Object.prototype.hasOwnProperty.call(detail, 'current_due_at')) {
        const current = typeof detail.current_due_at === 'string' ? detail.current_due_at : null;
        setDueEditor({
          ...dueEditor,
          assignment: { ...dueEditor.assignment, due_at: current },
          confirmed: null,
          warning: `Hạn đã đổi ở nơi khác thành ${formatDue(current)}. Hệ thống đã nạp mốc hiện tại; kiểm tra lại hạn bạn muốn rồi bấm “Đổi hạn” lần nữa.`,
          error: '',
        });
        void loadAssignments(true);
      } else {
        setDueEditor({ ...dueEditor, confirmed: null, warning: '', error: detail?.message || messageOf(caught) });
        if (detail?.conflict) {
          setDueEditor(null);
          void loadAssignments(true);
          setBanner({ kind: 'error', text: 'Hạn vừa đổi ở nơi khác. Đã tải lại danh sách; mở lại hộp đổi hạn để tiếp tục.' });
        }
      }
    } finally { setBusy(false); }
  };

  const doBackfill = async () => {
    if (!backfill || busy) return;
    const subset = backfill.assignment.recipient_scope === 'subset';
    if (subset && !backfill.studentIds.length) { setBackfill({ ...backfill, error: 'Chọn ít nhất một học viên cần thêm.' }); return; }
    setBusy(true);
    try {
      const result = await window.api.post<{ added?: number; student_count?: number }>(`/admin/cohorts/${encodeURIComponent(cohortId)}/assignments/${encodeURIComponent(backfill.assignment.id)}/backfill`, subset ? { student_ids: backfill.studentIds } : {});
      setBackfill(null);
      await canonicalMutation(result?.added ? `Đã thêm ${result.added} học viên vào bài này.` : 'Mọi học viên phù hợp đều đã có bài này.');
    } catch (caught) { setBackfill({ ...backfill, error: messageOf(caught) }); }
    finally { setBusy(false); }
  };

  const loadLog = useCallback(async (before?: string | null) => {
    const requestId = ++logSequence.current;
    setLogLoading(true); setLogError('');
    try {
      const path = `/admin/cohorts/${encodeURIComponent(cohortId)}/action-log${before ? `?before=${encodeURIComponent(before)}` : ''}`;
      const normalized = normalizeActionLog(await window.api.get<unknown>(path)) as ActionLogPayload | null;
      if (requestId !== logSequence.current) return;
      if (!normalized) throw new Error('Dữ liệu nhật ký không đúng định dạng.');
      setActionLog((current) => before && current ? { ...normalized, actions: [...current.actions, ...normalized.actions] } : normalized);
    } catch (caught) { if (requestId === logSequence.current) setLogError(messageOf(caught)); }
    finally { if (requestId === logSequence.current) setLogLoading(false); }
  }, [cohortId]);

  const stopQuestionPreview = () => {
    if (previewAudio.current) {
      previewAudio.current.pause();
      previewAudio.current.currentTime = 0;
      previewAudio.current = null;
    }
    setPreviewingQuestion(null);
  };
  const closeEditor = () => { stopQuestionPreview(); setEditor(null); };
  const toggleQuestion = (id: string) => setEditor((current) => current ? { ...current, questionIds: current.questionIds.includes(id) ? current.questionIds.filter((item) => item !== id) : [...current.questionIds, id], error: '' } : current);
  const toggleQuestionPreview = (question: QuestionOption) => {
    if (!question.audio_url) return;
    if (previewingQuestion === question.id && previewAudio.current) {
      stopQuestionPreview(); return;
    }
    previewAudio.current?.pause();
    const audio = new Audio(question.audio_url);
    previewAudio.current = audio; setPreviewingQuestion(question.id);
    const clear = () => { if (previewAudio.current === audio) { previewAudio.current = null; setPreviewingQuestion(null); } };
    audio.addEventListener('ended', clear, { once: true });
    audio.addEventListener('error', clear, { once: true });
    void audio.play().catch(clear);
  };
  const toggleRecipient = (id: string) => setEditor((current) => current ? { ...current, studentIds: current.studentIds.includes(id) ? current.studentIds.filter((item) => item !== id) : [...current.studentIds, id], error: '' } : current);
  const markingHref = (assignment: ClassAssignment) => `/pages/admin/classes/index.html?cohort_id=${encodeURIComponent(cohortId)}&assignment_id=${encodeURIComponent(assignment.id)}`;

  return (
    <section id="acx-panel-homework" className="acd-workspace ach-workspace" role="tabpanel" aria-labelledby="acx-tab-homework">
      <div className="acx-section-head"><div><p className="acd-eyebrow">Công việc của lớp</p><h2>Bài tập</h2><p>Theo dõi hạn, phạm vi người nhận và tình hình nộp từ sổ cái chuẩn. Hạn được đặt theo giờ Việt Nam.</p></div><button className="adm-btn-primary" type="button" onClick={() => setEditor(homeworkDraft() as HomeworkDraft)} disabled={busy}>Giao bài mới</button></div>
      <StatusBanner banner={banner} />
      {reconcileFailed && <div className="acd-warning" role="alert">Chưa đối chiếu được một số bài đã nộp; các con số bên dưới có thể còn thiếu. Tải lại để thử đối chiếu lại.</div>}
      {error && <div className={assignments ? 'acd-warning' : 'acd-state is-error'} role="alert"><strong>Không đọc được danh sách bài giao</strong><span>{error}{assignments ? ' Danh sách dưới đây là ảnh chụp trước đó.' : ''}</span><button className="adm-btn-secondary" type="button" onClick={() => void loadAssignments()} disabled={loading}>Thử lại</button></div>}
      <div className="acd-kpis" aria-label="Tóm tắt bài tập"><div className="acd-kpi"><span>Đang mở</span><strong>{assignments ? summary.open : '—'}</strong></div><div className="acd-kpi"><span>Sắp đến hạn</span><strong>{assignments ? summary.dueSoon : '—'}</strong></div><div className="acd-kpi"><span>Đã đóng</span><strong>{assignments ? summary.closed : '—'}</strong></div></div>
      <div className="acx-roster-toolbar"><Field label="Tìm bài tập"><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tên bài, kỹ năng…" /></Field><Field label="Trạng thái"><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Tất cả</option><option value="open">Đang mở</option><option value="due-soon">Sắp đến hạn</option><option value="archived">Đã đóng</option></select></Field><span>{visible.length} / {assignments?.length || 0} bài</span></div>
      {loading && !assignments ? <div className="acd-state"><strong>Đang đối chiếu bài giao…</strong><span>Hệ thống đang sửa sổ cái từ các lượt hoàn thành trước khi hiển thị.</span></div> : assignments && !assignments.length ? <div className="acd-state"><strong>Chưa giao bài nào</strong><span>Giao bài đầu tiên để học viên thấy công việc trong My Class.</span></div> : assignments && !visible.length ? <div className="acd-state"><strong>Không có bài khớp bộ lọc</strong><span>Thử đổi từ khoá hoặc trạng thái.</span></div> : assignments ? <div className="acd-table-scroll" tabIndex={0} role="region" aria-label="Bảng bài tập của lớp, có thể cuộn ngang"><table className="acd-table ach-table"><thead><tr><th>Bài giao</th><th>Hạn nộp</th><th>Tình hình nộp</th><th><span className="sr-only">Thao tác</span></th></tr></thead><tbody>{visible.map((assignment) => { const state = statusOf(assignment); const progress = assignment.progress; return <tr key={assignment.id}><td><div className="ach-title"><strong>{assignment.title}</strong><span className={`adm-status-pill ${state.tone}`}>{state.label}</span></div><small>{assignmentSub(assignment)} · {assignment.recipient_scope === 'subset' ? 'Theo nhóm' : 'Cả lớp'}</small></td><td><strong>{formatDue(assignment.due_at)}</strong><small>Giờ Việt Nam</small></td><td>{progress ? <div className="ach-progress"><strong>{progress.submitted}/{progress.assigned} đã nộp</strong>{progress.late > 0 && <span>{progress.late} nộp trễ</span>}{progress.missing > 0 && <span className="is-warning">{progress.missing} chưa nộp, đã quá hạn</span>}{progress.no_account > 0 && <span>{progress.no_account} chưa kích hoạt</span>}</div> : <span className="acd-unknown">Không đọc được</span>}</td><td><div className="ach-actions"><a className="adm-btn-secondary adm-btn-sm" href={markingHref(assignment)}>Nhận bài · legacy</a><button className="adm-btn-secondary adm-btn-sm" type="button" onClick={() => setBackfill({ assignment, studentIds: [], error: '' })} disabled={busy}>Bù học viên</button><button className="adm-btn-secondary adm-btn-sm" type="button" onClick={() => openDue(assignment)} disabled={busy}>Đổi hạn</button>{assignment.status === 'archived' ? <button className="adm-btn-secondary adm-btn-sm" type="button" onClick={() => void setAssignmentStatus(assignment, 'published')} disabled={busy}>Mở lại</button> : progress == null || progress.submitted > 0 ? <button className="adm-btn-secondary adm-btn-sm" type="button" onClick={() => void setAssignmentStatus(assignment, 'archived')} disabled={busy}>Đóng bài</button> : <button className="adm-btn-secondary adm-btn-sm" type="button" onClick={() => setConfirm({ kind: 'delete', assignment })} disabled={busy}>Xoá</button>}</div></td></tr>; })}</tbody></table></div> : null}

      <details className="ach-log" open={logOpen} onToggle={(event) => { const open = event.currentTarget.open; setLogOpen(open); if (open && !actionLog && !logLoading) void loadLog(); }}><summary>Nhật ký thao tác — đổi hạn và trả bài</summary><div>{logLoading && !actionLog ? <p className="acd-muted">Đang tải…</p> : logError ? <div className="acd-inline-error" role="alert">Không đọc được nhật ký: {logError}</div> : actionLog && !actionLog.actions.length ? <p className="acd-muted">Chưa có thao tác nào được ghi.</p> : actionLog ? <>{actionLog.actions.map((row) => { const detail = actionDetail(row); return <article className="ach-log-row" key={row.id}><time>{formatLogWhen(row.created_at)}</time><div><strong>{row.action === 'due_change' ? 'Đổi hạn nộp' : row.action === 'return_work' ? 'Trả bài cho học viên' : row.action}</strong><span>{[row.assignment_title, row.student_name].filter(Boolean).join(' · ') || 'Không rõ đối tượng'} · {row.actor_email || 'không rõ ai'}</span>{detail && <small>{detail}</small>}</div></article>; })}{actionLog.has_more && actionLog.next_before && <button className="adm-btn-secondary" type="button" onClick={() => void loadLog(actionLog.next_before)} disabled={logLoading}>Xem thao tác cũ hơn</button>}</> : null}</div></details>

      <Dialog open={Boolean(editor)} title="Giao bài mới" description="Chọn nội dung, người nhận và hạn trước khi ghi vào sổ bài giao." busy={busy} onClose={closeEditor} actions={<><button className="adm-btn-secondary" type="button" onClick={closeEditor} disabled={busy}>Hủy</button><button className="adm-btn-primary" type="submit" form="ach-homework-form" disabled={busy || catalogLoading}>{busy ? 'Đang giao…' : editor?.recipientScope === 'subset' ? `Giao cho ${editor.studentIds.length} học viên` : 'Giao cho cả lớp'}</button></>}>
        <form id="ach-homework-form" className="acd-form ach-form" onSubmit={submitHomework}>
          <div className="ach-kind" role="radiogroup" aria-label="Loại bài"><label><input type="radio" name="ach-homework-kind" checked={editor?.kind === 'daily'} onChange={() => editor && setEditor({ ...editor, kind: 'daily', contentId: '', questionIds: [], error: '' })} />Bài hằng ngày</label><label><input type="radio" name="ach-homework-kind" checked={editor?.kind === 'lesson'} onChange={() => editor && setEditor({ ...editor, kind: 'lesson', skill: 'speaking', contentId: '', questionIds: [], error: '' })} />Bài sau buổi học</label></div>
          {editor?.kind === 'daily' && <Field label="Kỹ năng"><select value={editor.skill} onChange={(event) => setEditor({ ...editor, skill: event.target.value as HomeworkDraft['skill'], contentId: '', questionIds: [], error: '' })}><option value="speaking">Speaking</option><option value="reading">Reading</option><option value="listening">Listening</option><option value="course">Bài tập theo buổi</option></select></Field>}
          {editor?.skill === 'speaking' && editor.kind === 'daily' && <div className="acx-form-row"><Field label="Kiểu luyện"><select value={editor.mode} onChange={(event) => setEditor({ ...editor, mode: event.target.value as HomeworkDraft['mode'], error: '' })}><option value="practice">Luyện tập</option><option value="test_part">Luyện từng Part</option></select></Field><Field label="Part"><select value={editor.part} onChange={(event) => setEditor({ ...editor, part: event.target.value as HomeworkDraft['part'], contentId: '', questionIds: [], error: '' })}><option value="1">Part 1</option><option value="2">Part 2</option><option value="3">Part 3</option></select></Field></div>}
          <Field label={editor?.kind === 'lesson' ? 'Bộ đề của buổi' : editor?.skill === 'course' ? 'Bộ bài tập' : editor?.skill === 'speaking' ? 'Chủ đề' : 'Đề'} hint={catalogError || undefined}><select value={editor?.contentId || ''} onChange={(event) => editor && setEditor({ ...editor, contentId: event.target.value, questionIds: [], error: '' })} disabled={catalogLoading || Boolean(catalogError)}><option value="">{catalogLoading ? 'Đang tải…' : 'Chọn nội dung'}</option>{catalog.map((item) => <option key={item.id} value={item.id} disabled={!item.ready || item.already_given}>{item.lesson_no != null ? `Buổi ${item.lesson_no} · ` : ''}{item.code ? `${item.code} · ` : ''}{item.title}{item.reason ? ` · ${item.reason}` : ''}</option>)}</select></Field>
          <Field label="Tên bài giao"><input required maxLength={300} value={editor?.title || ''} onChange={(event) => editor && setEditor({ ...editor, title: event.target.value, error: '' })} /></Field>
          {(editor?.kind === 'lesson' || editor?.skill === 'speaking') && <div className="ach-kind" role="radiogroup" aria-label="Cách chọn câu"><label><input type="radio" name="ach-question-mode" checked={editor.questionMode === 'random'} onChange={() => setEditor({ ...editor, questionMode: 'random', questionIds: [], error: '' })} />{editor.kind === 'lesson' ? 'Giao cả bộ' : 'Web bốc ngẫu nhiên'}</label><label><input type="radio" name="ach-question-mode" checked={editor.questionMode === 'manual'} onChange={() => setEditor({ ...editor, questionMode: 'manual', questionIds: [], error: '' })} />Tôi tự chọn</label></div>}
          {editor?.questionMode === 'manual' && (editor.kind === 'lesson' || editor.skill === 'speaking') && editor.contentId && <div className="ach-question-list" aria-label="Chọn câu hỏi">{questionsLoading ? <p>Đang tải câu hỏi…</p> : questions.map((question) => {
            const selectedOrder = editor.questionIds.indexOf(question.id);
            return <div className="ach-question-row" key={question.id}>
              <label><input type="checkbox" checked={selectedOrder >= 0} onChange={() => toggleQuestion(question.id)} disabled={!question.ready || (editor.kind === 'daily' && selectedOrder < 0 && editor.questionIds.length >= questionsPerGive)} /><span>{question.text}</span>{selectedOrder >= 0 && <strong className="ach-question-order"><span className="sr-only">Thứ tự chọn </span>{selectedOrder + 1}</strong>}{!question.ready && <small>Chưa có audio sẵn sàng</small>}</label>
              {question.audio_url && <button className="adm-btn-secondary adm-btn-sm" type="button" aria-label={`${previewingQuestion === question.id ? 'Dừng nghe' : 'Nghe thử'}: ${question.text}`} onClick={() => toggleQuestionPreview(question)}>{previewingQuestion === question.id ? 'Dừng nghe' : 'Nghe thử'}</button>}
            </div>;
          })}</div>}
          {editor?.kind === 'lesson' ? <div className="acx-form-row"><Field label="Số ngày được nộp"><input type="number" min="1" max="90" value={editor.dueDays} onChange={(event) => setEditor({ ...editor, dueDays: event.target.value, error: '' })} /></Field><Field label="Giờ hạn · Việt Nam"><input type="time" value={editor.dueTime} onChange={(event) => setEditor({ ...editor, dueTime: event.target.value, error: '' })} /></Field></div> : <div className="acx-form-row"><Field label="Ngày hạn · Việt Nam"><input type="date" value={editor?.dueDate || ''} onChange={(event) => editor && setEditor({ ...editor, dueDate: event.target.value, error: '' })} /></Field><Field label="Giờ hạn · Việt Nam"><input type="time" value={editor?.dueTime || ''} onChange={(event) => editor && setEditor({ ...editor, dueTime: event.target.value, error: '' })} /></Field></div>}
          {editor?.skill === 'course' && <><div className="acx-form-row"><Field label="Ngưỡng đạt (%)" hint="Trống = mặc định 80"><input type="number" min="50" max="100" step="5" value={editor.passPct} onChange={(event) => setEditor({ ...editor, passPct: event.target.value, error: '' })} /></Field><Field label="Số câu kiểm tra lại" hint="Trống = mặc định 20"><input type="number" min="5" max="100" step="5" value={editor.retakeSize} onChange={(event) => setEditor({ ...editor, retakeSize: event.target.value, error: '' })} /></Field></div><div className="acd-warning">Vùng gần đạt bằng ngưỡng đạt trừ 10 điểm. Ví dụ đặt 75%: từ 65–74,9% làm bài kiểm tra lại; dưới 65% làm lại toàn bài.</div></>}
          <Field label="Dặn dò"><textarea rows={3} maxLength={2000} value={editor?.instructions || ''} onChange={(event) => editor && setEditor({ ...editor, instructions: event.target.value, error: '' })} /></Field>
          <Field label="Giao cho"><select aria-label="Giao cho" value={editor?.recipientScope || 'class'} onChange={(event) => editor && setEditor({ ...editor, recipientScope: event.target.value as HomeworkDraft['recipientScope'], studentIds: [], error: '' })}><option value="class">Cả lớp</option><option value="subset">Một nhóm học viên</option></select></Field>
          {editor?.recipientScope === 'subset' && <div className="ach-recipient-list">{members.map((member) => <label key={member.student_id}><input type="checkbox" checked={editor.studentIds.includes(member.student_id)} onChange={() => toggleRecipient(member.student_id)} /><span>{member.name}</span>{!member.user_id && <small>chưa kích hoạt</small>}</label>)}</div>}
          {editor?.error && <div className="acd-inline-error" role="alert">{editor.error}</div>}
        </form>
      </Dialog>

      <Dialog open={Boolean(dueEditor)} title="Đổi hạn nộp" description={<>Hạn hiện tại: <strong>{formatDue(dueEditor?.assignment.due_at || null)}</strong>. Mọi giờ dưới đây là giờ Việt Nam.</>} busy={busy} onClose={() => setDueEditor(null)} actions={<><button className="adm-btn-secondary" type="button" onClick={() => setDueEditor(null)} disabled={busy}>Hủy</button><button className="adm-btn-primary" type="button" onClick={() => void saveDue()} disabled={busy}>{dueEditor?.confirmed ? 'Vẫn đổi hạn' : 'Đổi hạn'}</button></>}><div className="acd-form"><div className="acx-form-row"><Field label="Ngày hạn"><input type="date" value={dueEditor?.dueDate || ''} onChange={(event) => dueEditor && setDueEditor({ ...dueEditor, dueDate: event.target.value, confirmed: null, warning: '', error: '' })} /></Field><Field label="Giờ hạn"><input type="time" value={dueEditor?.dueTime || '19:00'} disabled={!dueEditor?.dueDate} onChange={(event) => dueEditor && setDueEditor({ ...dueEditor, dueTime: event.target.value, confirmed: null, warning: '', error: '' })} /></Field></div><p className="acd-muted">Để trống ngày để bỏ hạn và nhận bài không giới hạn thời gian.</p>{dueEditor?.warning && <div className="acd-warning" role="alert">{dueEditor.warning}</div>}{dueEditor?.error && <div className="acd-inline-error" role="alert">{dueEditor.error}</div>}</div></Dialog>

      <Dialog open={Boolean(backfill)} title="Bù học viên vào bài đã giao" description={backfill?.assignment.recipient_scope === 'subset' ? 'Bài này giao theo nhóm. Chọn đích danh học viên cần thêm để không mở rộng phạm vi ngoài ý muốn.' : 'Thêm mọi học viên hiện có trong lớp nhưng chưa có mục bài giao. Lệnh chỉ thêm, không xoá người nhận cũ.'} busy={busy} onClose={() => setBackfill(null)} actions={<><button className="adm-btn-secondary" type="button" onClick={() => setBackfill(null)} disabled={busy}>Hủy</button><button className="adm-btn-primary" type="button" onClick={() => void doBackfill()} disabled={busy || Boolean(backfill?.assignment.recipient_scope === 'subset' && !backfill.studentIds.length)}>{backfill?.assignment.recipient_scope === 'subset' ? `Thêm ${backfill?.studentIds.length || 0} học viên` : 'Bù học viên còn thiếu'}</button></>}>
        {backfill?.assignment.recipient_scope === 'subset' && <div className="ach-recipient-list">{members.map((member) => <label key={member.student_id}><input type="checkbox" checked={backfill.studentIds.includes(member.student_id)} onChange={() => setBackfill({ ...backfill, studentIds: backfill.studentIds.includes(member.student_id) ? backfill.studentIds.filter((id) => id !== member.student_id) : [...backfill.studentIds, member.student_id], error: '' })} /><span>{member.name}</span>{!member.user_id && <small>chưa kích hoạt</small>}</label>)}</div>}{backfill?.error && <div className="acd-inline-error" role="alert">{backfill.error}</div>}
      </Dialog>

      <Dialog open={Boolean(confirm)} title="Xoá bài giao?" description={<>Xoá <strong>{confirm?.assignment.title}</strong>. Nút này chỉ được hiện khi sổ chưa ghi nhận bài nộp; backend vẫn kiểm lại trong transaction.</>} busy={busy} onClose={() => setConfirm(null)} actions={<><button className="adm-btn-secondary" type="button" onClick={() => setConfirm(null)} disabled={busy}>Hủy</button><button className="adm-btn-primary" type="button" onClick={() => void deleteAssignment()} disabled={busy}>Xoá bài giao</button></>} />
    </section>
  );
}

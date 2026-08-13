'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { Dialog, Field, messageOf, StatusBanner } from '@/components/admin-directory-ui';
import { useAdminProfile } from '@/components/admin-access-gate';
import {
  normalizePromptDeactivate,
  normalizePromptReanalysis,
  normalizePromptUpload,
  normalizePromptWrite,
  normalizeWritingPromptList,
  promptAnalysisState,
  promptMatches,
  promptsPageHref,
  promptsQuery,
} from '@/lib/admin-writing-prompts-model.mjs';

import type { AnalysisDraft, Difficulty, PromptAction, PromptDraft, TaskType, WritingPrompt } from './admin-writing-prompts-types';

const TASK_LABELS: Record<TaskType, string> = { task1_academic: 'Task 1 Academic', task1_general: 'Task 1 General', task2: 'Task 2' };
const DIFFICULTY_LABELS: Record<Difficulty, string> = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' };
const EMPTY_DRAFT: PromptDraft = { title: '', taskType: 'task2', promptText: '', difficulty: '', tags: '', imageUrl: '', imagePublicId: '' };
const EMPTY_ANALYSIS: AnalysisDraft = { chartType: 'mixed', overview: '', keyFeatures: '', notableData: '', axesOrCategories: '', gradingNote: '' };

type Filters = { taskType: string; difficulty: string; lifecycle: 'active' | 'archived'; visibility: 'all' | 'student' | 'exam'; q: string };
type Snapshot = { key: string; active: WritingPrompt[]; archived: WritingPrompt[]; malformed: number; capped: boolean; readAt: string };
type PendingCreate = { id: string; expected: { title: string; promptText: string; taskType: TaskType; difficulty: Difficulty | null; imagePublicId: string | null } };

function filtersFrom(params: ReturnType<typeof useSearchParams>): Filters {
  const task = params?.get('task_type') || '';
  const difficulty = params?.get('difficulty') || '';
  const status = params?.get('status');
  const visibility = params?.get('visibility');
  return {
    taskType: ['task1_academic', 'task1_general', 'task2'].includes(task) ? task : '',
    difficulty: ['beginner', 'intermediate', 'advanced'].includes(difficulty) ? difficulty : '',
    lifecycle: status === 'archived' ? 'archived' : 'active',
    visibility: visibility === 'student' || visibility === 'exam' ? visibility : 'all',
    q: params?.get('q')?.trim() || '',
  };
}

function draftOf(prompt: WritingPrompt | null): PromptDraft {
  return prompt ? {
    title: prompt.title, taskType: prompt.taskType, promptText: prompt.promptText,
    difficulty: prompt.difficulty || '', tags: prompt.tags.join(', '),
    imageUrl: prompt.imageUrl || '', imagePublicId: prompt.imagePublicId || '',
  } : { ...EMPTY_DRAFT };
}

function analysisDraftOf(prompt: WritingPrompt): AnalysisDraft {
  const analysis = prompt.analysis;
  if (!analysis) return { ...EMPTY_ANALYSIS };
  return {
    chartType: analysis.chartType,
    overview: analysis.overview,
    keyFeatures: analysis.keyFeatures.join('\n'),
    notableData: analysis.notableData.map((row) => [row.label, row.value, row.unit || ''].join(' | ')).join('\n'),
    axesOrCategories: analysis.axesOrCategories || '',
    gradingNote: analysis.gradingNote || '',
  };
}

function formatTime(value: string | null) {
  if (!value) return 'Chưa có';
  return new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function httpStatusOf(caught: unknown) {
  return typeof caught === 'object' && caught !== null && 'status' in caught && typeof caught.status === 'number'
    ? caught.status
    : null;
}

function actionCopy(action: PromptAction | null) {
  if (!action) return { title: '', description: '', button: '', danger: false };
  if (action.kind === 'archive') return { title: 'Lưu trữ prompt này?', description: 'Prompt ngừng xuất hiện trong thư viện giao bài. Hình đã phát hành được giữ làm bằng chứng cho bài cũ; khi khôi phục bạn cần gắn lại hình.', button: 'Lưu trữ prompt', danger: true };
  if (action.kind === 'restore') return { title: 'Khôi phục prompt này?', description: 'Prompt trở lại thư viện hoạt động. Nếu từng có hình, bạn cần tải hoặc gắn hình mới sau khi khôi phục.', button: 'Khôi phục', danger: false };
  if (action.kind === 'reanalyze') return { title: 'Phân tích lại hình?', description: 'Đáp án hiện tại sẽ chuyển về chưa duyệt cho đến khi phân tích mới hoàn tất và được admin xác nhận.', button: 'Phân tích lại', danger: false };
  return action.prompt.examOnly
    ? { title: 'Trả đề về thư viện học viên?', description: 'Học viên có thể luyện đề này. Hệ thống sẽ từ chối nếu đề còn được một kỳ thi chưa lưu trữ sử dụng.', button: 'Trả về thư viện', danger: false }
    : { title: 'Dành riêng cho kỳ thi?', description: 'Đề sẽ biến mất khỏi ngân hàng tự luyện của học viên nhưng vẫn hoạt động trong Mock Exam.', button: 'Chuyển sang đề thi', danger: false };
}

export function AdminWritingPrompts() {
  const profile = useAdminProfile();
  const router = useRouter();
  const params = useSearchParams();
  const filters = useMemo(() => filtersFrom(params), [params]);
  const [searchDraft, setSearchDraft] = useState(filters.q);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [editor, setEditor] = useState<WritingPrompt | 'new' | null>(null);
  const [draft, setDraft] = useState<PromptDraft>(EMPTY_DRAFT);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [analysisEditor, setAnalysisEditor] = useState<WritingPrompt | null>(null);
  const [analysisDraft, setAnalysisDraft] = useState<AnalysisDraft>(EMPTY_ANALYSIS);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<PromptAction | null>(null);
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const mutationLock = useRef(false);
  const pendingCreate = useRef<PendingCreate | null>(null);
  const profileRef = useRef(profile.id); profileRef.current = profile.id;
  const filterKey = `${profile.id}|${filters.taskType}|${filters.difficulty}`;
  const current = snapshot?.key === filterKey ? snapshot : null;
  const sourceRows = filters.lifecycle === 'active' ? current?.active || [] : current?.archived || [];
  const visibleRows = useMemo(() => sourceRows.filter((row) => promptMatches(row, filters)), [sourceRows, filters]);
  const pendingVisible = visibleRows.some((row) => row.analysisStatus === 'pending');
  const localImagePreview = useMemo(() => imageFile ? URL.createObjectURL(imageFile) : null, [imageFile]);

  useEffect(() => () => { if (localImagePreview) URL.revokeObjectURL(localImagePreview); }, [localImagePreview]);

  const navigate = useCallback((next: Partial<Filters>) => {
    router.replace(promptsPageHref({ ...filters, ...next }), { scroll: false });
  }, [filters, router]);

  const readAll = useCallback(async () => {
    const base = { taskType: filters.taskType, difficulty: filters.difficulty };
    const [activeRaw, archivedRaw] = await Promise.all([
      window.api.get<unknown>(`/admin/writing/prompts?${promptsQuery({ ...base, lifecycle: 'active' })}`),
      window.api.get<unknown>(`/admin/writing/prompts?${promptsQuery({ ...base, lifecycle: 'archived' })}`),
    ]);
    const active = normalizeWritingPromptList(activeRaw) as { rows: WritingPrompt[]; malformedCount: number } | null;
    const archived = normalizeWritingPromptList(archivedRaw) as { rows: WritingPrompt[]; malformedCount: number } | null;
    if (!active || !archived) throw new Error('Danh sách prompt không đúng định dạng.');
    return {
      active: active.rows, archived: archived.rows,
      malformed: active.malformedCount + archived.malformedCount,
      capped: active.rows.length === 500 || archived.rows.length === 500,
    };
  }, [filters.taskType, filters.difficulty]);

  const readPrompt = useCallback(async (id: string) => {
    const row = normalizePromptWrite(
      await window.api.get<unknown>(`/admin/writing/prompts/${encodeURIComponent(id)}`),
      id,
    ) as WritingPrompt | null;
    if (!row) throw new Error('Prompt đọc lại không đúng định dạng hoặc identity.');
    return row;
  }, []);

  const load = useCallback(async (preserve = true) => {
    const account = profile.id; const key = filterKey; const requestId = ++sequence.current;
    setLoading(true);
    try {
      const data = await readAll();
      if (requestId !== sequence.current || profileRef.current !== account) return null;
      setSnapshot({ key, ...data, readAt: new Date().toISOString() }); setListError(null);
      return data;
    } catch (caught) {
      if (requestId === sequence.current && profileRef.current === account) {
        setListError(`${preserve && current ? 'Không thể làm mới — đang giữ snapshot trước. ' : ''}${messageOf(caught)}`);
      }
      return null;
    } finally {
      if (requestId === sequence.current && profileRef.current === account) setLoading(false);
    }
  }, [profile.id, filterKey, readAll, current]);

  useEffect(() => {
    setSearchDraft(filters.q); setBanner(null); void load(false);
    return () => { sequence.current += 1; };
  }, [profile.id, filters.taskType, filters.difficulty]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!pendingVisible) return;
    let cancelled = false; let timer = 0;
    const schedule = () => { timer = window.setTimeout(cycle, 4000); };
    const cycle = async () => {
      if (cancelled) return;
      if (document.hidden || mutationLock.current) { schedule(); return; }
      await load(true); if (!cancelled) schedule();
    };
    const visibility = () => { if (!document.hidden) { window.clearTimeout(timer); schedule(); } };
    schedule(); document.addEventListener('visibilitychange', visibility);
    return () => { cancelled = true; window.clearTimeout(timer); document.removeEventListener('visibilitychange', visibility); };
  }, [pendingVisible, load]);

  const setCanonical = (data: Awaited<ReturnType<typeof readAll>>) => {
    setSnapshot({ key: filterKey, ...data, readAt: new Date().toISOString() }); setListError(null);
  };

  const openEditor = (prompt: WritingPrompt | null) => {
    pendingCreate.current = null;
    setEditor(prompt || 'new'); setDraft(draftOf(prompt)); setImageFile(null); setRemoveImage(false); setFormError(null);
  };

  const savePrompt = async () => {
    if (mutationLock.current) return;
    const title = draft.title.trim(); const promptText = draft.promptText.trim();
    if (title.length < 2) { setFormError('Tiêu đề phải có ít nhất 2 ký tự.'); return; }
    if (promptText.length < 10) { setFormError('Đề bài phải có ít nhất 10 ký tự.'); return; }
    const tags = [...new Set(draft.tags.split(',').map((tag) => tag.trim()).filter(Boolean))];
    if (tags.length > 20) { setFormError('Tối đa 20 tags.'); return; }
    const account = profile.id; const editing = editor !== 'new' && editor;
    mutationLock.current = true; setBusy(true); setFormError(null);
    let uploaded: { url: string; publicId: string } | null = null; let writeStarted = false; let acknowledged = false;
    try {
      if (!editing && pendingCreate.current) {
        const pending = pendingCreate.current;
        const saved = await readPrompt(pending.id);
        if (!saved.isActive || saved.title !== pending.expected.title || saved.promptText !== pending.expected.promptText || saved.taskType !== pending.expected.taskType || saved.difficulty !== pending.expected.difficulty || saved.imagePublicId !== pending.expected.imagePublicId) throw new Error('Đọc lại không khớp prompt đã tạo trước đó.');
        const canonical = await readAll();
        if (profileRef.current !== account) return;
        pendingCreate.current = null; setCanonical(canonical); setEditor(null); setImageFile(null);
        setBanner({ kind: 'success', text: 'Đã đối chiếu prompt đã tạo trước đó từ máy chủ.' });
        return;
      }
      if (draft.taskType === 'task1_academic' && imageFile) {
        const fd = new FormData(); fd.append('file', imageFile);
        uploaded = normalizePromptUpload(await window.api.upload<unknown>('/admin/writing/prompts/upload-image', fd));
        if (!uploaded) throw new Error('Máy chủ không xác nhận đúng ảnh vừa tải.');
      }
      const imageUrl = draft.taskType === 'task1_academic' && !removeImage ? uploaded?.url || draft.imageUrl || null : null;
      const imagePublicId = draft.taskType === 'task1_academic' && !removeImage ? uploaded?.publicId || draft.imagePublicId || null : null;
      const body = { title, task_type: draft.taskType, prompt_text: promptText, difficulty: draft.difficulty || null, tags, prompt_image_url: imageUrl, prompt_image_public_id: imagePublicId };
      writeStarted = true;
      const raw = editing
        ? await window.api.patch<unknown>(`/admin/writing/prompts/${encodeURIComponent(editing.id)}`, body)
        : await window.api.post<unknown>('/admin/writing/prompts', body);
      const ack = normalizePromptWrite(raw, editing ? editing.id : '') as WritingPrompt | null;
      if (!ack) throw new Error('Máy chủ không xác nhận đúng prompt vừa lưu.');
      acknowledged = true;
      if (!editing) pendingCreate.current = {
        id: ack.id,
        expected: { title, promptText, taskType: draft.taskType, difficulty: draft.difficulty || null, imagePublicId },
      };
      const saved = await readPrompt(ack.id);
      if (!saved.isActive || saved.title !== title || saved.promptText !== promptText || saved.taskType !== draft.taskType || saved.difficulty !== (draft.difficulty || null) || saved.imagePublicId !== imagePublicId) throw new Error('Đọc lại không khớp prompt vừa lưu.');
      const canonical = await readAll();
      if (profileRef.current !== account) return;
      pendingCreate.current = null; setCanonical(canonical); setEditor(null); setImageFile(null);
      setBanner({ kind: 'success', text: `${editing ? 'Đã cập nhật' : 'Đã tạo'} prompt và đối chiếu lại từ máy chủ.` });
    } catch (caught) {
      const status = httpStatusOf(caught);
      // A network failure after the write starts is ambiguous: the DB may have
      // committed even though the response was lost, so deleting the uploaded
      // object could corrupt canonical state. Explicit 4xx responses prove the
      // write was rejected and are safe to clean up.
      if (uploaded && !acknowledged && (!writeStarted || (status !== null && status >= 400 && status < 500))) {
        try { await window.api.post('/admin/writing/prompts/discard-image', { public_id: uploaded.publicId }); } catch { /* server logs cleanup failure */ }
      }
      if (profileRef.current === account) setFormError(messageOf(caught));
    } finally { mutationLock.current = false; setBusy(false); }
  };

  const runAction = async () => {
    if (!confirming || mutationLock.current) return;
    const action = confirming; const account = profile.id;
    mutationLock.current = true; setBusy(true); setBanner(null);
    try {
      if (action.kind === 'archive') {
        const ack = normalizePromptDeactivate(await window.api.delete<unknown>(`/admin/writing/prompts/${encodeURIComponent(action.prompt.id)}`), action.prompt.id);
        if (!ack) throw new Error('Máy chủ không xác nhận lưu trữ prompt.');
      } else if (action.kind === 'reanalyze') {
        const ack = normalizePromptReanalysis(await window.api.post<unknown>(`/admin/writing/prompts/${encodeURIComponent(action.prompt.id)}/reanalyze`, {}), action.prompt.id);
        if (!ack) throw new Error('Máy chủ không xác nhận yêu cầu phân tích.');
      } else {
        const body = action.kind === 'restore' ? { is_active: true } : { exam_only: !action.prompt.examOnly };
        const ack = normalizePromptWrite(await window.api.patch<unknown>(`/admin/writing/prompts/${encodeURIComponent(action.prompt.id)}`, body), action.prompt.id);
        if (!ack) throw new Error('Máy chủ không xác nhận thay đổi prompt.');
      }
      const canonical = await readAll();
      const active = canonical.active.find((row) => row.id === action.prompt.id);
      const archived = canonical.archived.find((row) => row.id === action.prompt.id);
      if (action.kind === 'archive' && (active || !archived)) throw new Error('Đọc lại chưa phản ánh trạng thái lưu trữ.');
      if (action.kind === 'restore' && (!active || archived)) throw new Error('Đọc lại chưa phản ánh trạng thái khôi phục.');
      if (action.kind === 'visibility' && (!active || active.examOnly === action.prompt.examOnly)) throw new Error('Đọc lại chưa phản ánh phạm vi sử dụng.');
      if (action.kind === 'reanalyze' && (!active || active.analysisStatus !== 'pending')) throw new Error('Đọc lại chưa phản ánh trạng thái phân tích.');
      if (profileRef.current !== account) return;
      setCanonical(canonical); setConfirming(null);
      setBanner({ kind: 'success', text: 'Đã áp dụng thay đổi và đối chiếu lại từ máy chủ.' });
    } catch (caught) { if (profileRef.current === account) setBanner({ kind: 'error', text: messageOf(caught) }); }
    finally { mutationLock.current = false; setBusy(false); }
  };

  const openAnalysis = (prompt: WritingPrompt) => { setAnalysisEditor(prompt); setAnalysisDraft(analysisDraftOf(prompt)); setAnalysisError(null); };
  const saveAnalysis = async () => {
    if (!analysisEditor || mutationLock.current) return;
    const overview = analysisDraft.overview.trim();
    if (!overview) { setAnalysisError('Tổng quan không được để trống.'); return; }
    const notableData = analysisDraft.notableData.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
      const [label = '', value = '', unit = ''] = line.split('|').map((part) => part.trim()); return { label, value, unit: unit || null };
    });
    if (notableData.some((row) => !row.label || !row.value)) { setAnalysisError('Mỗi số liệu cần đúng dạng “Nhãn | Giá trị | Đơn vị”.'); return; }
    const account = profile.id; mutationLock.current = true; setBusy(true); setAnalysisError(null);
    try {
      const body = { analysis: {
        chart_type: analysisDraft.chartType, overview,
        key_features: analysisDraft.keyFeatures.split('\n').map((line) => line.trim()).filter(Boolean),
        notable_data: notableData,
        axes_or_categories: analysisDraft.axesOrCategories.trim() || null,
        grading_note: analysisDraft.gradingNote.trim() || null,
      }, reviewed: true, expected_image_public_id: analysisEditor.imagePublicId };
      const ack = normalizePromptWrite(await window.api.patch<unknown>(`/admin/writing/prompts/${encodeURIComponent(analysisEditor.id)}/analysis`, body), analysisEditor.id) as WritingPrompt | null;
      if (!ack || !ack.analysisReviewed) throw new Error('Máy chủ không xác nhận đáp án đã duyệt.');
      const saved = await readPrompt(analysisEditor.id);
      if (!saved.analysisReviewed || saved.imagePublicId !== analysisEditor.imagePublicId || saved.analysis?.overview !== overview) throw new Error('Đọc lại không khớp đáp án vừa duyệt.');
      const canonical = await readAll();
      if (profileRef.current !== account) return;
      setCanonical(canonical); setAnalysisEditor(null); setBanner({ kind: 'success', text: 'Đã duyệt answer key và đối chiếu lại từ máy chủ.' });
    } catch (caught) { if (profileRef.current === account) setAnalysisError(messageOf(caught)); }
    finally { mutationLock.current = false; setBusy(false); }
  };

  const counts = current ? {
    active: current.active.length, archived: current.archived.length,
    exam: current.active.filter((row) => row.examOnly).length,
    review: current.active.filter((row) => row.taskType === 'task1_academic' && row.imageUrl && row.analysisStatus !== 'pending' && !row.analysisReviewed).length,
  } : { active: 0, archived: 0, exam: 0, review: 0 };
  const copy = actionCopy(confirming);

  return <main className="awp-shell">
    <header className="awp-header">
      <div><p className="acd-eyebrow">Writing · Content operations</p><h1>Kho đề Writing</h1><p>Tạo prompt, kiểm soát phạm vi sử dụng và duyệt dữ kiện hình trước khi chúng tham gia chấm bài.</p></div>
      <div className="awp-header__actions"><a className="adm-btn-secondary" href="/admin/writing">← Writing workspace</a><button className="adm-btn-primary" type="button" onClick={() => openEditor(null)}>Tạo prompt</button></div>
    </header>

    <section className="awp-overview" aria-label="Tổng quan kho đề theo bộ lọc máy chủ">
      <div><span>Đang hoạt động</span><strong>{counts.active}</strong><small>Trong bộ lọc server</small></div>
      <div><span>Đã lưu trữ</span><strong>{counts.archived}</strong><small>Có thể khôi phục</small></div>
      <div><span>Chỉ dùng cho thi</span><strong>{counts.exam}</strong><small>Không hiện khi tự luyện</small></div>
      <div><span>Cần xử lý answer key</span><strong>{counts.review}</strong><small>Sẵn sàng hoặc lỗi</small></div>
    </section>

    <StatusBanner banner={banner} />
    {listError && <div className="awp-stale" role="alert"><div><strong>{current ? 'Snapshot đang stale' : 'Không tải được kho đề'}</strong><span>{listError}</span></div><button className="adm-btn-secondary" type="button" onClick={() => void load(true)} disabled={loading}>{loading ? 'Đang thử lại…' : 'Thử lại'}</button></div>}
    {current?.malformed ? <div className="awp-warning" role="status"><strong>⚠ {current.malformed} bản ghi không hợp lệ đã bị loại</strong><span>Không dùng dữ liệu sai định dạng để đưa ra quyết định vận hành.</span></div> : null}
    {current?.capped ? <div className="awp-warning" role="status"><strong>Đã chạm giới hạn 500 bản ghi</strong><span>Tìm kiếm phía client chỉ áp dụng trên tập đang tải; hãy thu hẹp Task hoặc độ khó.</span></div> : null}

    <section className="awp-controls" aria-label="Bộ lọc kho đề">
      <div className="awp-tabs" role="group" aria-label="Vòng đời prompt">
        <button className={filters.lifecycle === 'active' ? 'is-active' : ''} type="button" onClick={() => navigate({ lifecycle: 'active' })}>Đang hoạt động <span>{counts.active}</span></button>
        <button className={filters.lifecycle === 'archived' ? 'is-active' : ''} type="button" onClick={() => navigate({ lifecycle: 'archived' })}>Đã lưu trữ <span>{counts.archived}</span></button>
      </div>
      <div className="awp-filters">
        <label><span>Task</span><select value={filters.taskType} onChange={(event) => navigate({ taskType: event.target.value })}><option value="">Tất cả task</option><option value="task1_academic">Task 1 Academic</option><option value="task1_general">Task 1 General</option><option value="task2">Task 2</option></select></label>
        <label><span>Độ khó</span><select value={filters.difficulty} onChange={(event) => navigate({ difficulty: event.target.value })}><option value="">Tất cả mức</option><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></label>
        <label><span>Phạm vi</span><select value={filters.visibility} onChange={(event) => navigate({ visibility: event.target.value as Filters['visibility'] })}><option value="all">Tất cả</option><option value="student">Thư viện học viên</option><option value="exam">Chỉ kỳ thi</option></select></label>
        <form onSubmit={(event) => { event.preventDefault(); navigate({ q: searchDraft }); }}><label htmlFor="awp-search">Tìm trong tập đang tải</label><div><input id="awp-search" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Tiêu đề, nội dung hoặc tag…"/><button className="adm-btn-secondary" type="submit">Tìm</button></div></form>
      </div>
    </section>

    <section className="awp-library" aria-labelledby="awp-library-title">
      <header><div><p className="acd-eyebrow">{filters.lifecycle === 'active' ? 'Active library' : 'Archive'}</p><h2 id="awp-library-title">{visibleRows.length} prompt phù hợp</h2><p>{current ? `Đối chiếu lúc ${formatTime(current.readAt)}` : 'Đang chờ dữ liệu canonical'}</p></div><button className="adm-btn-secondary" type="button" onClick={() => void load(true)} disabled={loading}>{loading ? 'Đang làm mới…' : 'Làm mới'}</button></header>
      {!current && loading ? <div className="awp-empty" role="status"><span className="awp-spinner"/><h3>Đang tải kho đề…</h3></div> : null}
      {current && !visibleRows.length ? <div className="awp-empty"><h3>Không có prompt phù hợp</h3><p>Đổi bộ lọc hoặc tạo prompt mới cho thư viện này.</p></div> : null}
      <div className="awp-grid">{visibleRows.map((prompt) => {
        const analysis = promptAnalysisState(prompt);
        return <article className="awp-card" key={prompt.id}>
          <div className="awp-card__visual">{prompt.imageUrl ? <img src={prompt.imageUrl} alt={`Hình minh hoạ cho ${prompt.title}`} loading="lazy"/> : <div aria-hidden="true"><span>{prompt.taskType === 'task1_academic' ? 'T1A' : prompt.taskType === 'task1_general' ? 'T1G' : 'T2'}</span></div>}<span className={`awp-analysis is-${analysis.key}`}>{analysis.label}</span></div>
          <div className="awp-card__body"><div className="awp-card__meta"><span>{TASK_LABELS[prompt.taskType]}</span>{prompt.difficulty && <span>{DIFFICULTY_LABELS[prompt.difficulty]}</span>}<span className={prompt.examOnly ? 'is-exam' : 'is-student'}>{prompt.examOnly ? 'Exam only' : 'Student library'}</span></div><h3>{prompt.title}</h3><p>{prompt.promptText}</p><div className="awp-tags">{prompt.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>{prompt.analysisError && <div className="awp-card__error">{prompt.analysisError}</div>}{prompt.malformedOptional ? <div className="awp-card__error">Metadata answer key không nhất quán; cần phân tích/duyệt lại.</div> : null}</div>
          <footer>{filters.lifecycle === 'active' ? <><button className="adm-btn-secondary" type="button" onClick={() => openEditor(prompt)}>Sửa prompt</button>{prompt.taskType === 'task1_academic' && prompt.imageUrl ? prompt.analysisStatus === 'pending' ? <button className="adm-btn-secondary" type="button" disabled>Đang phân tích…</button> : <button className="adm-btn-secondary" type="button" onClick={() => prompt.analysisStatus === 'ready' ? openAnalysis(prompt) : setConfirming({ kind: 'reanalyze', prompt })}>{prompt.analysisStatus === 'ready' ? 'Duyệt answer key' : 'Phân tích hình'}</button> : null}<button className="adm-btn-secondary" type="button" onClick={() => setConfirming({ kind: 'visibility', prompt })}>{prompt.examOnly ? 'Trả về thư viện' : 'Dành cho kỳ thi'}</button><button className="adm-btn-danger" type="button" onClick={() => setConfirming({ kind: 'archive', prompt })}>Lưu trữ</button></> : <button className="adm-btn-primary" type="button" onClick={() => setConfirming({ kind: 'restore', prompt })}>Khôi phục prompt</button>}</footer>
        </article>;
      })}</div>
    </section>

    <Dialog open={editor !== null} title={editor === 'new' ? 'Tạo prompt mới' : 'Sửa prompt'} description="Nội dung prompt và hình nguồn. Answer key được duyệt ở workspace riêng." onClose={() => !busy && setEditor(null)} busy={busy} panelClassName="awp-dialog-wide" actions={<><button className="adm-btn-secondary" type="button" onClick={() => setEditor(null)} disabled={busy}>Huỷ</button><button className="adm-btn-primary" type="button" onClick={() => void savePrompt()} disabled={busy}>{busy ? 'Đang lưu…' : pendingCreate.current ? 'Thử đối chiếu lại' : 'Lưu prompt'}</button></>}>
      <div className="awp-form"><Field label="Tiêu đề"><input value={draft.title} maxLength={200} onChange={(event) => setDraft({ ...draft, title: event.target.value })}/></Field><div className="awp-form-grid"><Field label="Loại bài"><select value={draft.taskType} onChange={(event) => { const taskType = event.target.value as TaskType; setDraft({ ...draft, taskType }); if (taskType !== 'task1_academic') { setImageFile(null); setRemoveImage(true); } }}><option value="task2">Task 2</option><option value="task1_academic">Task 1 Academic</option><option value="task1_general">Task 1 General</option></select></Field><Field label="Độ khó"><select value={draft.difficulty} onChange={(event) => setDraft({ ...draft, difficulty: event.target.value as PromptDraft['difficulty'] })}><option value="">Chưa phân loại</option><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></Field></div><Field label="Đề bài" hint={`${draft.promptText.length}/5000`}><textarea rows={8} maxLength={5000} value={draft.promptText} onChange={(event) => setDraft({ ...draft, promptText: event.target.value })}/></Field><Field label="Tags" hint="Phân cách bằng dấu phẩy; tối đa 20 tags."><input value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })}/></Field>
        {draft.taskType === 'task1_academic' ? <section className="awp-image-field"><div><strong>Hình Task 1 Academic</strong><span>PNG, JPG hoặc WebP · tối đa 5 MB. File chỉ upload khi bạn bấm Lưu.</span></div>{!removeImage && (localImagePreview || draft.imageUrl) ? <div className="awp-image-preview">{localImagePreview ? <img src={localImagePreview} alt="Xem trước hình mới"/> : <img src={draft.imageUrl} alt="Hình hiện tại"/>}<button className="adm-btn-secondary" type="button" onClick={() => { setImageFile(null); setRemoveImage(true); }}>Bỏ hình</button></div> : <label className="awp-upload"><span>Chọn hình từ máy</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { setImageFile(event.target.files?.[0] || null); setRemoveImage(false); }}/></label>}</section> : null}
        {formError && <div className="acd-form-error" role="alert">{formError}</div>}
      </div>
    </Dialog>

    <Dialog open={analysisEditor !== null} title="Duyệt answer key hình" description={analysisEditor ? `Đáp án này chỉ hợp lệ cho ảnh ${analysisEditor.imagePublicId}.` : undefined} onClose={() => !busy && setAnalysisEditor(null)} busy={busy} panelClassName="awp-dialog-analysis" actions={<><button className="adm-btn-secondary" type="button" onClick={() => setAnalysisEditor(null)} disabled={busy}>Huỷ</button><button className="adm-btn-primary" type="button" onClick={() => void saveAnalysis()} disabled={busy}>{busy ? 'Đang đối chiếu…' : 'Lưu & duyệt'}</button></>}>
      <div className="awp-form"><div className="awp-form-grid"><Field label="Dạng hình"><select value={analysisDraft.chartType} onChange={(event) => setAnalysisDraft({ ...analysisDraft, chartType: event.target.value as AnalysisDraft['chartType'] })}>{['line','bar','pie','table','map','process','mixed'].map((type) => <option value={type} key={type}>{type}</option>)}</select></Field><Field label="Model phân tích"><input value={analysisEditor?.analysisModel || 'Không rõ'} disabled/></Field></div><Field label="Tổng quan"><textarea rows={3} value={analysisDraft.overview} onChange={(event) => setAnalysisDraft({ ...analysisDraft, overview: event.target.value })}/></Field><Field label="Trục, danh mục hoặc khung thời gian"><textarea rows={3} value={analysisDraft.axesOrCategories} onChange={(event) => setAnalysisDraft({ ...analysisDraft, axesOrCategories: event.target.value })}/></Field><Field label="Đặc điểm chính" hint="Mỗi dòng một ý."><textarea rows={5} value={analysisDraft.keyFeatures} onChange={(event) => setAnalysisDraft({ ...analysisDraft, keyFeatures: event.target.value })}/></Field><Field label="Số liệu đáng chú ý" hint="Mỗi dòng: Nhãn | Giá trị | Đơn vị"><textarea rows={6} value={analysisDraft.notableData} onChange={(event) => setAnalysisDraft({ ...analysisDraft, notableData: event.target.value })}/></Field><Field label="Ghi chú chấm"><textarea rows={3} value={analysisDraft.gradingNote} onChange={(event) => setAnalysisDraft({ ...analysisDraft, gradingNote: event.target.value })}/></Field>{analysisError && <div className="acd-form-error" role="alert">{analysisError}</div>}</div>
    </Dialog>

    <Dialog open={confirming !== null} title={copy.title} description={copy.description} onClose={() => !busy && setConfirming(null)} busy={busy} actions={<><button className="adm-btn-secondary" type="button" onClick={() => setConfirming(null)} disabled={busy}>Huỷ</button><button className={copy.danger ? 'adm-btn-danger' : 'adm-btn-primary'} type="button" onClick={() => void runAction()} disabled={busy}>{busy ? 'Đang đối chiếu…' : copy.button}</button></>}/>
  </main>;
}

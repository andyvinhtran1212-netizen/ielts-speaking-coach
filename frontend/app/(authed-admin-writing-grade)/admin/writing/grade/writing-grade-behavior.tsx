'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { useSearchParams } from 'next/navigation';

import { useAdminProfile } from '@/components/admin-access-gate';
import {
  ADMIN_GRADE_SECTIONS,
  ADMIN_GRADE_TABS,
  REGRADE_LEVELS,
  adminGradeActionState,
  adminGradeRequestKey,
  adminGradeTaskLabel,
  classifyInstructorReview,
  parseAdminGradeDraft,
  readAdminGradeQueue,
  selectKeyedAdminState,
} from '@/lib/admin-writing-grade-model.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

type TabKey = 'tongquan' | 'loi' | 'nangcao' | 'baimau';
type InstructorState = ReturnType<typeof classifyInstructorReview>;
type GradeWorkspace = {
  detail: any;
  feedback: Record<string, unknown>;
  instructorNote: string;
  dirty: boolean;
  instructor: InstructorState;
  instructorWarning: string | null;
};
type GradeView =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; workspace: GradeWorkspace };
type KeyedGradeView = { key: string; value: GradeView };
type Notice = { tone: 'success' | 'warn' | 'error'; message: string } | null;

const QUEUE_KEY = 'gradeQueue';

function messageOf(caught: unknown) {
  return caught instanceof Error ? caught.message : String(caught || 'Có lỗi xảy ra.');
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  try { return new Date(value).toLocaleString('vi-VN'); } catch { return value; }
}

function relativeTime(value: string | null | undefined) {
  if (!value) return '';
  try {
    const hours = (Date.now() - new Date(value).getTime()) / 3_600_000;
    if (hours < 1) return `${Math.max(0, Math.round(hours * 60))} phút trước`;
    if (hours < 24) return `${Math.round(hours)}h trước`;
    return new Date(value).toLocaleDateString('vi-VN');
  } catch { return value; }
}

function notify(tone: 'success' | 'warn' | 'error', message: string) {
  if (typeof window.showToast === 'function') {
    window.showToast(message, tone, tone === 'error' ? { persist: true } : { timeout: 4000 });
  }
}

export function AdminWritingGradeLoading() {
  return <div className="flex items-center justify-center py-32" role="status"><p className="aw-state-loading__text text-sm">Đang tải bài viết…</p></div>;
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="max-w-xl mx-auto px-6 py-20 text-center" role="alert">
      <h2 className="aw-state-denied__title text-xl font-bold">Không tải được bài viết</h2>
      <p>{message}</p>
      <a className="btn mt-4" href="/pages/admin/writing/queue.html">← Quay lại queue</a>
    </div>
  );
}

function ThemeButton() {
  const toggle = () => {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('av-theme', next); } catch { /* storage disabled */ }
  };
  return (
    <button className="av-theme-toggle" type="button" aria-label="Chuyển giao diện sáng/tối" onClick={toggle}>
      <svg className="icon-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></svg>
      <svg className="icon-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
    </button>
  );
}

function RenderedFeedback({ sectionKey, value }: { sectionKey: string; value: unknown }) {
  const html = useMemo(() => {
    const renderer = window.WritingRenderers?.SECTION_RENDERERS?.[sectionKey];
    try {
      return renderer
        ? renderer(value)
        : window.WritingRenderers?.emptyShape?.('— Renderer chưa sẵn sàng —') || '';
    } catch (caught) {
      console.error('[admin-writing-grade] renderer failed', sectionKey, caught);
      return window.WritingRenderers?.emptyShape?.('— Lỗi hiển thị section —') || '';
    }
  }, [sectionKey, value]);
  return <div className="section-content" id={`content-${sectionKey}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

function FeedbackSection({
  section,
  value,
  editing,
  editRaw,
  editError,
  onOpen,
  onRaw,
  onSave,
  onCancel,
}: {
  section: any;
  value: unknown;
  editing: boolean;
  editRaw: string;
  editError: string;
  onOpen: () => void;
  onRaw: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <section id={`section-${section.key}`} className="grade-section" data-section={section.key}>
      <header className="section-header"><h2>{section.title}</h2><button className="btn-edit" type="button" onClick={onOpen}>✏ {section.string ? 'Sửa' : 'Sửa JSON'}</button></header>
      {!editing ? <RenderedFeedback sectionKey={section.key} value={value} /> : null}
      {editing ? (
        <div className="section-edit" id={`edit-${section.key}`}>
          <textarea
            autoFocus
            aria-label={`${section.string ? 'Sửa' : 'Sửa JSON'}: ${section.title.replace(/^\S+\s/, '')}`}
            className={section.string ? 'text-edit' : 'json-edit'}
            rows={section.rows}
            value={editRaw}
            onChange={(event) => onRaw(event.target.value)}
          />
          <div className="edit-actions">
            <button className="btn btn-primary" type="button" onClick={onSave}>Lưu vào draft</button>
            <button className="btn" type="button" onClick={onCancel}>Hủy</button>
            <span className="edit-error" role={editError ? 'alert' : undefined}>{editError}</span>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function RegradeModal({ currentLevel, onCancel, onConfirm }: { currentLevel: number; onCancel: () => void; onConfirm: (level: number) => void }) {
  const [level, setLevel] = useState(currentLevel >= 1 && currentLevel <= 5 ? currentLevel : 3);
  const selectRef = useRef<HTMLSelectElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { selectRef.current?.focus(); }, []);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); onCancel(); return; }
    if (event.key !== 'Tab') return;
    if (event.shiftKey && document.activeElement === selectRef.current) {
      event.preventDefault(); confirmRef.current?.focus();
    } else if (!event.shiftKey && document.activeElement === confirmRef.current) {
      event.preventDefault(); selectRef.current?.focus();
    }
  };
  return (
    <div className="regrade-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <div className="regrade-modal" role="dialog" aria-modal="true" aria-labelledby="regrade-modal-title" onKeyDown={onKeyDown}>
        <h2 id="regrade-modal-title" className="regrade-modal__title">Chấm lại bằng AI</h2>
        <p className="regrade-modal__body">Xóa AI feedback hiện tại + chỉnh sửa thủ công của admin, giữ nguyên note giảng viên, tăng regrade_count.</p>
        <label className="regrade-modal__field-label" htmlFor="regrade-level-select">Cấp độ phân tích AI</label>
        <select ref={selectRef} id="regrade-level-select" className="regrade-modal__select" value={level} onChange={(event) => setLevel(Number(event.target.value))}>
          {REGRADE_LEVELS.map((item: any) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <p className="regrade-modal__hint">Mặc định = cấp hiện tại của bài (L{currentLevel}). L4–L5 chấm gắt hơn.</p>
        <div className="regrade-modal__actions">
          <button ref={cancelRef} className="btn" type="button" onClick={onCancel}>Hủy</button>
          <button ref={confirmRef} className="btn btn-warn" type="button" onClick={() => onConfirm(level)}>Chấm lại</button>
        </div>
      </div>
    </div>
  );
}

function RatingPanel({ detail, onSave }: { detail: any; onSave: (rating: number, note: string) => Promise<void> }) {
  const initial = detail.grade_rating || {};
  const [rating, setRating] = useState(Number(initial.rating) || 0);
  const [note, setNote] = useState(initial.note || '');
  const [status, setStatus] = useState(initial.rated_at ? `Đã đánh giá ${formatDate(initial.rated_at)}` : '');
  const [saving, setSaving] = useState(false);
  if (!detail.feedback) return null;
  const save = async () => {
    if (!rating) { setStatus('Chọn 1–5 sao trước khi lưu.'); return; }
    if (saving) return;
    setSaving(true);
    try { await onSave(rating, note); setStatus(`✓ Đã lưu đánh giá`); }
    catch (caught) { setStatus(`Lỗi lưu: ${messageOf(caught)}`); }
    finally { setSaving(false); }
  };
  return (
    <section id="grade-rating-panel" className="grade-section" data-section="grade-rating">
      <header className="section-header"><h2>⭐ Đánh giá chất lượng chấm</h2></header>
      <div className="section-content">
        <p className="meta-line">Model phụ trách: <span id="gr-model" className="tier-badge">{detail.selected_model || '—'}</span></p>
        <div id="gr-stars" aria-label="Chất lượng chấm (1–5 sao)">
          {[1, 2, 3, 4, 5].map((value) => <button key={value} className="gr-star" type="button" aria-label={`${value} sao`} aria-pressed={rating === value} onClick={() => setRating(value)}>{value <= rating ? '★' : '☆'}</button>)}
        </div>
        <textarea id="gr-note" rows={2} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ghi chú ngắn (tuỳ chọn): band lệch, lỗi bỏ sót, nhận xét hay…" />
        <div className="edit-actions"><button id="gr-save" className="btn btn-primary" type="button" disabled={saving} onClick={() => void save()}>💾 Lưu đánh giá</button><span id="gr-status" className="meta-line" role="status">{status}</span></div>
      </div>
    </section>
  );
}

function InstructorPanel({ state, dirty, onDeliver, onRelease }: { state: InstructorState; dirty: boolean; onDeliver: (note: string) => Promise<void>; onRelease: () => Promise<void> }) {
  const review = (state as any).review;
  const [note, setNote] = useState(review?.instructor_note || '');
  const [busy, setBusy] = useState(false);
  if (state.kind === 'missing') return null;
  const mine = state.kind === 'mine';
  const delivered = state.kind === 'delivered';
  const locked = state.kind === 'locked';
  const title = delivered ? '✓ Đã giao cho học viên' : mine ? '🟢 Bạn đã claim bài này' : locked ? '🔒 Bài đang được instructor khác review' : '⏳ Trong hàng đợi instructor';
  const meta = delivered ? `Delivered ${relativeTime(review?.delivered_at)}` : mine ? `Claimed ${relativeTime(review?.claimed_at)}` : locked ? 'Không thể save cho tới khi claim được release hoặc deliver.' : 'Claim bài từ hàng đợi trước khi review.';
  const run = async (action: () => Promise<void>) => {
    if (busy) return; setBusy(true); try { await action(); } finally { setBusy(false); }
  };
  return (
    <aside id="instructor-panel" className={`instructor-panel${locked ? ' locked' : ''}${delivered ? ' delivered' : ''}`}>
      <div className="instructor-panel-title" id="instructor-panel-title">{title}</div>
      <div className="instructor-panel-meta" id="instructor-panel-meta">{meta}</div>
      <textarea aria-label="Tin nhắn cho học viên (tùy chọn)" id="instructor-note-input" maxLength={1000} disabled={!mine} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Tin nhắn cho học viên…" />
      {mine ? <div className="instructor-panel-actions"><button className="btn btn-primary" type="button" disabled={busy || dirty} title={dirty ? 'Lưu & duyệt feedback trước khi trả bài.' : ''} onClick={() => void run(() => onDeliver(note.trim()))}>✓ Trả bài cho học viên</button><button className="btn" type="button" disabled={busy} onClick={() => void run(onRelease)}>↩ Release claim</button></div> : null}
      <p className="instructor-panel-hint">Lưu các edit bằng nút <strong>💾 Lưu &amp; duyệt</strong> trước khi trả bài.</p>
    </aside>
  );
}

export function AdminWritingGradeBehavior() {
  const admin = useAdminProfile();
  const params = useSearchParams();
  const essayId = params?.get('id') || params?.get('essay_id') || '';
  const requestKey = adminGradeRequestKey(admin.id, essayId);
  const [reloadToken, setReloadToken] = useState(0);
  const [gradeState, setGradeState] = useState<KeyedGradeView>({ key: '', value: { phase: 'loading' } });
  const [tab, setTab] = useState<TabKey>('tongquan');
  const [editing, setEditing] = useState<string | null>(null);
  const [editRaw, setEditRaw] = useState('');
  const [editError, setEditError] = useState('');
  const [notice, setNotice] = useState<Notice>(null);
  const [lastSaved, setLastSaved] = useState('');
  const [hideScores, setHideScores] = useState(false);
  const [regradeOpen, setRegradeOpen] = useState(false);
  const [promptImage, setPromptImage] = useState('');
  const mutationRef = useRef(new Set<string>());

  const setMessage = useCallback((tone: 'success' | 'warn' | 'error', message: string) => {
    setNotice({ tone, message }); notify(tone, message);
  }, []);

  useEffect(() => {
    if (!requestKey) {
      setGradeState({ key: '', value: { phase: 'error', message: 'Thiếu essay id trong URL (?id=… hoặc ?essay_id=…).' } });
      return;
    }
    let dead = false;
    setGradeState({ key: requestKey, value: { phase: 'loading' } });
    setEditing(null); setNotice(null);
    (async () => {
      const globalsReady = await whenGlobalReady(
        () => typeof window.api?.get === 'function' && Boolean(window.WritingRenderers),
        'window.api + WritingRenderers (admin writing grade)',
      );
      if (dead) return;
      if (!globalsReady) {
        setGradeState({ key: requestKey, value: { phase: 'error', message: 'Không tải được công cụ chấm bài. Vui lòng tải lại trang.' } });
        return;
      }
      try {
        const detail = await window.api.get<any>(`/admin/writing/essays/${encodeURIComponent(essayId)}`);
        if (dead) return;
        let instructor: InstructorState = { kind: 'missing' };
        let instructorWarning: string | null = null;
        if (String(detail.grading_tier || 'standard').toLowerCase() === 'instructor') {
          const statuses = ['queued', 'claimed', 'edited', 'delivered'].map((status) => `status=${status}`).join('&');
          try {
            const items = await window.api.get<any[]>(`/admin/instructor/queue?${statuses}&essay_id=${encodeURIComponent(essayId)}`);
            instructor = classifyInstructorReview(items?.[0]?.review || null, admin.id);
            if (instructor.kind === 'missing') {
              instructorWarning = 'Bài tier Instructor nhưng chưa có review row. Có thể cần regrade để tạo lại queue entry.';
            }
          } catch (caught) {
            console.warn('[admin-writing-grade] instructor context failed', caught);
            instructorWarning = `Không tải được trạng thái instructor: ${messageOf(caught)}. Bạn vẫn có thể chỉnh sửa bài, nhưng trạng thái queue chưa được xác minh.`;
          }
        }
        if (dead) return;
        const feedback = { ...((detail.feedback && detail.feedback.feedback_json) || {}) };
        const initialImage = detail.task_type === 'task1_academic'
          ? detail.prompt_image_url || detail.prompt_image_url_fallback || ''
          : '';
        setPromptImage(initialImage);
        setHideScores(Boolean(detail.hide_subbands));
        setGradeState({
          key: requestKey,
          value: {
            phase: 'ready',
            workspace: {
              detail,
              feedback,
              instructorNote: detail.instructor_note || '',
              dirty: false,
              instructor,
              instructorWarning,
            },
          },
        });
      } catch (caught) {
        if (!dead) setGradeState({ key: requestKey, value: { phase: 'error', message: messageOf(caught) } });
      }
    })();
    return () => { dead = true; };
  }, [admin.id, essayId, reloadToken, requestKey]);

  useEffect(() => {
    const chrome = document.querySelector('aver-admin-chrome');
    if (!chrome) return;
    if (params?.get('embed') === '1') chrome.setAttribute('embed', '');
    else chrome.removeAttribute('embed');
  }, [params]);

  const view = selectKeyedAdminState(gradeState, requestKey) as GradeView;
  const workspace = view.phase === 'ready' ? view.workspace : null;

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!workspace?.dirty) return;
      event.preventDefault(); event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [workspace?.dirty]);

  const updateWorkspace = useCallback((updater: (current: GradeWorkspace) => GradeWorkspace) => {
    setGradeState((current) => {
      if (current.key !== requestKey || current.value.phase !== 'ready') return current;
      return { key: current.key, value: { phase: 'ready', workspace: updater(current.value.workspace) } };
    });
  }, [requestKey]);

  const runMutation = useCallback(async <T,>(name: string, action: () => Promise<T>): Promise<T> => {
    if (mutationRef.current.has(name)) throw new Error('Thao tác đang được xử lý.');
    mutationRef.current.add(name);
    try { return await action(); } finally { mutationRef.current.delete(name); }
  }, []);

  const saveAll = useCallback(async () => {
    if (!workspace) return false;
    const reviewKind = workspace.instructor.kind;
    const instructorWritable = reviewKind === 'missing' || reviewKind === 'mine';
    if (!adminGradeActionState(workspace.detail.status).canSave || !instructorWritable) {
      setMessage('error', `Không thể lưu bài ở trạng thái ${workspace.detail.status}.`); return false;
    }
    try {
      await runMutation('save', () => window.api.patch(`/admin/writing/essays/${encodeURIComponent(essayId)}/feedback`, workspace.feedback));
      updateWorkspace((current) => ({ ...current, dirty: false, detail: { ...current.detail, status: 'reviewed' } }));
      setLastSaved(`Lưu lúc ${new Date().toLocaleTimeString()}`);
      setMessage('success', 'Đã lưu chỉnh sửa.'); return true;
    } catch (caught) { setMessage('error', `Save failed: ${messageOf(caught)}`); return false; }
  }, [essayId, runMutation, setMessage, updateWorkspace, workspace]);

  if (!requestKey || view.phase === 'loading') return <AdminWritingGradeLoading />;
  if (view.phase === 'error') return <ErrorState message={view.message} />;

  const { detail, feedback, dirty, instructor, instructorWarning } = view.workspace;
  const baseActions = adminGradeActionState(detail.status);
  const instructorWritable = instructor.kind === 'missing' || instructor.kind === 'mine';
  const actions = { ...baseActions, canSave: baseActions.canSave && instructorWritable };
  const sectionKeyMap = window.WritingRenderers?.SECTION_KEYS || {};
  const queue = readAdminGradeQueue(sessionStorage.getItem(QUEUE_KEY), essayId);
  const embed = params?.get('embed') === '1';
  const mocklane = params?.get('mocklane') === '1';
  const withEmbed = (url: string) => {
    const extra = [embed ? 'embed=1' : '', mocklane ? 'mocklane=1' : ''].filter(Boolean).join('&');
    return extra ? `${url}${url.includes('?') ? '&' : '?'}${extra}` : url;
  };

  const openEditor = (section: any) => {
    const value = feedback[sectionKeyMap[section.key]];
    setEditing(section.key); setEditError('');
    setEditRaw(section.string ? String(value ?? '') : value == null ? '' : JSON.stringify(value, null, 2));
  };
  const saveDraft = (section: any) => {
    const parsed = parseAdminGradeDraft(editRaw, Boolean(section.string));
    if (!parsed.ok) { setEditError(parsed.error || 'JSON không hợp lệ.'); return; }
    updateWorkspace((current) => ({ ...current, dirty: true, feedback: { ...current.feedback, [sectionKeyMap[section.key]]: parsed.value } }));
    setEditing(null); setEditError('');
  };
  const saveNote = async (note: string) => {
    try {
      await runMutation('note', () => window.api.patch(`/admin/writing/essays/${encodeURIComponent(essayId)}/instructor-note`, { instructor_note: note }));
      updateWorkspace((current) => ({ ...current, instructorNote: note })); setEditing(null); setMessage('success', 'Đã lưu note.');
    } catch (caught) {
      const message = `Lỗi lưu note: ${messageOf(caught)}`;
      setEditError(message);
      setMessage('error', message);
    }
  };
  const ensureSaved = async (label: string) => {
    if (!dirty) return true;
    if (!window.confirm(`Bạn có thay đổi chưa lưu. Lưu trước khi ${label}?`)) return false;
    return saveAll();
  };
  const copyFeedback = async () => {
    if (!await ensureSaved('sao chép')) return;
    try {
      const data = await runMutation('copy', () => window.api.get<any>(`/admin/writing/essays/${encodeURIComponent(essayId)}/render`));
      if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([data.html], { type: 'text/html' }), 'text/plain': new Blob([data.plain_text], { type: 'text/plain' }) })]);
      } else await navigator.clipboard.writeText(data.plain_text);
      setMessage('success', '✓ Đã sao chép feedback.');
    } catch (caught) { setMessage('error', `Copy failed: ${messageOf(caught)}`); }
  };
  const downloadDocx = async () => {
    if (!await ensureSaved('tải file')) return;
    try {
      await runMutation('download', async () => {
        const sb: any = window.getSupabase();
        const sessionResult = await sb.auth.getSession();
        const token = sessionResult?.data?.session?.access_token;
        if (!token) throw new Error('Phiên đăng nhập đã hết hạn.');
        const response = await fetch(`${window.api.base}/admin/writing/essays/${encodeURIComponent(essayId)}/export.docx`, { headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) { let reason = `HTTP ${response.status}`; try { reason = (await response.json()).detail || reason; } catch {} throw new Error(reason); }
        const match = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') || '');
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement('a'); link.href = url; link.download = match?.[1] || 'feedback.docx'; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
    } catch (caught) { setMessage('error', `Download failed: ${messageOf(caught)}`); }
  };
  const deliver = async () => {
    if (dirty) { setMessage('error', 'Có chỉnh sửa chưa lưu. Bấm Lưu & duyệt trước khi trả bài.'); return; }
    if (!actions.canDeliver || !window.confirm('Trả bài này cho học viên?')) return;
    try {
      const result = await runMutation('deliver', () => window.api.post<any>(`/admin/writing/essays/${encodeURIComponent(essayId)}/mark-delivered`, { method: 'google_docs_paste', hide_subbands: hideScores }));
      updateWorkspace((current) => ({ ...current, detail: { ...current.detail, status: result.status, hide_subbands: hideScores } })); setMessage('success', 'Đã trả bài cho học viên.');
    } catch (caught) { setMessage('error', `Trả bài thất bại: ${messageOf(caught)}`); }
  };
  const revoke = async () => {
    if (!actions.canRevoke || !window.confirm('Thu hồi bài này khỏi học viên? Feedback được giữ nguyên.')) return;
    try {
      const result = await runMutation('revoke', () => window.api.post<any>(`/admin/writing/essays/${encodeURIComponent(essayId)}/revoke-delivery`, {}));
      updateWorkspace((current) => ({ ...current, detail: { ...current.detail, status: result.status } })); setMessage('success', 'Đã thu hồi bài.');
    } catch (caught) { setMessage('error', `Thu hồi thất bại: ${messageOf(caught)}`); }
  };
  const regrade = async (level: number) => {
    setRegradeOpen(false);
    try {
      const result = await runMutation('regrade', () => window.api.post<any>(`/admin/writing/essays/${encodeURIComponent(essayId)}/regrade`, { analysis_level: level }));
      setMessage('success', `Đã queue regrade #${result.regrade_count || ''} (L${result.analysis_level || level}).`);
      setReloadToken((value) => value + 1);
    } catch (caught) { setMessage('error', `Regrade failed: ${messageOf(caught)}`); }
  };
  const instructorDeliver = async (note: string) => {
    const review = (instructor as any).review;
    if (!review || dirty || !window.confirm('Deliver bài này cho học viên?')) return;
    try {
      await runMutation('instructor-deliver', () => window.api.post(`/admin/instructor/reviews/${encodeURIComponent(review.id)}/deliver`, { instructor_note: note || null }));
      setMessage('success', 'Đã deliver. Học viên có thể xem bài.');
      setReloadToken((value) => value + 1);
    } catch (caught) {
      setMessage('error', `Lỗi deliver: ${messageOf(caught)}`);
    }
  };
  const instructorRelease = async () => {
    const review = (instructor as any).review;
    if (!review || !window.confirm('Release claim? Edits chưa lưu sẽ mất.')) return;
    try {
      await runMutation('instructor-release', () => window.api.post(`/admin/instructor/reviews/${encodeURIComponent(review.id)}/release`, {}));
      window.location.href = withEmbed('/pages/admin/writing/instructor-queue.html');
    } catch (caught) {
      setMessage('error', `Lỗi release: ${messageOf(caught)}`);
    }
  };
  const saveNext = async () => {
    if (!await saveAll()) return;
    window.location.href = queue?.nextId
      ? withEmbed(`/admin/writing/grade?essay_id=${encodeURIComponent(queue.nextId)}`)
      : withEmbed('/pages/admin/writing/queue.html');
  };
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? ADMIN_GRADE_TABS.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + ADMIN_GRADE_TABS.length) % ADMIN_GRADE_TABS.length;
    setTab(ADMIN_GRADE_TABS[next].key as TabKey);
    document.querySelectorAll<HTMLButtonElement>('.grade-tabs [role="tab"]')[next]?.focus();
  };
  const student = detail.student || {};
  const band = detail.feedback?.overall_band_score ?? feedback.overallBandScore;
  const tier = String(detail.grading_tier || 'standard').toLowerCase();
  const level = Number(detail.analysis_level) >= 1 && Number(detail.analysis_level) <= 5 ? Number(detail.analysis_level) : 3;

  return (
    <div id="state-ready">
      <header className="grade-header">
        <div className="header-left"><a href="/admin/writing" className="back-link">← Writing Coach</a><div className="essay-meta min-w-0"><h1 id="header-student">{student.student_code ? `${student.student_code} — ` : ''}{student.full_name || ''}</h1><p className="meta-line"><span>{adminGradeTaskLabel(detail.task_type)} · {formatDate(detail.created_at)}</span><span className="separator">·</span><span id="status-pill" className="pill" data-status={detail.status}>{detail.status || '—'}</span><span className="separator">·</span><span id="band-score" className="band-score">{band != null ? `Band ${band}` : 'Band —'}</span>{detail.is_manually_edited ? <><span className="separator">·</span><span className="badge-manual">✏ Đã sửa</span></> : null}{detail.regrade_count ? <><span className="separator">·</span><span className="badge-regraded">🔄 Đã chấm lại{detail.regrade_count > 1 ? ` (×${detail.regrade_count})` : ''}</span></> : null}{tier !== 'standard' ? <><span className="separator">·</span><span className={`tier-badge tier-${tier}`}>{tier[0].toUpperCase() + tier.slice(1)}</span></> : null}{detail.analysis_level ? <><span className="separator">·</span><span className="tier-badge">L{detail.analysis_level}</span></> : null}</p></div></div>
        <div className="header-actions">
          {queue ? <a id="btn-back-queue" className="btn" href={withEmbed('/pages/admin/writing/queue.html')}>← Quay lại queue</a> : null}
          <button id="btn-save" className={`btn ${dirty ? 'btn-dirty' : 'btn-primary'}`} type="button" disabled={!actions.canSave} onClick={() => void saveAll()}>💾 Lưu &amp; duyệt{dirty ? ' *' : ''}</button>
          {queue ? <button id="btn-save-next" className="btn btn-primary" type="button" disabled={!actions.canSave} onClick={() => void saveNext()}>💾 {queue.nextId ? 'Lưu & bài kế' : 'Lưu & về queue'}</button> : null}
          <button id="btn-copy" className="btn" type="button" onClick={() => void copyFeedback()}>📋 Sao chép</button>
          <button id="btn-download" className="btn" type="button" onClick={() => void downloadDocx()}>⬇ Tải .docx</button>
          <button id="btn-regrade" className="btn btn-warn" type="button" onClick={() => { if (!dirty || window.confirm('Regrade sẽ XÓA chỉnh sửa chưa lưu. Tiếp tục?')) setRegradeOpen(true); }}>🔄 Chấm lại</button>
          <label id="hide-subbands-wrap" className="hide-subbands-toggle"><input type="checkbox" checked={hideScores} onChange={(event) => setHideScores(event.target.checked)} /> Ẩn điểm</label>
          {tier !== 'instructor' ? <button id="btn-deliver" className="btn btn-success" type="button" disabled={!actions.canDeliver} onClick={() => void deliver()}>✓ Trả bài cho học viên</button> : null}
          {actions.canRevoke ? <button id="btn-revoke" className="btn btn-warn" type="button" onClick={() => void revoke()}>↩ Thu hồi bài</button> : null}
          <span id="last-saved">{lastSaved}</span><span id="header-email" className="aw-header__email text-xs">{admin.email || ''}</span><ThemeButton />
        </div>
      </header>

      {instructorWarning ? <div id="instructor-context-warning" className="aw-alert aw-alert--warn" role="status">{instructorWarning}</div> : null}
      {notice ? <div id="alert-area" className={`aw-alert aw-alert--${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.message}</div> : null}
      <RatingPanel key={detail.id} detail={detail} onSave={async (rating, note) => { await runMutation('rating', () => window.api.post(`/admin/writing/essays/${encodeURIComponent(essayId)}/grade-rating`, { rating, note })); }} />
      <InstructorPanel key={(instructor as any).review?.id || detail.id} state={instructor} dirty={dirty} onDeliver={instructorDeliver} onRelease={instructorRelease} />

      <div className="grade-body">
        <nav className="grade-tabs" role="tablist" aria-label="Section tabs">
          {ADMIN_GRADE_TABS.map((item: any, index: number) => <button key={item.key} id={`tab-${item.key}`} className={`tab-btn${tab === item.key ? ' is-active' : ''}`} role="tab" aria-selected={tab === item.key} aria-controls={`panel-${item.key}`} type="button" onClick={() => setTab(item.key)} onKeyDown={(event) => onTabKey(event, index)}><span className="tab-icon">{item.icon}</span><span className="tab-label">{item.label}</span></button>)}
        </nav>
        <main className="grade-content">
          <section id="section-essay" className="grade-section essay-section"><header className="section-header"><h2>📄 Bài viết gốc</h2></header><div id="prompt-box" className="aw-subtitle text-xs mb-2">{detail.prompt_text ? `📝 ${detail.prompt_text}` : ''}</div>{promptImage ? <img id="prompt-image" className="prompt-chart-img" role="button" tabIndex={0} src={promptImage} alt={`Hình đề Task 1: ${(detail.prompt_text || '').slice(0, 60)}`} aria-label="Xem ảnh đề bài Task 1 (phóng to)" onError={() => { const fallback = detail.prompt_image_url_fallback || ''; if (promptImage !== fallback) setPromptImage(fallback); else setPromptImage(''); }} onClick={() => window.AvImageLightbox?.open(promptImage, 'Hình đề Task 1')} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); window.AvImageLightbox?.open(promptImage, 'Hình đề Task 1'); } }} /> : null}<pre id="essay-text" className="essay-original">{detail.essay_text || '—'}</pre></section>

          {ADMIN_GRADE_TABS.map((tabItem: any) => <div key={tabItem.key} id={`panel-${tabItem.key}`} className={`tab-panel${tab === tabItem.key ? ' is-active' : ''}`} role="tabpanel" aria-labelledby={`tab-${tabItem.key}`} hidden={tab !== tabItem.key}>
            {tabItem.key === 'baimau' ? <section id="section-instructor-note" className="grade-section" data-section="instructor-note"><header className="section-header"><h2>📝 Note giảng viên</h2><button className="btn-edit" type="button" onClick={() => { setEditing('instructor-note'); setEditRaw(view.workspace.instructorNote); setEditError(''); }}>✏ Sửa</button></header>{editing !== 'instructor-note' ? <div className="section-content" dangerouslySetInnerHTML={{ __html: window.WritingRenderers?.renderInstructorNote(view.workspace.instructorNote) || '' }} /> : <div className="section-edit"><textarea autoFocus aria-label="Sửa: Note giảng viên" className="text-edit" rows={6} maxLength={5000} value={editRaw} onChange={(event) => setEditRaw(event.target.value)} /><div className="edit-actions"><button className="btn btn-primary" type="button" onClick={() => void saveNote(editRaw)}>Lưu note</button><button className="btn" type="button" onClick={() => setEditing(null)}>Hủy</button><span className="edit-error" role={editError ? 'alert' : undefined}>{editError}</span></div></div>}</section> : null}
            {ADMIN_GRADE_SECTIONS.filter((section: any) => section.tab === tabItem.key && !(section.key === 'counterargument' && (feedback.counterargumentAnalysis == null || (typeof feedback.counterargumentAnalysis === 'object' && Object.keys(feedback.counterargumentAnalysis as object).length === 0)))).map((section: any) => <FeedbackSection key={section.key} section={section} value={feedback[sectionKeyMap[section.key]]} editing={editing === section.key} editRaw={editRaw} editError={editing === section.key ? editError : ''} onOpen={() => openEditor(section)} onRaw={setEditRaw} onSave={() => saveDraft(section)} onCancel={() => { setEditing(null); setEditError(''); }} />)}
          </div>)}
        </main>
      </div>
      {regradeOpen ? <RegradeModal currentLevel={level} onCancel={() => setRegradeOpen(false)} onConfirm={(value) => void regrade(value)} /> : null}
    </div>
  );
}

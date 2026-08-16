'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { useAuth } from '@/lib/auth/auth-provider';
import { normalizeInstructorVersions } from '@/lib/instructor-compare-model.mjs';
import {
  instructorApiPath,
  normalizeInstructorProfile,
} from '@/lib/instructor-dashboard-model.mjs';
import {
  instructorDeliveryPayload,
  instructorGradeCompareHref,
  instructorNotePayload,
  normalizeInstructorDeliverAck,
  normalizeInstructorGradeEssay,
  normalizeInstructorNoteAck,
  readInstructorGradeQuery,
  resolveInstructorGradeReview,
} from '@/lib/instructor-grade-model.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

type Phase = 'loading' | 'ready' | 'denied' | 'error';
type Banner = { tone: 'success' | 'danger' | 'warning'; message: string } | null;
type Confirmation = 'regrade' | 'revoke' | null;
type Snapshot = {
  essay: any;
  versions: any | null;
  versionsError: string | null;
  review: any | null;
  reviewMismatch: boolean;
  queueError: string | null;
};

const SECTION_LABELS: Record<string, string> = {
  overview: 'Tổng quan',
  criteria: 'Theo tiêu chí',
  mistakes: 'Lỗi cần sửa',
  'key-takeaways': 'Điểm chính',
  coherence: 'Mạch lạc',
  lexical: 'Từ vựng',
  'idea-development': 'Phát triển ý',
  improved: 'Bài mẫu tham khảo',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Đang chờ',
  grading: 'AI đang chấm',
  graded: 'Đã có kết quả AI',
  reviewed: 'Đã nhận xét',
  delivered: 'Đã trả học viên',
  failed: 'Chấm AI thất bại',
};

function messageOf(caught: unknown) {
  return caught instanceof Error ? caught.message : String(caught || 'Lỗi không xác định.');
}

function ChevronLeft() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function FeedbackPreview({ feedback }: { feedback: any }) {
  const sections = useMemo(() => {
    const renderers = window.WritingRenderers;
    if (!renderers || !feedback) return [];
    return Object.keys(renderers.SECTION_KEYS).flatMap((sectionKey) => {
      const value = feedback[renderers.SECTION_KEYS[sectionKey]];
      if (value == null
          || (Array.isArray(value) && value.length === 0)
          || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0)) return [];
      const renderer = renderers.SECTION_RENDERERS[sectionKey];
      if (!renderer) return [];
      try {
        return [{ key: sectionKey, title: SECTION_LABELS[sectionKey] || sectionKey, html: renderer(value) }];
      } catch {
        return [];
      }
    });
  }, [feedback]);

  if (!sections.length) return <p className="ig-muted">Chưa có phân tích AI để hiển thị.</p>;
  return (
    <div id="ig-ai" className="ig-feedback-stack">
      {sections.map((section) => (
        <section className="ig-sec" key={section.key}>
          <h3>{section.title}</h3>
          <div dangerouslySetInnerHTML={{ __html: section.html }} />
        </section>
      ))}
    </div>
  );
}

function EssayText({ text, mistakes }: { text: string; mistakes: unknown[] }) {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.textContent = text;
    if (!mistakes.length || !window.WritingHighlight?.render) return;
    try { window.WritingHighlight.render(host, text, mistakes); }
    catch { host.textContent = text; }
  }, [text, mistakes]);
  return <div id="ig-essay" className="ig-essay" ref={hostRef} />;
}

function ConfirmDialog({ action, pending, onCancel, onConfirm }: {
  action: Exclude<Confirmation, null>;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirmRef.current?.focus();
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !pending) onCancel(); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [onCancel, pending]);
  const regrade = action === 'regrade';
  return (
    <div className="ig-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) onCancel(); }}>
      <section className="ig-dialog" role="dialog" aria-modal="true" aria-labelledby="ig-dialog-title" aria-describedby="ig-dialog-copy">
        <p className="ig-eyebrow">Xác nhận thao tác</p>
        <h2 id="ig-dialog-title">{regrade ? 'Tạo thêm một phiên bản chấm AI?' : 'Thu hồi bài đã trả?'}</h2>
        <p id="ig-dialog-copy">
          {regrade
            ? 'AI sẽ tạo phiên bản mới. Các phiên bản cũ và nhận xét giảng viên vẫn được giữ để đối chiếu.'
            : 'Học viên sẽ tạm thời không còn thấy kết quả; nhận xét và phản hồi AI vẫn được giữ nguyên.'}
        </p>
        <div className="ig-dialog-actions">
          <button type="button" className="av-button av-button-secondary ig-action" onClick={onCancel} disabled={pending}>Hủy</button>
          <button ref={confirmRef} type="button" className={`av-button ${regrade ? 'av-button-primary' : 'av-button-destructive'} ig-action`} onClick={onConfirm} disabled={pending}>
            {pending ? 'Đang xử lý…' : regrade ? 'Chấm lại bằng AI' : 'Thu hồi bài'}
          </button>
        </div>
      </section>
    </div>
  );
}

export function InstructorGrade() {
  const { status, user } = useAuth();
  const searchParams = useSearchParams();
  const queryKey = searchParams?.toString() || '';
  const [phase, setPhase] = useState<Phase>('loading');
  const [loadError, setLoadError] = useState('');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [essayId, setEssayId] = useState('');
  const [requestedReviewId, setRequestedReviewId] = useState<string | null>(null);
  const [asInstructor, setAsInstructor] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [needsReconcile, setNeedsReconcile] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const sequence = useRef(0);
  const accountKey = status === 'signed-in' && user?.id ? user.id : '';
  const accountRef = useRef(accountKey);
  accountRef.current = accountKey;

  const readCanonical = async (id: string, target: string | null, requested: string | null): Promise<Snapshot> => {
    const [essayResult, versionsResult, queueResult] = await Promise.allSettled([
      window.api.get<unknown>(instructorApiPath(`/instructor/essays/${encodeURIComponent(id)}`, target)),
      window.api.get<unknown>(instructorApiPath(`/instructor/essays/${encodeURIComponent(id)}/versions`, target)),
      window.api.get<unknown>(instructorApiPath('/instructor/reviews/queue', target)),
    ]);
    if (essayResult.status === 'rejected') throw essayResult.reason;
    const essay = normalizeInstructorGradeEssay(essayResult.value, id);
    if (!essay) throw new Error('Backend trả dữ liệu bài viết không đúng định dạng.');

    let versions = null;
    let versionsError = null;
    if (versionsResult.status === 'fulfilled') {
      versions = normalizeInstructorVersions(versionsResult.value);
      if (!versions) versionsError = 'Dữ liệu phiên bản không đúng định dạng.';
    } else versionsError = messageOf(versionsResult.reason);

    let review = null;
    let reviewMismatch = false;
    let queueError = null;
    if (queueResult.status === 'fulfilled') {
      const resolution = resolveInstructorGradeReview(queueResult.value, id, requested);
      if (!resolution) queueError = 'Dữ liệu hàng chờ chấm không đúng định dạng.';
      else {
        review = resolution.review;
        reviewMismatch = resolution.mismatch && essay.status !== 'delivered';
      }
    } else queueError = messageOf(queueResult.reason);
    return { essay, versions, versionsError, review, reviewMismatch, queueError };
  };

  const applySnapshot = (next: Snapshot) => {
    setSnapshot(next);
    setNote(next.essay.instructorNote);
    setDirty(false);
    setNeedsReconcile(false);
    setPhase('ready');
  };

  useEffect(() => {
    if (status === 'signed-out') {
      window.location.replace('/login');
      return;
    }
    if (status !== 'signed-in' || !user?.id) return;
    const requestId = ++sequence.current;
    setPhase('loading');
    setLoadError('');
    setSnapshot(null);
    setEssayId('');
    setRequestedReviewId(null);
    setAsInstructor(null);
    setNote('');
    setDirty(false);
    setPending(null);
    setNeedsReconcile(false);
    setBanner(null);
    setConfirmation(null);

    (async () => {
      try {
        const ready = await whenGlobalReady(
          () => typeof window.api?.get === 'function' && Boolean(window.WritingRenderers),
          'window.api + WritingRenderers (instructor grade)',
        );
        if (!ready) throw new Error('Không tải được công cụ kết nối. Hãy tải lại trang.');
        const profile = normalizeInstructorProfile(await window.api.get<unknown>('/auth/me'));
        if (!profile) throw new Error('Không xác nhận được vai trò tài khoản.');
        if (requestId !== sequence.current || user.id !== accountRef.current) return;
        if (!['instructor', 'admin'].includes(profile.role)) {
          setPhase('denied');
          return;
        }
        const query = readInstructorGradeQuery(new URLSearchParams(queryKey));
        const effective = profile.role === 'admin' ? query.requestedInstructor : null;
        const next = await readCanonical(query.essayId, effective, query.requestedReviewId);
        if (requestId !== sequence.current || user.id !== accountRef.current) return;
        setEssayId(query.essayId);
        setRequestedReviewId(query.requestedReviewId);
        setAsInstructor(effective);
        applySnapshot(next);
      } catch (caught) {
        if (requestId === sequence.current && user.id === accountRef.current) {
          setLoadError(messageOf(caught));
          setPhase('error');
        }
      }
    })();
    return () => { sequence.current += 1; };
  }, [status, user?.id, queryKey]);

  const currentScope = () => ({ ownerId: accountRef.current, requestId: sequence.current });
  const scopeIsCurrent = (scope: { ownerId: string; requestId: number }) => (
    scope.ownerId === accountRef.current && scope.requestId === sequence.current
  );

  const canonicalReadback = async (scope: { ownerId: string; requestId: number }) => {
    const next = await readCanonical(essayId, asInstructor, requestedReviewId);
    if (!scopeIsCurrent(scope)) return null;
    applySnapshot(next);
    return next;
  };

  const lockForReadback = (tone: 'warning' | 'danger', message: string) => {
    setNeedsReconcile(true);
    setBanner({ tone, message: `${message} Chưa xác nhận được trạng thái canonical; hệ thống không tự gửi lại mutation.` });
  };

  const saveNote = async () => {
    if (!snapshot || pending || needsReconcile || !dirty) return;
    const scope = currentScope();
    const submitted = note;
    setPending('save');
    setBanner(null);
    try {
      const ack = await window.api.patch(
        instructorApiPath(`/instructor/essays/${encodeURIComponent(essayId)}/instructor-note`, asInstructor),
        instructorNotePayload(submitted),
      );
      if (!scopeIsCurrent(scope)) return;
      const next = await canonicalReadback(scope);
      if (!next) return;
      if (!normalizeInstructorNoteAck(ack, essayId, submitted) || next.essay.instructorNote !== submitted) {
        setBanner({ tone: 'warning', message: 'Yêu cầu lưu đã phản hồi nhưng dữ liệu canonical chưa khớp. Hãy kiểm tra lại trước khi trả bài.' });
      } else setBanner({ tone: 'success', message: 'Đã lưu và xác nhận nhận xét từ dữ liệu canonical.' });
    } catch (caught) {
      if (!scopeIsCurrent(scope)) return;
      try {
        const next = await canonicalReadback(scope);
        if (!next) return;
        setBanner(next.essay.instructorNote === submitted
          ? { tone: 'success', message: 'Nhận xét đã được lưu và xác nhận qua dữ liệu canonical.' }
          : { tone: 'danger', message: `${messageOf(caught)} Nhận xét chưa được lưu; hệ thống không tự gửi lại mutation.` });
      } catch {
        if (scopeIsCurrent(scope)) lockForReadback('danger', messageOf(caught));
      }
    } finally {
      if (scopeIsCurrent(scope)) setPending(null);
    }
  };

  const deliver = async () => {
    if (!snapshot?.review || pending || needsReconcile) return;
    const scope = currentScope();
    const submitted = note;
    const reviewId = snapshot.review.reviewId;
    setPending('deliver');
    setBanner(null);
    let noteConfirmed = false;
    try {
      try {
        const noteAck = await window.api.patch(
          instructorApiPath(`/instructor/essays/${encodeURIComponent(essayId)}/instructor-note`, asInstructor),
          instructorNotePayload(submitted),
        );
        noteConfirmed = normalizeInstructorNoteAck(noteAck, essayId, submitted);
      } catch {
        noteConfirmed = false;
      }
      if (!scopeIsCurrent(scope)) return;
      if (!noteConfirmed) {
        try {
          const reconciled = await canonicalReadback(scope);
          noteConfirmed = Boolean(reconciled && reconciled.essay.instructorNote === submitted);
        } catch {
          lockForReadback('danger', 'Không xác nhận được bước lưu nhận xét nên chưa gửi yêu cầu trả bài.');
          return;
        }
      }
      if (!noteConfirmed) {
        setBanner({ tone: 'danger', message: 'Nhận xét chưa được lưu canonical nên chưa trả bài. Hệ thống không tự gửi lại mutation.' });
        return;
      }

      let deliverError: unknown = null;
      let deliverAck = false;
      try {
        const ack = await window.api.post(
          instructorApiPath(`/instructor/reviews/${encodeURIComponent(reviewId)}/deliver`, asInstructor),
          instructorDeliveryPayload(essayId, submitted),
        );
        deliverAck = normalizeInstructorDeliverAck(ack, essayId, reviewId);
      } catch (caught) {
        deliverError = caught;
      }
      if (!scopeIsCurrent(scope)) return;
      try {
        const next = await canonicalReadback(scope);
        if (!next) return;
        if (next.essay.status === 'delivered') {
          setBanner({ tone: 'success', message: 'Đã trả bài và xác nhận trạng thái học viên nhìn thấy từ dữ liệu canonical.' });
        } else {
          setBanner({
            tone: deliverError ? 'danger' : 'warning',
            message: `${deliverError ? `${messageOf(deliverError)} ` : ''}${deliverAck ? 'Server đã ACK nhưng ' : ''}bài chưa ở trạng thái “đã trả”. Không mutation nào được gửi lại.`,
          });
        }
      } catch {
        lockForReadback(deliverError ? 'danger' : 'warning', deliverError ? messageOf(deliverError) : 'Yêu cầu trả bài đã được gửi.');
      }
    } finally {
      if (scopeIsCurrent(scope)) setPending(null);
    }
  };

  const regrade = async () => {
    if (!snapshot || pending || needsReconcile) return;
    const scope = currentScope();
    setPending('regrade');
    setConfirmation(null);
    setBanner(null);
    let mutationError: unknown = null;
    try {
      try {
        await window.api.post(
          instructorApiPath(`/instructor/essays/${encodeURIComponent(essayId)}/regrade`, asInstructor),
          {},
        );
      } catch (caught) { mutationError = caught; }
      if (!scopeIsCurrent(scope)) return;
      try {
        const next = await canonicalReadback(scope);
        if (!next) return;
        if (next.essay.status === 'grading') {
          setBanner({ tone: 'success', message: 'Đã xác nhận tác vụ chấm lại. AI đang tạo phiên bản mới; các phiên bản cũ được giữ nguyên.' });
        } else setBanner({ tone: mutationError ? 'danger' : 'warning', message: `${mutationError ? `${messageOf(mutationError)} ` : ''}Chưa thấy trạng thái “AI đang chấm”; hệ thống không tự gửi lại mutation.` });
      } catch {
        lockForReadback(mutationError ? 'danger' : 'warning', mutationError ? messageOf(mutationError) : 'Yêu cầu chấm lại đã được gửi.');
      }
    } finally {
      if (scopeIsCurrent(scope)) setPending(null);
    }
  };

  const revoke = async () => {
    if (!snapshot || pending || needsReconcile) return;
    const scope = currentScope();
    setPending('revoke');
    setConfirmation(null);
    setBanner(null);
    let mutationError: unknown = null;
    try {
      try {
        await window.api.post(
          instructorApiPath(`/instructor/essays/${encodeURIComponent(essayId)}/revoke-delivery`, asInstructor),
          {},
        );
      } catch (caught) { mutationError = caught; }
      if (!scopeIsCurrent(scope)) return;
      try {
        const next = await canonicalReadback(scope);
        if (!next) return;
        if (next.essay.status === 'reviewed') {
          setBanner({ tone: 'success', message: 'Đã thu hồi và xác nhận bài không còn hiển thị cho học viên.' });
        } else setBanner({ tone: mutationError ? 'danger' : 'warning', message: `${mutationError ? `${messageOf(mutationError)} ` : ''}Bài chưa ở trạng thái “đã nhận xét”; hệ thống không tự gửi lại mutation.` });
      } catch {
        lockForReadback(mutationError ? 'danger' : 'warning', mutationError ? messageOf(mutationError) : 'Yêu cầu thu hồi đã được gửi.');
      }
    } finally {
      if (scopeIsCurrent(scope)) setPending(null);
    }
  };

  const reconcile = async () => {
    if (pending || !essayId) return;
    const scope = currentScope();
    setPending('reconcile');
    try {
      const next = await canonicalReadback(scope);
      if (!next) return;
      setBanner({ tone: 'success', message: 'Đã đọc lại và xác nhận trạng thái canonical; có thể thao tác tiếp.' });
    } catch (caught) {
      if (scopeIsCurrent(scope)) setBanner({ tone: 'warning', message: `${messageOf(caught)} Vẫn chưa xác nhận được trạng thái; không mutation nào được gửi.` });
    } finally {
      if (scopeIsCurrent(scope)) setPending(null);
    }
  };

  const essay = snapshot?.essay;
  const feedback = essay?.feedback;
  const mistakes = Array.isArray(feedback?.feedbackJson?.mistakeAnalysis) ? feedback.feedbackJson.mistakeAnalysis : [];
  const reviewDeliverable = Boolean(snapshot?.review && ['claimed', 'edited'].includes(snapshot.review.status));
  const versionsKnown = Boolean(snapshot?.versions);
  const regradeAvailable = Boolean(snapshot?.versions
    && snapshot.versions.budget.liveCount < snapshot.versions.budget.max
    && essay && ['graded', 'reviewed', 'delivered', 'failed'].includes(essay.status)
    && !essay.isFlagged);
  const compareAvailable = Boolean(snapshot?.versions && snapshot.versions.versions.length >= 2);
  const compareHref = essayId ? instructorGradeCompareHref(essayId, asInstructor) : '/instructor/compare';

  return (
    <div className="ig-shell">
      <header className="ig-topbar">
        <a href="/instructor" className="ig-back"><ChevronLeft />Hàng chờ chấm</a>
        <div className="ig-top-student" id="ig-student">{essay?.student?.fullName || 'Chấm bài Writing'}</div>
        <div className="ig-band" id="ig-band">{feedback ? `Band ${feedback.overallBandScore}` : 'Band —'}</div>
      </header>

      <main className="ig-main">
        {asInstructor ? <div id="ig-imp" className="ig-banner is-warning" role="status">Đang xem như giảng viên <strong>{asInstructor}</strong>. Mọi hành động được backend ghi audit.</div> : null}
        {banner ? <div id="ig-banner" className={`ig-banner is-${banner.tone}`} role={banner.tone === 'success' ? 'status' : 'alert'}>{banner.message}</div> : <div id="ig-banner" />}

        {phase === 'loading' ? <div id="ig-loading" className="ig-state" role="status"><span className="ig-spinner" />Đang tải bài và dữ liệu chấm…</div> : null}
        {phase === 'denied' ? <div className="ig-state is-error" role="alert"><h1>Không có quyền truy cập</h1><p>Bạn không có quyền truy cập trang giảng viên.</p><a href="/home">Về trang học</a></div> : null}
        {phase === 'error' ? <div className="ig-state is-error" role="alert"><h1>Không mở được bài chấm</h1><p>{loadError}</p><a href="/instructor">Về workspace giảng viên</a></div> : null}

        {phase === 'ready' && snapshot && essay ? (
          <div id="ig-body">
            <section className="ig-hero" aria-labelledby="ig-title">
              <div>
                <p className="ig-eyebrow">Writing review workspace</p>
                <h1 id="ig-title">{essay.student.fullName}</h1>
                <p>{essay.student.studentCode || 'Chưa có mã học viên'} · {essay.taskType}{essay.student.targetBand != null ? ` · Mục tiêu ${essay.student.targetBand}` : ''}</p>
              </div>
              <span className={`ig-status is-${essay.status}`}>{STATUS_LABELS[essay.status] || essay.status}</span>
            </section>

            {needsReconcile ? (
              <div className="ig-reconcile" role="alert">
                <div><strong>Đang khóa mutation</strong><span>Trạng thái trước đó chưa được xác nhận. Chỉ đọc lại dữ liệu, không gửi lại thao tác ghi.</span></div>
                <button type="button" className="av-button av-button-primary ig-action" onClick={() => void reconcile()} disabled={!!pending}>{pending === 'reconcile' ? 'Đang đọc…' : 'Đọc lại trạng thái'}</button>
              </div>
            ) : null}

            <div className="ig-workspace">
              <aside className="ig-review-card" aria-labelledby="ig-note-title">
                <div className="ig-section-heading">
                  <div><p className="ig-step">Bước 1</p><h2 id="ig-note-title">Nhận xét giảng viên</h2></div>
                  <span className={dirty ? 'ig-dirty is-active' : 'ig-dirty'}>{dirty ? 'Chưa lưu' : 'Đã đồng bộ'}</span>
                </div>
                <p className="ig-help">Phần này hiển thị cho học viên và được lưu tách biệt với phản hồi AI.</p>
                <textarea
                  id="ig-comment"
                  className="ig-comment"
                  aria-label="Nhận xét cho học viên"
                  maxLength={5000}
                  rows={9}
                  value={note}
                  onChange={(event) => { setNote(event.target.value); setDirty(event.target.value !== essay.instructorNote); }}
                  disabled={!!pending || needsReconcile}
                  placeholder="Nêu điểm làm tốt, điều cần sửa và bước luyện tiếp theo…"
                />
                <div className="ig-note-meta"><span>{note.length}/5000</span><span>AI feedback không bị chỉnh sửa</span></div>
                <div className="ig-actions">
                  <button id="ig-save" type="button" className="av-button av-button-secondary ig-action" onClick={() => void saveNote()} disabled={!dirty || !!pending || needsReconcile}>{pending === 'save' ? 'Đang lưu…' : 'Lưu nhận xét'}</button>
                  <button id="ig-deliver" type="button" className="av-button av-button-primary ig-action" onClick={() => void deliver()} disabled={!reviewDeliverable || !!pending || needsReconcile}>{pending === 'deliver' ? 'Đang trả bài…' : 'Trả bài cho học viên'}</button>
                </div>
                {!snapshot.review && essay.status !== 'delivered' ? <p className="ig-inline-warning" role="alert">{snapshot.reviewMismatch ? 'review_id không khớp bài đang mở.' : snapshot.queueError ? 'Chưa xác nhận được review từ hàng chờ.' : 'Không có review đang hoạt động để trả bài.'}</p> : null}

                <div className="ig-divider" />
                <div className="ig-section-heading"><div><p className="ig-step">Công cụ</p><h2>Phiên bản và trạng thái</h2></div>{snapshot.versions ? <strong>{snapshot.versions.budget.liveCount}/{snapshot.versions.budget.max}</strong> : null}</div>
                {snapshot.versionsError ? <p className="ig-inline-warning" role="alert">Không xác định được ngân sách phiên bản: {snapshot.versionsError}</p> : null}
                <div className="ig-secondary-actions">
                  <button id="ig-regrade" type="button" className="av-button av-button-secondary ig-action" onClick={() => setConfirmation('regrade')} disabled={!regradeAvailable || !!pending || needsReconcile}>{essay.status === 'grading' ? 'AI đang chấm…' : 'Chấm lại bằng AI'}</button>
                  {compareAvailable ? <a id="ig-compare" className="av-button av-button-secondary ig-action" href={compareHref}>So sánh / Trộn phiên bản</a> : <span id="ig-compare" className="av-button av-button-secondary ig-action is-disabled" aria-disabled="true">{versionsKnown ? 'Cần ít nhất 2 phiên bản' : 'Chưa xác định phiên bản'}</span>}
                  <button id="ig-revoke" type="button" className="av-button av-button-destructive ig-action" hidden={essay.status !== 'delivered'} onClick={() => setConfirmation('revoke')} disabled={!!pending || needsReconcile}>Thu hồi bài đã trả</button>
                </div>
                {snapshot.versions && snapshot.versions.budget.liveCount >= snapshot.versions.budget.max ? <p className="ig-help">Đã đạt tối đa {snapshot.versions.budget.max} phiên bản. Có thể so sánh hoặc trộn các bản hiện có.</p> : null}
              </aside>

              <div className="ig-content">
                <section className="ig-card" aria-labelledby="ig-essay-title">
                  <div className="ig-section-heading"><div><p className="ig-step">Bước 2</p><h2 id="ig-essay-title">Bài viết của học viên</h2></div><span>{essay.taskType}</span></div>
                  <EssayText text={essay.essayText} mistakes={mistakes} />
                </section>
                <section className="ig-card" aria-labelledby="ig-ai-title">
                  <div className="ig-section-heading"><div><p className="ig-step">Bước 3</p><h2 id="ig-ai-title">Phân tích AI</h2></div><span className="ig-readonly">Chỉ đọc</span></div>
                  <FeedbackPreview feedback={feedback?.feedbackJson || null} />
                </section>
              </div>
            </div>
          </div>
        ) : null}
      </main>

      {confirmation ? <ConfirmDialog action={confirmation} pending={Boolean(pending)} onCancel={() => setConfirmation(null)} onConfirm={() => void (confirmation === 'regrade' ? regrade() : revoke())} /> : null}
    </div>
  );
}

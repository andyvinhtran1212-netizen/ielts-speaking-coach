'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';

import { useAuth } from '@/lib/auth/auth-provider';
import {
  WRITING_TASK_LABELS,
  classifyWritingResult,
  countWritingWords,
  formatWritingDate,
  regradeStatusText,
  selectWritingTips,
  writingBandLabel,
  writingTipPreview,
} from '@/lib/writing-result-model.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

type ResultView =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'flagged'; essay: any }
  | { kind: 'not-delivered'; essay: any }
  | { kind: 'ready'; essay: any; feedback: any; instructorNote: string; feedbackJson: any };

type Tip = { id: string; title?: string; body_markdown?: string; task_type?: string };
type TabKey = 'tongquan' | 'loi' | 'nangcao' | 'baimau' | 'note';

const TABS: Array<{ key: TabKey; icon: string; label: string }> = [
  { key: 'tongquan', icon: '📊', label: 'Ưu tiên' },
  { key: 'loi', icon: '❌', label: 'Lỗi cần sửa' },
  { key: 'nangcao', icon: '🔬', label: 'Phân tích sâu' },
  { key: 'baimau', icon: '📚', label: 'Bài tham khảo' },
  { key: 'note', icon: '💬', label: 'Giảng viên' },
];

const OPTIONAL_SECTIONS = new Set([
  'coherence', 'lexical', 'idea-development', 'sentence-structure', 'recurring', 'trajectory',
]);

function messageOf(caught: unknown) {
  return caught instanceof Error ? caught.message : String(caught || 'Lỗi tải bài viết.');
}

function isEmpty(value: unknown) {
  return value == null
    || (Array.isArray(value) && value.length === 0)
    || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);
}

function ChevronLeft() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function ActionIcon({ kind }: { kind: 'download' | 'print' | 'regrade' }) {
  const path = kind === 'download'
    ? <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></>
    : kind === 'print'
      ? <><path d="M6 9V3h12v6" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><path d="M6 14h12v7H6z" /></>
      : <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></>;
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">{path}</svg>;
}

function BackLink({ className = 'btn-link', children = 'Quay lại' }: { className?: string; children?: ReactNode }) {
  return <a href="/writing/dashboard" className={className}><ChevronLeft />{children}</a>;
}

export function WritingResultLoading() {
  return (
    <div id="state-loading" className="state-block" role="status">
      <div className="icon">
        <svg className="state-icon-spin" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 12a9 9 0 1 1-6.2-8.6" />
        </svg>
      </div>
      <p>Đang tải bài viết…</p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div id="state-error" className="state-block" role="alert">
      <div className="icon icon-error" aria-hidden="true">⚠</div>
      <h2>Không tải được bài viết</h2>
      <p id="error-message">{message || 'Có lỗi xảy ra. Vui lòng thử lại sau.'}</p>
      <BackLink />
    </div>
  );
}

function PendingState({ essay }: { essay: any }) {
  const instructor = String(essay?.grading_tier || 'standard').toLowerCase() === 'instructor';
  return (
    <div id="state-not-delivered" className="state-block" role="status">
      <div id="not-delivered-icon" className="icon" aria-hidden="true">{instructor ? '👤' : '⏳'}</div>
      <h2 id="not-delivered-title">{instructor ? 'Giảng viên đang review bài' : 'Bài đang được duyệt'}</h2>
      <p id="not-delivered-body">{instructor
        ? 'Bài của em đang được giảng viên review trực tiếp. Thời gian thường ~24–48 giờ. Em sẽ thấy feedback đầy đủ và tin nhắn từ giảng viên ngay tại đây khi xong.'
        : 'Giảng viên đang xem lại feedback. Em sẽ thấy kết quả khi bài được duyệt xong.'}</p>
      {instructor ? <p id="not-delivered-meta" className="not-delivered-meta">Đã nộp: {formatWritingDate(essay?.created_at)}</p> : null}
      <BackLink />
    </div>
  );
}

function FlaggedState({ essay }: { essay: any }) {
  return (
    <div id="state-flagged" className="state-block" role="alert">
      <div className="icon icon-flagged" aria-hidden="true">⚑</div>
      <h2>Bài viết bị đánh dấu cần xem xét</h2>
      <p id="flagged-message">{essay?.error_message || 'Bài viết bị đánh dấu cần giảng viên xem xét.'}</p>
      <BackLink />
    </div>
  );
}

function Section({
  sectionKey, title, value, hidden = false,
}: { sectionKey: string; title: string; value: unknown; hidden?: boolean }) {
  const html = useMemo(() => {
    const wr = (window as any).WritingRenderers;
    const renderer = wr?.SECTION_RENDERERS?.[sectionKey];
    try {
      return renderer ? renderer(value) : wr?.emptyShape?.() || '';
    } catch (caught) {
      console.error('[writing-result] renderer failed for', sectionKey, caught);
      return wr?.emptyShape?.('— Lỗi hiển thị section —') || '';
    }
  }, [sectionKey, value]);
  if (hidden) return null;
  return (
    <section id={`section-${sectionKey}`} className="grade-section">
      <header className="section-header"><h2>{title}</h2></header>
      <div className="section-content" id={`content-${sectionKey}`} dangerouslySetInnerHTML={{ __html: html }} />
    </section>
  );
}

function TabPanel({ active, panel, children }: { active: boolean; panel: TabKey; children: ReactNode }) {
  return (
    <div
      id={`panel-${panel}`}
      className={`tab-panel${active ? ' is-active' : ''}`}
      role="tabpanel"
      data-panel={panel}
      aria-labelledby={panel === 'note' ? 'tab-btn-note' : `tab-${panel}`}
    >
      {children}
    </div>
  );
}

function WritingResultReady({ view, essayId }: { view: Extract<ResultView, { kind: 'ready' }>; essayId: string }) {
  const { essay, feedback, feedbackJson: fj, instructorNote } = view;
  const [tab, setTab] = useState<TabKey>('tongquan');
  const [regradeRequest, setRegradeRequest] = useState<any>(undefined);
  const [regradeModal, setRegradeModal] = useState(false);
  const [reason, setReason] = useState('');
  const [regradeError, setRegradeError] = useState('');
  const [regradeSending, setRegradeSending] = useState(false);
  const [tips, setTips] = useState<Tip[]>([]);
  const [selectedTip, setSelectedTip] = useState<Tip | null>(null);
  const [downloading, setDownloading] = useState(false);
  const essayRef = useRef<HTMLPreElement>(null);
  const regradeSendingRef = useRef(false);
  const hasInstructorNote = Boolean(instructorNote?.trim());
  const hideScores = Boolean(essay.hide_subbands);
  const tier = String(essay.grading_tier || 'standard').toLowerCase();

  const sectionValue = (sectionKey: string) => {
    const dataKey = (window as any).WritingRenderers?.SECTION_KEYS?.[sectionKey];
    return dataKey ? fj[dataKey] : undefined;
  };
  const shouldHide = (sectionKey: string, value: unknown) =>
    (sectionKey === 'criteria' && hideScores)
    || (sectionKey === 'counterargument' && isEmpty(value))
    || (OPTIONAL_SECTIONS.has(sectionKey) && isEmpty(value));

  useEffect(() => {
    const el = essayRef.current;
    if (!el) return;
    const rawEssay = essay.essay_text || '—';
    const mistakes = fj.mistakeAnalysis;
    if ((window as any).WritingHighlight && essay.essay_text && Array.isArray(mistakes) && mistakes.length) {
      (window as any).WritingHighlight.render(el, rawEssay, mistakes);
    } else {
      el.textContent = rawEssay;
    }
  }, [essay.essay_text, fj.mistakeAnalysis]);

  useEffect(() => {
    document.title = hideScores
      ? 'Phân tích bài viết'
      : `Phân tích bài viết — Band ${feedback.overall_band_score ?? '—'}`;
    let dead = false;
    Promise.allSettled([
      window.api.get(`/api/writing/essays/${encodeURIComponent(essayId)}/regrade-request`),
      window.api.get('/api/writing/tips'),
    ]).then(([regrade, tipsResult]) => {
      if (dead) return;
      if (regrade.status === 'fulfilled') setRegradeRequest((regrade.value as any)?.request || null);
      if (tipsResult.status === 'fulfilled') {
        setTips(selectWritingTips((tipsResult.value as any)?.tips, essay.task_type));
      }
    });
    return () => { dead = true; };
  }, [essay.task_type, essayId, feedback.overall_band_score, hideScores]);

  const selectTab = (next: TabKey, focus = false) => {
    setTab(next);
    if (focus) requestAnimationFrame(() => document.getElementById(next === 'note' ? 'tab-btn-note' : `tab-${next}`)?.focus());
    const heading = document.querySelector('.feedback-column__heading');
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    heading?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  };

  const handleTabKey = (event: KeyboardEvent<HTMLButtonElement>, current: TabKey) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const visible = TABS.filter((item) => item.key !== 'note' || hasInstructorNote);
    const index = visible.findIndex((item) => item.key === current);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + visible.length) % visible.length;
    event.preventDefault();
    selectTab(visible[next].key, true);
  };

  const submitRegrade = async () => {
    if (regradeSendingRef.current) return;
    const trimmed = reason.trim();
    if (trimmed.length < 50) {
      setRegradeError('Vui lòng nhập tối thiểu 50 ký tự.');
      return;
    }
    regradeSendingRef.current = true;
    setRegradeSending(true);
    setRegradeError('');
    try {
      await window.api.post(`/api/writing/essays/${encodeURIComponent(essayId)}/regrade-request`, { reason: trimmed });
      setRegradeRequest({ status: 'pending' });
      setRegradeModal(false);
      setReason('');
    } catch (caught) {
      setRegradeError(messageOf(caught) || 'Không gửi được yêu cầu.');
    } finally {
      regradeSendingRef.current = false;
      setRegradeSending(false);
    }
  };

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const sb = window.getSupabase() as any;
      const session = (await sb.auth.getSession()).data.session;
      if (!session) {
        window.location.href = '/login.html';
        return;
      }
      const response = await fetch(`${window.api.base}/api/writing/my-essays/${encodeURIComponent(essayId)}/export.docx`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!response.ok) {
        let detail = '';
        try { detail = (await response.json()).detail || ''; } catch {}
        throw new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
      }
      const match = (response.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/);
      const filename = match?.[1] || `essay_${essayId}.docx`;
      const objectUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (caught) {
      console.error('[writing-result] download failed', caught);
      alert(`Lỗi tải file: ${messageOf(caught)}`);
    } finally {
      setDownloading(false);
    }
  };

  const openPromptImage = () => {
    if ((window as any).AvImageLightbox && essay.prompt_image_url) {
      (window as any).AvImageLightbox.open(essay.prompt_image_url, 'Hình đề Task 1 của bài viết');
    }
  };

  const renderMarkdown = (value: string) => (window as any).renderMarkdown?.(value) || '';
  const instructorHtml = hasInstructorNote
    ? (window as any).WritingRenderers.renderInstructorNote(instructorNote)
    : '';

  const section = (key: string, title: string) => {
    const value = sectionValue(key);
    return <Section sectionKey={key} title={title} value={value} hidden={shouldHide(key, value)} />;
  };

  useEffect(() => {
    const closeModals = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setRegradeModal(false);
      setSelectedTip(null);
    };
    document.addEventListener('keydown', closeModals);
    return () => document.removeEventListener('keydown', closeModals);
  }, []);

  return (
    <>
      <div id="state-ready">
        <header className="result-header">
          <div className="header-left">
            <BackLink className="back-link">Bài viết của tôi</BackLink>
            <p className="eyebrow" style={{ margin: 0 }}>Writing</p>
            <div className="essay-meta">
              <h1 id="prompt-title">{essay.prompt_text || '—'}</h1>
              <p className="meta-line">
                <span id="essay-task">{(WRITING_TASK_LABELS as Record<string, string>)[essay.task_type] || essay.task_type || '—'}</span>
                <span className="separator">·</span>
                <span id="essay-date">{formatWritingDate(essay.created_at)}</span>
                {!hideScores ? <><span className="separator">·</span><span id="band-display" className="band-display">{writingBandLabel(feedback, fj)}</span></> : null}
                {hideScores ? <span id="scores-hidden-note">Giảng viên chọn tập trung vào phản hồi định tính cho bài này (không hiển thị điểm band).</span> : null}
                {tier !== 'standard' ? <span id="tier-wrap"><span className="separator">·</span><span id="tier-badge" className={`tier-badge tier-${tier}`}>{tier.charAt(0).toUpperCase() + tier.slice(1)}</span></span> : null}
              </p>
            </div>
          </div>
          <div className="header-actions">
            <button id="btn-download" className="btn-icon" title="Tải file Word" disabled={downloading} onClick={handleDownload}>
              <ActionIcon kind="download" /> {downloading ? 'Đang tải...' : 'Tải .docx'}
            </button>
            <button id="btn-print" className="btn-icon" title="In bài viết" onClick={() => window.print()}><ActionIcon kind="print" /> In</button>
            {regradeRequest === null ? (
              <button id="btn-regrade-request" className="btn-icon" title="Yêu cầu giảng viên chấm lại bài này" onClick={() => { setRegradeError(''); setRegradeModal(true); }}>
                <ActionIcon kind="regrade" /> Yêu cầu chấm lại
              </button>
            ) : null}
            {regradeStatusText(regradeRequest) ? <span id="regrade-status" className="regrade-status">{regradeStatusText(regradeRequest)}</span> : null}
          </div>
        </header>

        <main className="result-content">
          <section className="review-intro" aria-labelledby="review-intro-title">
            <div><p className="review-intro__eyebrow">Lộ trình cải thiện</p><h2 id="review-intro-title">Tập trung vào điều tạo khác biệt cho bài tiếp theo</h2></div>
            <p>Đọc phần ưu tiên trước, đối chiếu trực tiếp với bài viết có đánh dấu lỗi, rồi mới đi sâu vào từng tiêu chí.</p>
          </section>
          <div className="review-workspace">
            <div className="feedback-column">
              <div className="feedback-column__heading"><div><span>Phản hồi học tập</span><h2>Nhận xét dành cho em</h2></div><p>Bắt đầu ở “Ưu tiên”, sau đó chuyển tới lỗi cần sửa.</p></div>
              <nav className="result-tabs" role="tablist" aria-label="Các phần nhận xét Writing">
                {TABS.filter((item) => item.key !== 'note' || hasInstructorNote).map((item) => (
                  <button
                    id={item.key === 'note' ? 'tab-btn-note' : `tab-${item.key}`}
                    className={`tab-btn${tab === item.key ? ' is-active' : ''}`}
                    role="tab"
                    data-tab={item.key}
                    aria-controls={`panel-${item.key}`}
                    aria-selected={tab === item.key}
                    tabIndex={tab === item.key ? 0 : -1}
                    key={item.key}
                    onClick={() => selectTab(item.key)}
                    onKeyDown={(event) => handleTabKey(event, item.key)}
                  ><span className="tab-icon">{item.icon}</span><span className="tab-label">{item.label}</span></button>
                ))}
              </nav>
              <TabPanel active={tab === 'tongquan'} panel="tongquan">
                {section('key-takeaways', '🎓 Key Takeaways')}{section('overview', '📊 Tổng quan')}{section('criteria', '🎯 4 tiêu chí IELTS')}{section('trajectory', '📈 Diễn biến band')}
              </TabPanel>
              <TabPanel active={tab === 'loi'} panel="loi">{section('mistakes', '❌ Lỗi sai')}{section('recurring', '🔁 Lỗi lặp lại')}</TabPanel>
              <TabPanel active={tab === 'nangcao'} panel="nangcao">
                {section('lexical', '📚 Từ vựng')}{section('sentence-structure', '🏗 Cấu trúc câu')}{section('coherence', '🧩 Coherence')}{section('idea-development', '💡 Idea Development')}{section('counterargument', '⚖ Counterargument')}
              </TabPanel>
              <TabPanel active={tab === 'baimau'} panel="baimau">{section('improved', '✨ Bài cải thiện (Band 8.0+)')}{section('ai-content', '🤖 AI Detection')}</TabPanel>
              {hasInstructorNote ? <TabPanel active={tab === 'note'} panel="note"><section id="section-instructor-note" className="grade-section"><header className="section-header"><h2>💬 Note từ giảng viên</h2></header><div className="section-content" dangerouslySetInnerHTML={{ __html: instructorHtml }} /></section></TabPanel> : null}
            </div>
            <aside className="essay-column" aria-label="Bài viết đã nộp">
              <section className="essay-section">
                <header className="section-header"><div><span className="essay-section__eyebrow">Đối chiếu bài làm</span><h2>📄 Bài viết của em</h2></div><span id="word-count" className="word-count">{countWritingWords(essay.essay_text)} từ</span></header>
                <p className="essay-section__hint">Các đoạn gạch chân là vị trí có nhận xét. Chọn vào đoạn để xem cách sửa.</p>
                <div id="prompt-box" className="prompt-box" />
                {essay.task_type === 'task1_academic' && essay.prompt_image_url ? <img id="prompt-image" className="prompt-chart-img" role="button" tabIndex={0} src={essay.prompt_image_url} alt="Hình đề Task 1 của bài viết" onClick={openPromptImage} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openPromptImage(); } }} /> : null}
                <pre id="essay-text" ref={essayRef} className="essay-original">—</pre>
              </section>
            </aside>
          </div>
        </main>
        {tips.length ? <section id="tips-reco" className="tips-reco"><header className="section-header"><h2>💡 Mẹo viết liên quan</h2></header><div id="tips-reco-list" className="tips-reco__list">{tips.map((tip) => <button type="button" className="tips-reco__card" data-tip-id={tip.id} key={tip.id} onClick={() => setSelectedTip(tip)}><span className="tips-reco__card-title">{tip.title || '(Mẹo viết)'}</span><span className="tips-reco__card-preview">{writingTipPreview(tip.body_markdown)}</span></button>)}</div></section> : null}
      </div>

      {regradeModal ? <div id="regrade-modal" className="wr-modal" role="dialog" aria-modal="true" aria-labelledby="regrade-modal-title"><div id="regrade-modal-backdrop" className="wr-modal__backdrop" onClick={() => setRegradeModal(false)} /><div className="wr-modal__panel"><h2 id="regrade-modal-title" className="wr-modal__title">Yêu cầu chấm lại</h2><p className="wr-modal__hint">Có gì chưa hài lòng với bài chấm? Em nêu rõ lý do để giảng viên xem lại (50–500 ký tự).</p><p className="wr-modal__hint">Giảng viên sẽ xem lại yêu cầu — có thể chấm lại bằng AI hoặc chấm tay, thường trong vài ngày. Sau khi chấm lại, band có thể <strong>tăng, giữ nguyên, hoặc giảm</strong>.</p><textarea id="regrade-reason" autoFocus className="wr-modal__textarea" rows={5} maxLength={500} placeholder="VD: Em nghĩ phần Task Response chưa được đánh giá đúng vì…" value={reason} onChange={(event) => setReason(event.target.value)} /><div className="wr-modal__meta"><span id="regrade-count">{reason.length}</span> / 500 · tối thiểu 50</div>{regradeError ? <div id="regrade-error" className="wr-modal__error">{regradeError}</div> : null}<div className="wr-modal__actions"><button id="regrade-cancel" type="button" className="btn-icon" onClick={() => setRegradeModal(false)}>Hủy</button><button id="regrade-submit" type="button" className="btn-icon btn-icon--primary" disabled={reason.trim().length < 50 || regradeSending} onClick={submitRegrade}>Gửi yêu cầu</button></div></div></div> : null}
      {selectedTip ? <div id="tip-reco-modal" className="wr-modal" role="dialog" aria-modal="true" aria-labelledby="tip-reco-title"><div id="tip-reco-backdrop" className="wr-modal__backdrop" onClick={() => setSelectedTip(null)} /><div className="wr-modal__panel wr-modal__panel--wide"><button id="tip-reco-close" type="button" className="wr-modal__close" aria-label="Đóng" onClick={() => setSelectedTip(null)}>✕</button><h2 id="tip-reco-title" className="wr-modal__title">{selectedTip.title || ''}</h2><div id="tip-reco-body" className="md-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(selectedTip.body_markdown || '') }} /></div></div> : null}
    </>
  );
}

export function WritingResultBehavior() {
  const params = useSearchParams();
  const essayId = params?.get('essay_id') || params?.get('id') || '';
  const { status, user } = useAuth();
  const [view, setView] = useState<ResultView>({ kind: 'loading' });
  const loadedKeyRef = useRef('');

  const accountKey = status === 'signed-in' && user?.id ? user.id : '';

  useEffect(() => {
    if (status === 'signed-out') window.location.replace('/login.html');
  }, [status]);

  useEffect(() => {
    if (!accountKey) return;
    const requestKey = `${accountKey}:${essayId}`;
    if (loadedKeyRef.current === requestKey) return;
    loadedKeyRef.current = requestKey;
    setView({ kind: 'loading' });
    if (!essayId) {
      setView({ kind: 'error', message: 'Thiếu mã bài viết trong URL.' });
      return;
    }
    let dead = false;
    (async () => {
      const globalsReady = await whenGlobalReady(
        () => typeof window.api?.get === 'function' && Boolean((window as any).WritingRenderers),
        'window.api + WritingRenderers (writing result)',
      );
      if (!globalsReady || dead) return;
      try {
        const payload = await window.api.get(`/api/writing/my-essays/${encodeURIComponent(essayId)}`);
        if (dead || !payload) return;
        setView(classifyWritingResult(payload) as ResultView);
      } catch (caught) {
        if (!dead) setView({ kind: 'error', message: messageOf(caught) });
      }
    })();
    return () => { dead = true; };
  }, [accountKey, essayId]);

  // Never keep the previous account's essay visible while auth is refreshing
  // or after sign-out. The redirect effect handles navigation; this guard
  // closes the render-time privacy gap before that effect runs.
  if (!accountKey || view.kind === 'loading') return <WritingResultLoading />;
  if (view.kind === 'error') return <ErrorState message={view.message} />;
  if (view.kind === 'flagged') return <FlaggedState essay={view.essay} />;
  if (view.kind === 'not-delivered') return <PendingState essay={view.essay} />;
  return <WritingResultReady view={view} essayId={essayId} />;
}

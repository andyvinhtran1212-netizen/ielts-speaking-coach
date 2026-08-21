'use client';

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import {
  listeningBandLabel,
  listeningReviewBackTarget,
  listeningReviewParams,
  listeningReviewSection,
  listeningSkillsToPractise,
  listeningTranscriptParagraphs,
  normalizeListeningReview,
} from '@/lib/listening-review-model.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

type Phase = 'loading' | 'ready' | 'empty' | 'error';
type Filter = 'wrong' | 'all' | 'correct';
type AudioPlayerElement = HTMLElement & { seekTo?(seconds: number): void };

const K_LABELS: Record<string, string> = {
  K1: 'Nghe số / ngày / đánh vần (numbers, dates, spelling, prices, phone)',
  K2: 'Nhận diện paraphrase (synonym / đổi cấu trúc câu)',
  K3: 'Bám signpost / chuyển ý (however, actually, in fact)',
  K4: 'Theo dõi self-correction & number-correction (nói rồi sửa)',
  K5: 'Phân biệt detail vs gist (chi tiết vs ý chính)',
  K6: 'Suy luận / hàm ý (inference)',
  K7: 'Thái độ / quan điểm / cảm xúc người nói (attitude / opinion)',
  K8: 'Map / không gian (vị trí, hướng, plan labelling)',
};

function statusOf(error: unknown) {
  return Number((error as { status?: unknown })?.status || 0);
}

function clock(raw: unknown) {
  const seconds = Math.max(0, Math.floor(Number(raw) || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function hasVietnamese(value: unknown) {
  return /[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i
    .test(String(value ?? ''));
}

function inlineNodes(value: unknown): ReactNode[] {
  return String(value ?? '').split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*\n]+\*)/g).filter(Boolean)
    .map((part, index) => {
      if (part.startsWith('`') && part.endsWith('`')) {
        return <code className="lr-code" key={`${index}-${part}`}>{part.slice(1, -1)}</code>;
      }
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={`${index}-${part}`}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('*') && part.endsWith('*')) {
        return <em key={`${index}-${part}`}>{part.slice(1, -1)}</em>;
      }
      return <span key={`${index}-${part}`}>{part}</span>;
    });
}

function bulletRows(value: unknown) {
  return String(value ?? '').split(/\n+|;\s+/).map((row) => row.trim().replace(/^[-•]\s*/, '')).filter(Boolean);
}

function SolutionSection({ label, className = '', children }: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  if (children === null || children === undefined || children === '') return null;
  return <section className={`lr-sol__sec ${className}`.trim()}>
    <div className="lr-sol__label">{label}</div>
    <div className="lr-sol__text">{children}</div>
  </section>;
}

function WhyCorrect({ value }: { value: unknown }) {
  const paragraphs = String(value ?? '').replace(/```/g, '')
    .replace(/_\(From answer key notes\):_/gi, '').trim()
    .split(/\n\s*\n/).map((row) => row.trim()).filter(Boolean);
  if (!paragraphs.length) return null;
  return <>{paragraphs.map((paragraph, index) => {
    const vi = hasVietnamese(paragraph);
    const rows = bulletRows(paragraph);
    return <div className={`lr-why lr-why--${vi ? 'vi' : 'en'}`} key={`${index}-${paragraph}`}>
      <span className="lr-why__lang">{vi ? 'VN' : 'EN'}</span>
      {rows.length > 1
        ? <ul className="lr-sol__bullets">{rows.map((row) => <li key={row}>{inlineNodes(row)}</li>)}</ul>
        : inlineNodes(paragraph)}
    </div>;
  })}</>;
}

function speakerMap(raw: string) {
  const codes: string[] = [];
  for (const line of raw.split(/\n/)) {
    const match = /^\s*\[([^\]]+)\]\s*$/.exec(line.trim());
    if (match && /^[MF]\b/.test(match[1]) && !codes.includes(match[1])) codes.push(match[1]);
  }
  const groups: Record<string, string[]> = { Man: [], Woman: [] };
  codes.forEach((code) => groups[code.startsWith('F') ? 'Woman' : 'Man'].push(code));
  const map: Record<string, string> = {};
  Object.entries(groups).forEach(([gender, values]) => values.forEach((code, index) => {
    map[code] = values.length > 1 ? `${gender} ${index + 1}` : gender;
  }));
  return map;
}

function ScriptBlock({ value }: { value: unknown }) {
  const source = String(value ?? '').replace(/```/g, '').trim();
  const speakers = speakerMap(source);
  const rows = source.split(/\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const only = /^\[([^\]]+)\]$/.exec(line);
    if (only && speakers[only[1]]) return { speaker: speakers[only[1]], parts: [] as ReactNode[] };
    const stripped = line.replace(/\[(?!stress:)[^\]]*\]/g, '').replace(/\s{2,}/g, ' ').trim();
    const parts = stripped.split(/(\[stress:[^\]]+\]|\(Q\d+\))/g).filter(Boolean).map((part, index) => {
      const stress = /^\[stress:([^\]]+)\]$/.exec(part);
      if (stress) return <strong className="lr-stress" key={`${index}-${part}`}>{stress[1].trim()}</strong>;
      if (/^\(Q\d+\)$/.test(part)) return <span className="lr-qmark" key={`${index}-${part}`}>{part}</span>;
      return <span key={`${index}-${part}`}>{part}</span>;
    });
    return { speaker: '', parts };
  });
  return <>{rows.map((row, index) => row.speaker
    ? <span className="lr-tx-speaker" key={`${index}-${row.speaker}`}>{row.speaker}:</span>
    : <span className="lr-tx-text" key={index}>{row.parts}{' '}</span>)}</>;
}

function FeedbackCardBridge({ cardRef, topRef, item, attemptId, preview }: {
  cardRef: React.RefObject<HTMLElement | null>;
  topRef: React.RefObject<HTMLDivElement | null>;
  item: any;
  attemptId: string | null;
  preview: boolean;
}) {
  useEffect(() => {
    if (preview || !attemptId) return;
    let disposed = false;
    void whenGlobalReady(
      () => typeof (window as any).AverFeedback?.attachCardFlag === 'function',
      'AverFeedback (Listening review card)',
    ).then((ready) => {
      if (!disposed && ready && cardRef.current && topRef.current) {
        (window as any).AverFeedback.attachCardFlag({
          card: cardRef.current,
          top: topRef.current,
          skill: 'listening',
          attemptId,
          qNum: item.q_num,
          anonId: null,
        });
      }
    });
    return () => { disposed = true; };
  }, [attemptId, cardRef, item.q_num, preview, topRef]);
  return null;
}

function QuestionCard({ item, expanded, preview, attemptId, onToggle, onLocate }: {
  item: any;
  expanded: boolean;
  preview: boolean;
  attemptId: string | null;
  onToggle(): void;
  onLocate(): void;
}) {
  const cardRef = useRef<HTMLElement | null>(null);
  const topRef = useRef<HTMLDivElement | null>(null);
  const solution = item.solution || {};
  const vocab = bulletRows(solution.vocab_focus || solution.vocab);
  const hasSolutionDetail = Boolean(solution.translation_vi || vocab.length || solution.paraphrase
    || solution.why_correct || solution.script || solution.trap);
  const win = item.audio_window;
  const timestamp = win
    ? `${win.section ? `${win.section} · ` : ''}${clock(win.start)}–${clock(win.end)}`
    : '';
  const keyToggle = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.key === 'Enter' || event.key === ' ') && !(event.target as HTMLElement).closest('button')) {
      event.preventDefault();
      onToggle();
    }
  };

  return <article
    ref={cardRef}
    id={`listening-review-q-${item.q_num}`}
    className={`lr-card ${item.correct ? 'is-correct' : 'is-incorrect'}${expanded ? ' is-open' : ''}`}
    data-q={item.q_num}
    data-correct={item.correct ? 'true' : 'false'}
  >
    <FeedbackCardBridge cardRef={cardRef} topRef={topRef} item={item} attemptId={attemptId} preview={preview} />
    <div
      ref={topRef}
      className="lr-card__top"
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onClick={(event) => {
        if (!(event.target as HTMLElement).closest('button, a')) onToggle();
      }}
      onKeyDown={keyToggle}
    >
      <span className="lr-card__num">Câu {item.q_num}</span>
      {!preview ? <span className="lr-card__verdict">{item.correct ? '✓ Đúng' : '✗ Sai'}</span> : null}
      <span className="lr-card__toggle">{expanded ? 'Ẩn lời giải' : 'Xem lời giải'} ▸</span>
    </div>
    {item.prompt ? <div className="lr-card__prompt">{inlineNodes(item.prompt)}</div> : null}
    <div className="lr-card__answers">
      {!preview ? <div className="lr-card__ans is-user"><span>Bạn:</span> <code>{item.user_answer || '—'}</code></div> : null}
      <div className="lr-card__ans is-correct"><span>Đáp án:</span> <code>{item.expected || '—'}</code></div>
    </div>
    {win ? <div className="lr-card__tsrow"><button type="button" className="lr-card__ts" onClick={onLocate}>🔊 {timestamp}</button></div> : null}
    <div className="lr-card__detail" hidden={!expanded}>
      {hasSolutionDetail ? <>
        <SolutionSection label="Dịch đoạn chứa đáp án">{solution.translation_vi ? <p>{inlineNodes(solution.translation_vi)}</p> : null}</SolutionSection>
        <SolutionSection label="Từ vựng">{vocab.length ? <ul className="lr-sol__bullets">{vocab.map((row) => <li key={row}>{inlineNodes(row)}</li>)}</ul> : null}</SolutionSection>
        <SolutionSection label="Paraphrase">{solution.paraphrase ? <p>{inlineNodes(solution.paraphrase)}</p> : null}</SolutionSection>
        <SolutionSection label="Vì sao đúng">{solution.why_correct ? <WhyCorrect value={solution.why_correct} /> : null}</SolutionSection>
        <SolutionSection label="Script" className="lr-sol__sec--script">{solution.script ? <p><ScriptBlock value={solution.script} /></p> : null}</SolutionSection>
        <SolutionSection label="Bẫy" className="lr-sol__sec--trap">{solution.trap ? <p>{inlineNodes(solution.trap)}</p> : null}</SolutionSection>
      </> : <p className="lr-sol__empty">Chưa có lời giải chi tiết.</p>}
    </div>
  </article>;
}

function TranscriptPane({ sections, activeSection, activeAnchor, onSection }: {
  sections: any[];
  activeSection: number;
  activeAnchor: number | null;
  onSection(section: number): void;
}) {
  const section = sections.find((row) => row.section_num === activeSection) || sections[0];
  const paragraphs = useMemo(() => listeningTranscriptParagraphs(section?.transcript), [section?.transcript]);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (activeAnchor === null) return;
    bodyRef.current?.querySelector<HTMLElement>(`[data-para="${activeAnchor}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeAnchor, activeSection]);
  return <section className="exam-passage" id="lr-transcript-pane" aria-label="Transcript">
    <div className="lr-section-tabs" role="tablist" aria-label="Chọn section">{sections.map((row) => <button
      type="button"
      role="tab"
      aria-selected={row.section_num === activeSection}
      className={`lr-section-tab${row.section_num === activeSection ? ' is-active' : ''}`}
      onClick={() => onSection(row.section_num)}
      key={row.section_num}
    >Section {row.section_num}</button>)}</div>
    <h2 className="lr-transcript__title">Section {section?.section_num || activeSection}{section?.theme ? ` — ${section.theme}` : ''}</h2>
    <div ref={bodyRef} className="lr-transcript__body md-body">
      {paragraphs.length ? paragraphs.map((paragraph, index) => <p
        className={`lr-tx-line${activeAnchor === index ? ' lr-src-hl' : ''}`}
        data-para={index}
        key={`${index}-${paragraph.speaker}-${paragraph.text}`}
      >{paragraph.speaker ? <span className="lr-tx-speaker">{paragraph.speaker}:</span> : null}<span className="lr-tx-text">{paragraph.text}</span></p>)
        : <p className="lr-tx-empty">Chưa có transcript cho section này.</p>}
    </div>
  </section>;
}

export function ListeningReviewWorkspace() {
  const { status, user } = useAuth();
  const [params, setParams] = useState<ReturnType<typeof listeningReviewParams> | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState<{ ownerKey: string; data: any } | null>(null);
  const [activeSection, setActiveSection] = useState(1);
  const [activeAnchor, setActiveAnchor] = useState<number | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [filter, setFilter] = useState<Filter>('all');
  const audioRef = useRef<AudioPlayerElement | null>(null);
  const surveyRef = useRef<HTMLDivElement | null>(null);
  const requestRef = useRef(0);

  useEffect(() => { setParams(listeningReviewParams(window.location.search)); }, []);
  useEffect(() => {
    const previous = document.body.dataset.textSize;
    document.body.dataset.textSize = 'medium';
    return () => {
      if (previous === undefined) delete document.body.dataset.textSize;
      else document.body.dataset.textSize = previous;
    };
  }, []);

  const ownerKey = params
    ? `${params.adminTestId || params.attemptId || 'missing'}:user:${user?.id || 'none'}`
    : null;
  const data = snapshot && snapshot.ownerKey === ownerKey ? snapshot.data : null;
  const back = useMemo(() => listeningReviewBackTarget(params), [params]);

  useEffect(() => {
    if (!params) return;
    if (!params.attemptId && !params.adminTestId) {
      setSnapshot(null);
      setPhase('empty');
      return;
    }
    if (status === 'initial-loading') return;
    if (status === 'signed-out') {
      setSnapshot(null);
      window.location.replace('/login');
      return;
    }

    const requestId = ++requestRef.current;
    const controller = new AbortController();
    setSnapshot(null);
    setExpanded(new Set());
    setActiveAnchor(null);
    setError('');
    setPhase('loading');
    void (async () => {
      try {
        const ready = await whenGlobalReady(() => Boolean(window.api?.getWith), 'window.api (Listening review)');
        if (!ready) throw new Error('Không thể kết nối lớp dữ liệu.');
        const path = params.adminTestId
          ? `/admin/listening/tests/${encodeURIComponent(params.adminTestId)}/preview`
          : `/api/listening/tests/attempts/${encodeURIComponent(params.attemptId!)}/review`;
        const raw = await window.api.getWith(path, undefined, { noRedirect: true, signal: controller.signal });
        const normalized = normalizeListeningReview(raw);
        if (requestRef.current !== requestId || controller.signal.aborted) return;
        if (!params.adminTestId && normalized.attemptId !== params.attemptId) {
          throw new Error('Mã bài làm trong phản hồi không khớp yêu cầu.');
        }
        if (!normalized.review.length || !normalized.sections.length) {
          setPhase('empty');
          return;
        }
        const wrong = normalized.review.filter((item: any) => !item.correct).length;
        setSnapshot({ ownerKey: ownerKey!, data: normalized });
        setActiveSection(normalized.sections[0].section_num);
        setCurrentQuestion(normalized.review[0].q_num);
        setFilter(normalized.preview ? 'all' : (wrong ? 'wrong' : 'all'));
        setPhase('ready');
      } catch (caught) {
        if (requestRef.current !== requestId || controller.signal.aborted) return;
        const code = statusOf(caught);
        if (code === 401) { window.location.replace('/login'); return; }
        if (code === 404) { setPhase('empty'); return; }
        if (code === 409) setError('Bài làm này chưa nộp — chưa có chữa bài. Hãy hoàn thành và nộp bài trước.');
        else if (code === 403) setError('Bài làm này không thuộc tài khoản của bạn hoặc kết quả vẫn đang chờ duyệt.');
        else setError('Không tải được chữa bài. Vui lòng thử lại.');
        setPhase('error');
      }
    })();
    return () => controller.abort();
  }, [ownerKey, params, status, user?.id]);

  useEffect(() => {
    document.body.classList.toggle('is-exam-preview', Boolean(data?.preview));
    return () => document.body.classList.remove('is-exam-preview');
  }, [data?.preview]);

  useEffect(() => {
    const host = surveyRef.current;
    if (!host || !data?.attemptId || data.preview) return;
    let disposed = false;
    void whenGlobalReady(
      () => typeof (window as any).AverFeedback?.mountSurvey === 'function',
      'AverFeedback (Listening review survey)',
    ).then((ready) => {
      if (!disposed && ready && surveyRef.current) {
        (window as any).AverFeedback.mountSurvey(surveyRef.current, {
          skill: 'listening', attemptId: data.attemptId, hasAudio: true,
          anonId: null, qNums: data.review.map((item: any) => item.q_num),
        });
      }
    });
    return () => { disposed = true; };
  }, [data]);

  const wrongCount = data?.review.filter((item: any) => !item.correct).length || 0;
  const skills = useMemo(() => listeningSkillsToPractise(data?.review, K_LABELS), [data]);
  const visibleItems = useMemo(() => (data?.review || []).filter((item: any) => (
    filter === 'wrong' ? !item.correct : filter === 'correct' ? item.correct : true
  )), [data, filter]);

  const locate = useCallback((item: any) => {
    const win = item.audio_window;
    if (!win) return;
    const section = listeningReviewSection(item);
    if (section && data?.sections.some((row: any) => row.section_num === section)) setActiveSection(section);
    setActiveAnchor(item.transcript_anchor);
    setCurrentQuestion(item.q_num);
    audioRef.current?.removeAttribute('segment-start');
    audioRef.current?.removeAttribute('segment-end');
    audioRef.current?.seekTo?.(win.start);
  }, [data]);

  const jump = useCallback((item: any) => {
    if (filter !== 'all' && ((filter === 'wrong') === item.correct)) setFilter('all');
    setCurrentQuestion(item.q_num);
    setExpanded((previous) => new Set(previous).add(item.q_num));
    requestAnimationFrame(() => document.getElementById(`listening-review-q-${item.q_num}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }, [filter]);

  return <>
    <header className="exam-topbar lr-topbar" role="banner">
      <div className="lr-topbar__left"><a className="lr-back" href={back.href}>{back.label}</a><span className="lr-test-label">{data?.title || 'Chữa bài'}</span></div>
      <div className="lr-topbar__right">
        {data?.preview ? <p className="lr-preview-banner" role="status">XEM TRƯỚC — chưa ai làm bài này. Ô trả lời để trống và không có điểm; đáp án + giải thích là thật.</p> : null}
        {data && !data.preview ? <div className="lr-summary" aria-live="polite"><span>{listeningBandLabel(data)}</span><span>Đúng {data.score}/{data.maxScore}</span></div> : null}
      </div>
    </header>

    {phase === 'loading' ? <main className="exam-state-shell"><p className="exam-state-msg" role="status">Đang tải chữa bài…</p></main> : null}
    {phase === 'empty' ? <main className="exam-state-shell"><p className="exam-state-msg">Không tìm thấy bài làm để chữa.</p></main> : null}
    {phase === 'error' ? <main className="exam-state-shell"><div className="listening-review-next-error" role="alert"><p className="exam-state-msg exam-state-msg--error">{error}</p><a href={back.href}>{back.label}</a></div></main> : null}

    {phase === 'ready' && data ? <>
      <main className="exam-split">
        <TranscriptPane sections={data.sections} activeSection={activeSection} activeAnchor={activeAnchor} onSection={(section) => { setActiveSection(section); setActiveAnchor(null); }} />
        <div className="exam-divider" aria-hidden="true" />
        <section className="exam-questions lr-review-pane" aria-label="Chữa từng câu">
          <header className="lr-review-header"><div><p className="lr-review-header__eyebrow">KIỂM TRA ĐÁP ÁN</p><h1>Chữa từng câu</h1><p className="lr-review-header__copy">
            {data.preview
              ? `${data.review.length} câu trong đề · Xem đáp án, transcript và lời giải trước khi xuất bản.`
              : `${wrongCount} câu cần xem lại · ${data.review.length - wrongCount} câu đúng. ${wrongCount ? 'Bắt đầu từ các câu sai, nghe lại rồi mở lời giải.' : 'Bạn đã trả lời đúng toàn bộ bài này.'}`}
          </p></div>{!data.preview ? <div className="lr-filter" role="group" aria-label="Lọc kết quả câu hỏi">{([
            ['wrong', 'Cần xem lại'], ['all', 'Tất cả'], ['correct', 'Đúng'],
          ] as [Filter, string][]).map(([value, label]) => <button type="button" className={`lr-filter__button${filter === value ? ' is-active' : ''}`} aria-pressed={filter === value} onClick={() => setFilter(value)} key={value}>{label}</button>)}</div> : null}</header>
          <div className="lr-review">
            {!data.preview ? <div className="exam-review-guide" aria-label="Cách chữa bài hiệu quả"><span><b>1</b>Nghe lại đúng đoạn</span><span><b>2</b>Đối chiếu transcript</span><span><b>3</b>Phân tích paraphrase</span></div> : null}
            {skills.length && filter !== 'correct' && !data.preview ? <section className="lr-skills-panel" aria-label="Kĩ năng cần luyện"><h3 className="lr-skills-panel__title">🎯 Kĩ năng cần luyện</h3><p className="lr-skills-panel__sub">Tổng hợp từ các câu sai — ưu tiên luyện kĩ năng xuất hiện nhiều nhất.</p><div className="lr-skills-panel__chips">{skills.map((skill) => <span className="lr-skill-chip" title={skill.label} key={skill.code}><span className="lr-skill-chip__code">{skill.code}</span>{skill.label}<span className="lr-skill-chip__count">×{skill.count}</span></span>)}</div><a className="lr-skills-panel__cta" href="/listening">Luyện nghe thêm →</a></section> : null}
            <div ref={surveyRef} />
            {visibleItems.map((item: any) => <QuestionCard
              item={item}
              expanded={expanded.has(item.q_num)}
              preview={data.preview}
              attemptId={data.attemptId}
              onToggle={() => setExpanded((previous) => {
                const next = new Set(previous);
                if (next.has(item.q_num)) next.delete(item.q_num); else next.add(item.q_num);
                return next;
              })}
              onLocate={() => locate(item)}
              key={item.q_num}
            />)}
          </div>
        </section>
      </main>
      <footer className="lr-bottombar" role="navigation" aria-label="Phát lại + chọn câu">
        <div className="lr-bottombar__player"><audio-player ref={(node) => { audioRef.current = node as AudioPlayerElement | null; }} compact="" src={data.audioUrl || undefined} duration-hint={data.audioDuration || undefined} /></div>
        <span className="lr-player-label">Bấm mốc thời gian ở mỗi câu để nghe lại đúng đoạn đáp án</span>
        <div className="lr-palette-strip" role="group" aria-label={`${data.review.length} câu — chọn để chữa`}>{data.review.map((item: any, index: number) => {
          const section = listeningReviewSection(item);
          const previousSection = index ? listeningReviewSection(data.review[index - 1]) : null;
          return <Fragment key={item.q_num}>{index > 0 && section !== null && section !== previousSection ? <span className="lr-palette-sep" aria-hidden="true" /> : null}<button
            type="button"
            className={`lr-nav-q${data.preview ? '' : ` ${item.correct ? 'is-correct' : 'is-incorrect'}`}${currentQuestion === item.q_num ? ' is-current' : ''}`}
            aria-current={currentQuestion === item.q_num ? 'true' : undefined}
            aria-label={`Câu ${item.q_num}${data.preview ? ' — xem trước' : ` — ${item.correct ? 'đúng' : 'sai'}`}`}
            onClick={() => jump(item)}
          >{item.q_num}</button></Fragment>;
        })}</div>
      </footer>
    </> : null}
  </>;
}

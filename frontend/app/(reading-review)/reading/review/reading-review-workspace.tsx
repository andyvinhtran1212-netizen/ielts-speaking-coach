'use client';

import {
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
  grammarKnowledgeHref,
  normalizeReadingReview,
  readingReviewBackTarget,
  readingReviewParams,
  readingReviewPrompt,
  readingReviewSkillRows,
  splitReviewProse,
  splitReviewSteps,
} from '@/lib/reading-review-model.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

type Phase = 'loading' | 'ready' | 'empty' | 'error';
type PassageMode = 'original' | 'translation';
type ReviewFilter = 'wrong' | 'all' | 'correct';

const SKILL_LABELS: Record<string, string> = {
  skimming: 'Đọc lướt ý chính',
  scanning: 'Định vị thông tin',
  detail: 'Chi tiết / số liệu',
  main_idea: 'Ý chính',
  inference: 'Suy luận',
  vocabulary_in_context: 'Từ vựng theo ngữ cảnh',
  reference_cohesion: 'Liên kết & tham chiếu',
  writer_view_TFNG: 'Quan điểm tác giả (T/F/NG)',
};

const STEP_LABELS: Record<string, string> = {
  locate: 'Định vị thông tin',
  decode_vocab: 'Giải mã từ vựng',
  parse_syntax: 'Phân tích cấu trúc câu',
  eliminate: 'Loại đáp án nhiễu',
  infer: 'Suy luận',
  confirm: 'Chốt đáp án',
};

const KP_ICONS: Record<string, string> = { grammar: '📘', vocab: '📗', skill: '🎯' };

function statusOf(error: unknown) {
  return Number((error as { status?: unknown })?.status || 0);
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error || '');
}

function hasStructuredStepper(stepper: any) {
  if (!stepper || !Array.isArray(stepper.steps) || !stepper.steps.length) return false;
  if (stepper.steps.length > 1) return true;
  const step = stepper.steps[0];
  return (step.action && step.action !== 'confirm')
    || (Array.isArray(step.kp_refs) && step.kp_refs.length > 0)
    || step.microcheck != null;
}

function proseNodes(value: unknown): ReactNode[] {
  return String(value ?? '').split(/(`[^`]+`|["“][^"”]+["”]|'[^']+')/g).filter(Boolean).map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code className="rr-code" key={`${index}-${part}`}>{part.slice(1, -1)}</code>;
    }
    if ((part.startsWith('"') && part.endsWith('"'))
        || (part.startsWith('“') && part.endsWith('”'))
        || (part.startsWith("'") && part.endsWith("'"))) {
      return <strong key={`${index}-${part}`}>{part}</strong>;
    }
    return <span key={`${index}-${part}`}>{part}</span>;
  });
}

function useMarkdown(markdown: string) {
  const [html, setHtml] = useState('');
  useEffect(() => {
    let disposed = false;
    setHtml('');
    void whenGlobalReady(
      () => typeof window.renderMarkdown === 'function',
      'window.renderMarkdown (Reading review)',
    ).then((ready) => {
      if (!disposed && ready && window.renderMarkdown) {
        setHtml(window.renderMarkdown(markdown || '', { breaks: false }));
      }
    });
    return () => { disposed = true; };
  }, [markdown]);
  return html;
}

function KnowledgeChips({ refs }: { refs: any[] | undefined }) {
  if (!Array.isArray(refs) || !refs.length) return null;
  return <div className="rr-kp-chips">{refs.filter((ref) => ref?.slug).map((ref, index) => {
    const label = ref.title
      ? String(ref.title)
      : String(ref.slug || '').replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
    const chip = <span className="rr-kp-chip">{KP_ICONS[ref.type] || '•'} {label}</span>;
    const href = grammarKnowledgeHref(ref);
    return href
      ? <a href={href} className="rr-kp-link" key={`${ref.type}-${ref.slug}-${index}`}>{chip}</a>
      : <span key={`${ref.type}-${ref.slug}-${index}`}>{chip}</span>;
  })}</div>;
}

function Microcheck({ value, refs, enabled, disabledNote }: {
  value: any;
  refs: any[] | undefined;
  enabled: boolean;
  disabledNote: string | null;
}) {
  const [answer, setAnswer] = useState<string | null>(null);
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'saved' | 'failed'>('idle');
  const options = Array.isArray(value?.options) ? value.options : [];
  if (!value?.prompt || !options.length) return null;
  const canonical = String(value.answer || '');
  const choose = async (letter: string) => {
    if (answer || !enabled) return;
    setAnswer(letter);
    if (!Array.isArray(refs) || !refs.length) return;
    setSendState('sending');
    try {
      await window.api.post('/api/kp/microcheck-answers', {
        answers: refs.map((kp) => ({ kp, correct: letter === canonical })),
      });
      setSendState('saved');
    } catch {
      setSendState('failed');
    }
  };
  return <div className="rr-microcheck" data-mc>
    <p className="rr-microcheck__prompt">🧩 {String(value.prompt)}</p>
    {options.map((option: any, index: number) => {
      const letter = String.fromCharCode(65 + index);
      const selected = answer === letter;
      const correct = selected && letter === canonical;
      return <button
        type="button"
        data-letter={letter}
        className={`rr-microcheck__option${selected ? (correct ? ' is-correct' : ' is-incorrect') : ''}`}
        disabled={!enabled}
        aria-disabled={Boolean(answer) || !enabled}
        onClick={() => void choose(letter)}
        key={`${letter}-${String(option?.text || option)}`}
      ><b>{letter}.</b> {String(typeof option === 'string' ? option : option?.text || '')}</button>;
    })}
    {!enabled && disabledNote ? <p className="rr-microcheck__note">{disabledNote}</p> : null}
    {answer ? <p className={answer === canonical ? 'rr-microcheck__ok' : 'rr-microcheck__bad'}>
      {answer === canonical ? '✓ Chính xác' : `✗ Chưa đúng — đáp án: ${canonical}`}
      {sendState === 'failed' ? ' · Chưa lưu được tiến độ.' : ''}
    </p> : null}
  </div>;
}

function StructuredStepper({ stepper, microcheckEnabled, microcheckDisabledNote }: {
  stepper: any;
  microcheckEnabled: boolean;
  microcheckDisabledNote: string | null;
}) {
  return <ol className="rr-stepper">{stepper.steps.map((step: any, index: number) => <li key={`${index}-${step.action}`}>
    <span className="rr-stepper__number">{index + 1}</span>
    <div className="rr-stepper__body">
      <div className="rr-stepper__action">{STEP_LABELS[step.action] || 'Bước'}</div>
      <p>{proseNodes(step.instruction_vi || '')}</p>
      <KnowledgeChips refs={step.kp_refs} />
      <Microcheck value={step.microcheck} refs={step.kp_refs} enabled={microcheckEnabled} disabledNote={microcheckDisabledNote} />
    </div>
  </li>)}</ol>;
}

function SolutionSection({ label, className = '', children }: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  if (children === null || children === undefined || children === '') return null;
  return <section className={`rr-sol__sec ${className}`.trim()}>
    <div className="rr-sol__label">{label}</div>
    <div className="rr-sol__text">{children}</div>
  </section>;
}

function VocabList({ rows }: { rows: unknown[] }) {
  return <dl className="rr-sol__vocab">{rows.map((raw, index) => {
    const parts = String(raw).split(/\s*(?:=|—)\s*/);
    return <div className="rr-sol__vocab-row" key={`${index}-${String(raw)}`}>
      <dt>{proseNodes(parts[0] || raw)}</dt>
      {parts.length > 1 ? <dd>{parts.slice(1).join(' — ')}</dd> : null}
    </div>;
  })}</dl>;
}

function LegacySteps({ value }: { value: unknown }) {
  const steps = splitReviewSteps(value);
  if (steps.length > 1) {
    return <ol className="rr-sol__steps">{steps.map((step: string, index: number) => <li key={`${index}-${step}`}>{proseNodes(step)}</li>)}</ol>;
  }
  return <p>{proseNodes(value)}</p>;
}

function QuestionCard({ item, expanded, preview, attemptId, anonId, onToggle, onLocate }: {
  item: any;
  expanded: boolean;
  preview: boolean;
  attemptId: string | null;
  anonId: string | null;
  onToggle(): void;
  onLocate(excerpt: string): void;
}) {
  const cardRef = useRef<HTMLElement | null>(null);
  const topRef = useRef<HTMLDivElement | null>(null);
  const solution = item.solution || {};
  const structured = hasStructuredStepper(item.stepper);
  const authoredDistractors = Array.isArray(item.stepper?.distractors)
    ? item.stepper.distractors.filter((row: any) => row?.option && row?.why_wrong_vi)
    : [];
  const hasRich = structured || Boolean(solution.steps || solution.source_excerpt
    || solution.vocab?.length || solution.paraphrase || authoredDistractors.length
    || solution.trap_analysis || solution.tips || item.explanation);

  useEffect(() => {
    if (preview || !attemptId || !cardRef.current || !topRef.current) return;
    let disposed = false;
    void whenGlobalReady(
      () => typeof (window as any).AverFeedback?.attachCardFlag === 'function',
      'AverFeedback (Reading review card)',
    ).then((ready) => {
      if (!disposed && ready && cardRef.current && topRef.current) {
        (window as any).AverFeedback.attachCardFlag({
          card: cardRef.current,
          top: topRef.current,
          skill: 'reading',
          attemptId,
          qNum: item.q_num,
          anonId,
        });
      }
    });
    return () => { disposed = true; };
  }, [anonId, attemptId, item.q_num, preview]);

  const toggleFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.key === 'Enter' || event.key === ' ') && !(event.target as HTMLElement).closest('button')) {
      event.preventDefault();
      onToggle();
    }
  };
  const skill = solution.skill_name || (item.skill_tag ? SKILL_LABELS[item.skill_tag] || item.skill_tag : '');
  const tags = [item.question_type, skill, solution.band != null ? `Band ${solution.band}` : ''].filter(Boolean).join(' · ');
  const prompt = readingReviewPrompt(item);

  return <article
    ref={cardRef}
    id={`reading-review-q-${item.q_num}`}
    className={`rr-card ${item.correct ? 'is-correct' : 'is-incorrect'}${expanded ? ' is-open' : ''}`}
    data-q={item.q_num}
  >
    <div
      ref={topRef}
      className="rr-card__top"
      role={hasRich ? 'button' : undefined}
      tabIndex={hasRich ? 0 : undefined}
      aria-expanded={hasRich ? expanded : undefined}
      onClick={(event) => {
        if (hasRich && !(event.target as HTMLElement).closest('button, a')) onToggle();
      }}
      onKeyDown={toggleFromKeyboard}
    >
      <span className="rr-card__num">Câu {item.q_num}</span>
      {!preview ? <span className="rr-card__verdict">{item.correct ? '✓ Đúng' : '✗ Sai'}</span> : null}
      <span className="rr-card__tag">{tags}</span>
      {hasRich ? <span className="rr-card__toggle">
        <span className="rr-card__toggle-text">{expanded ? 'Ẩn lời giải' : 'Xem lời giải'}</span>
        <span className="rr-card__chevron" aria-hidden="true">▸</span>
      </span> : null}
    </div>
    {prompt ? <p className="rr-card__prompt">{prompt}</p> : null}
    <div className="rr-card__answers">
      {!preview ? <div className="rr-card__ans is-user"><span>Bạn trả lời</span><code>{item.user_answer || '—'}</code></div> : null}
      <div className="rr-card__ans is-correct"><span>Đáp án</span><code>{item.expected || '—'}</code></div>
    </div>
    {hasRich ? <div className="rr-card__detail" hidden={!expanded}>
      <SolutionSection label="Các bước ra đáp án" className="rr-sol__sec--steps">
        {structured
          ? <StructuredStepper
              stepper={item.stepper}
              microcheckEnabled={!preview && !anonId}
              microcheckDisabledNote={preview
                ? 'Micro-check không ghi tiến độ trong chế độ xem trước.'
                : anonId ? 'Đăng nhập để làm micro-check và lưu tiến độ.' : null}
            />
          : solution.steps
            ? <LegacySteps value={solution.steps} />
            : null}
      </SolutionSection>
      <SolutionSection label="Trích đoạn nguồn" className="rr-sol__sec--quote">
        {solution.source_excerpt ? <><blockquote>{proseNodes(solution.source_excerpt)}</blockquote>
          <button type="button" className="rr-locate-btn" onClick={() => onLocate(String(solution.source_excerpt))}>📍 Locate trong bài đọc</button></> : null}
      </SolutionSection>
      <SolutionSection label="Từ vựng" className="rr-sol__sec--vocab">
        {Array.isArray(solution.vocab) && solution.vocab.length ? <VocabList rows={solution.vocab} /> : null}
      </SolutionSection>
      <SolutionSection label="Paraphrase">
        {solution.paraphrase ? <ul className="rr-sol__bullets">{splitReviewProse(solution.paraphrase).map((row: string, index: number) => <li key={`${index}-${row}`}>{proseNodes(row)}</li>)}</ul> : null}
      </SolutionSection>
      <SolutionSection label="Phân tích đáp án nhiễu" className="rr-sol__sec--trap">
        {authoredDistractors.length ? <ul className="rr-distractors">{authoredDistractors.map((row: any, index: number) => <li key={`${index}-${row.option}`}>
          <b>{String(row.option)}.</b> {proseNodes(row.why_wrong_vi)}<KnowledgeChips refs={row.kp_refs} />
        </li>)}</ul> : null}
      </SolutionSection>
      <SolutionSection label="Phân tích bẫy & kỹ năng" className="rr-sol__sec--trap">
        {solution.trap_analysis ? <ul className="rr-sol__bullets">{splitReviewProse(solution.trap_analysis).map((row: string, index: number) => <li key={`${index}-${row}`}>{proseNodes(row)}</li>)}</ul> : null}
      </SolutionSection>
      <SolutionSection label="💡 Mẹo làm bài" className="rr-sol__sec--tip">
        {solution.tips ? <ul className="rr-sol__bullets">{splitReviewProse(solution.tips).map((row: string, index: number) => <li key={`${index}-${row}`}>{proseNodes(row)}</li>)}</ul> : null}
      </SolutionSection>
      {!structured && !solution.steps && item.explanation
        ? <SolutionSection label="Lời giải"><p>{proseNodes(item.explanation)}</p></SolutionSection>
        : null}
    </div> : null}
  </article>;
}

function PassagePane({ passage, mode, highlight, onMode }: {
  passage: any;
  mode: PassageMode;
  highlight: string | null;
  onMode(mode: PassageMode): void;
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const html = useMarkdown(passage?.body_markdown || '');

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    body.querySelectorAll('.rr-src-hl').forEach((element) => element.classList.remove('rr-src-hl'));
    if (!highlight || mode !== 'original' || !html) return;
    const normalized = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();
    const segments = String(highlight).replace(/^["'“”\s]+|["'“”\s]+$/g, '')
      .split(/\s*(?:…|\.\.\.)\s*/).map(normalized).filter((part) => part.length >= 8);
    let first: HTMLElement | null = null;
    for (const element of body.querySelectorAll<HTMLElement>('p, li, td, h1, h2, h3, h4')) {
      const content = normalized(element.textContent || '');
      if (segments.some((segment) => content.includes(segment))) {
        element.classList.add('rr-src-hl');
        if (!first) first = element;
      }
    }
    first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlight, html, mode, passage?.passage_order]);

  return <section className="exam-passage" id="rr-passage-pane" aria-label="Đoạn văn">
    <div className="rr-passage-toggle" role="group" aria-label="Hiển thị đoạn văn">
      <button type="button" className={`rr-passage-toggle__btn${mode === 'original' ? ' is-active' : ''}`} aria-pressed={mode === 'original'} onClick={() => onMode('original')}>Văn bản gốc</button>
      <button type="button" className={`rr-passage-toggle__btn${mode === 'translation' ? ' is-active' : ''}`} aria-pressed={mode === 'translation'} onClick={() => onMode('translation')}>Bài dịch</button>
    </div>
    <h2 className="rr-passage__title">{passage?.title || `Phần ${passage?.passage_order || 1}`}</h2>
    {mode === 'translation' ? <div ref={bodyRef} className="rr-passage__body md-body">
      {String(passage?.translation_vi || '').trim()
        ? String(passage.translation_vi).split(/\n\s*\n/).filter(Boolean).map((paragraph, index) => <p key={`${index}-${paragraph}`}>{paragraph.trim()}</p>)
        : <p className="rr-passage__notrans">Chưa có bản dịch cho phần này.</p>}
    </div> : html
      ? <div ref={bodyRef} className="rr-passage__body md-body" dangerouslySetInnerHTML={{ __html: html }} />
      : <div ref={bodyRef} className="rr-passage__body md-body">{passage?.body_markdown || ''}</div>}
  </section>;
}

export function ReadingReviewWorkspace() {
  const { status, user } = useAuth();
  const [params, setParams] = useState<ReturnType<typeof readingReviewParams> | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState<{ ownerKey: string; data: any } | null>(null);
  const [currentPart, setCurrentPart] = useState(1);
  const [currentQuestion, setCurrentQuestion] = useState<number | null>(null);
  const [mode, setMode] = useState<PassageMode>('original');
  const [highlight, setHighlight] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [filter, setFilter] = useState<ReviewFilter>('all');
  const surveyRef = useRef<HTMLDivElement | null>(null);
  const requestRef = useRef(0);

  useEffect(() => { setParams(readingReviewParams(window.location.search)); }, []);

  useEffect(() => {
    const previous = document.body.dataset.textSize;
    document.body.dataset.textSize = 'medium';
    return () => {
      if (previous === undefined) delete document.body.dataset.textSize;
      else document.body.dataset.textSize = previous;
    };
  }, []);

  // Bind every private snapshot to BOTH the resource and the current account
  // (or anonymous capability). AuthProvider can change during a render; this
  // synchronous projection hides the old account before the effect below has
  // a chance to clear/reload it.
  const ownerKey = params
    ? `${params.adminTestId || params.attemptId || 'missing'}:${params.anonId ? `anon:${params.anonId}` : `user:${user?.id || 'none'}`}`
    : null;
  const data = snapshot && snapshot.ownerKey === ownerKey ? snapshot.data : null;

  useEffect(() => {
    if (!params) return;
    if (!params.attemptId && !params.adminTestId) {
      setSnapshot(null);
      setPhase('empty');
      return;
    }
    if (!params.anonId && status === 'initial-loading') return;
    if (!params.anonId && status === 'signed-out') {
      setSnapshot(null);
      window.location.replace('/login');
      return;
    }

    const requestId = ++requestRef.current;
    const controller = new AbortController();
    setSnapshot(null);
    setExpanded(new Set());
    setHighlight(null);
    setError('');
    setPhase('loading');

    void (async () => {
      try {
        const ready = await whenGlobalReady(() => Boolean(window.api?.getWith), 'window.api (Reading review)');
        if (!ready) throw new Error('Không thể kết nối lớp dữ liệu.');
        const path = params.adminTestId
          ? `/admin/reading/content/tests/${encodeURIComponent(params.adminTestId)}/preview`
          : `/api/reading/test/attempts/${encodeURIComponent(params.attemptId!)}/review`;
        const raw = await window.api.getWith<unknown>(
          path,
          params.anonId ? { 'X-Reading-Anon': params.anonId } : undefined,
          { noRedirect: true, signal: controller.signal },
        );
        const normalized = normalizeReadingReview(raw);
        if (requestRef.current !== requestId || controller.signal.aborted) return;
        if (!params.adminTestId && normalized.attemptId !== params.attemptId) {
          throw new Error('Mã bài làm trong phản hồi không khớp yêu cầu.');
        }
        if (!normalized.review.length || !normalized.passages.length) {
          setPhase('empty');
          return;
        }
        setSnapshot({ ownerKey: ownerKey!, data: normalized });
        const firstWrong = normalized.review.find((item: any) => !item.correct);
        const firstItem = firstWrong || normalized.review[0];
        setCurrentPart(firstItem.passage_order);
        setCurrentQuestion(firstItem.q_num);
        setFilter(normalized.preview ? 'all' : (firstWrong ? 'wrong' : 'all'));
        setMode('original');
        setPhase('ready');
      } catch (caught) {
        if (requestRef.current !== requestId || controller.signal.aborted) return;
        const code = statusOf(caught);
        if (code === 401 && !params.anonId) {
          window.location.replace('/login');
          return;
        }
        if (code === 404) { setPhase('empty'); return; }
        if (code === 409) setError('Bài làm này chưa nộp — chưa có chữa bài. Hãy hoàn thành và nộp bài trước.');
        else if (code === 401 || code === 403) setError(params.anonId
          ? 'Không xem được chữa bài này (liên kết không còn hiệu lực hoặc thuộc phiên khác).'
          : 'Bài làm này không thuộc tài khoản của bạn.');
        else setError(`Không tải được chữa bài. ${messageOf(caught)}`);
        setPhase('error');
      }
    })();

    return () => controller.abort();
  }, [ownerKey, params, status, user?.id]);

  useEffect(() => {
    document.body.classList.toggle('is-exam-preview', Boolean(data?.preview));
    return () => document.body.classList.remove('is-exam-preview');
  }, [data?.preview]);

  const allCurrentItems = useMemo(() => (data?.review || []).filter((item: any) => item.passage_order === currentPart), [currentPart, data]);
  const currentItems = useMemo(() => allCurrentItems.filter((item: any) => (
    filter === 'wrong' ? !item.correct : filter === 'correct' ? item.correct : true
  )), [allCurrentItems, filter]);
  const passage = useMemo(() => (data?.passages || []).find((item: any) => item.passage_order === currentPart) || null, [currentPart, data]);
  const back = useMemo(() => readingReviewBackTarget(params), [params]);
  const skills = useMemo(() => readingReviewSkillRows(data?.skillBreakdown, SKILL_LABELS), [data]);
  const wrongCount = data?.review.filter((item: any) => !item.correct).length || 0;

  useEffect(() => {
    const host = surveyRef.current;
    if (!host || !data?.attemptId || data.preview) return;
    let disposed = false;
    void whenGlobalReady(
      () => typeof (window as any).AverFeedback?.mountSurvey === 'function',
      'AverFeedback (Reading review survey)',
    ).then((ready) => {
      if (!disposed && ready && surveyRef.current) {
        (window as any).AverFeedback.mountSurvey(surveyRef.current, {
          skill: 'reading',
          attemptId: data.attemptId,
          hasAudio: false,
          anonId: params?.anonId,
          qNums: data.review.map((item: any) => item.q_num),
        });
      }
    });
    return () => { disposed = true; };
  }, [data, params?.anonId]);

  const selectQuestion = useCallback((item: any) => {
    if (filter !== 'all' && ((filter === 'wrong') === item.correct)) setFilter('all');
    setCurrentPart(item.passage_order);
    setCurrentQuestion(item.q_num);
    setHighlight(null);
    setExpanded((previous) => new Set(previous).add(item.q_num));
    requestAnimationFrame(() => document.getElementById(`reading-review-q-${item.q_num}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [filter]);

  const locate = useCallback((excerpt: string) => {
    setMode('original');
    setHighlight(null);
    requestAnimationFrame(() => setHighlight(excerpt));
  }, []);

  return <>
    <header className="exam-topbar rr-topbar" role="banner">
      <div className="rr-topbar__left">
        <a className="rr-back" href={back.href}>{back.label}</a>
        <span className="rr-test-label">{data?.title || 'Chữa bài'}</span>
      </div>
      <div className="rr-topbar__right">
        {data?.preview ? <p className="rr-preview-banner" role="status">XEM TRƯỚC — chưa ai làm bài này. Ô trả lời để trống và không có điểm; đáp án + giải thích là thật.</p> : null}
        {data && !data.preview ? <div className="rr-topbar-summary" aria-live="polite">
          <span className="rr-topbar-summary__band">Band {data.bandEstimate ?? '—'}</span>
          <span className="rr-topbar-summary__score">Đúng {data.score ?? '—'}/{data.maxScore}</span>
        </div> : null}
        {skills.length ? <div className="rr-skills" aria-label="Phân bố kỹ năng">{skills.map((skill: any) => <span
          className={`rr-skill-chip ${skill.percent >= 75 ? 'is-strong' : skill.percent >= 50 ? 'is-mid' : 'is-weak'}`}
          title={skill.label}
          key={skill.key}
        ><span className="rr-skill-chip__name">{skill.label}</span><span className="rr-skill-chip__count">{skill.correct}/{skill.total}</span></span>)}</div> : null}
      </div>
    </header>

    {phase === 'loading' ? <main className="exam-state-shell"><p className="exam-state-msg" role="status">Đang tải chữa bài…</p></main> : null}
    {phase === 'empty' ? <main className="exam-state-shell"><p className="exam-state-msg">Không tìm thấy bài làm để chữa.</p></main> : null}
    {phase === 'error' ? <main className="exam-state-shell"><div className="reading-review-next-error" role="alert"><p className="exam-state-msg exam-state-msg--error">{error}</p><a href={back.href}>{back.label}</a></div></main> : null}

    {phase === 'ready' && data ? <>
      <main className="exam-split">
        <PassagePane passage={passage} mode={mode} highlight={highlight} onMode={(next) => { setMode(next); setHighlight(null); }} />
        <div className="exam-divider" aria-hidden="true" />
        <section className="exam-questions rr-review" aria-label="Chữa từng câu">
          <header className="rr-review-header">
            <div><p className="rr-review-header__eyebrow">KIỂM TRA ĐÁP ÁN</p><h1>Chữa từng câu</h1><p className="rr-review-header__copy">{data.preview
              ? `${data.review.length} câu trong đề · Xem đáp án, trích đoạn nguồn và lời giải trước khi xuất bản.`
              : `${wrongCount} câu cần xem lại · ${data.review.length - wrongCount} câu đúng. ${wrongCount ? 'Bắt đầu từ câu sai, tự định vị bằng chứng rồi mới mở lời giải.' : 'Bạn đã trả lời đúng toàn bộ bài này.'}`}</p></div>
            {!data.preview ? <div className="rr-filter" role="group" aria-label="Lọc kết quả câu hỏi">{([
              ['wrong', 'Cần xem lại'], ['all', 'Tất cả'], ['correct', 'Đúng'],
            ] as [ReviewFilter, string][]).map(([value, label]) => <button type="button" className={`rr-filter__button${filter === value ? ' is-active' : ''}`} aria-pressed={filter === value} onClick={() => setFilter(value)} key={value}>{label}</button>)}</div> : null}
          </header>
          <div className="rr-review-tools">
            <span>Passage {currentPart} · {currentItems.length} câu đang hiển thị</span>
            <button type="button" className="rr-expand-all" aria-pressed={currentItems.length > 0 && currentItems.every((item: any) => expanded.has(item.q_num))} disabled={!currentItems.length} onClick={() => {
              const allOpen = currentItems.every((item: any) => expanded.has(item.q_num));
              setExpanded((previous) => {
                const next = new Set(previous);
                currentItems.forEach((item: any) => allOpen ? next.delete(item.q_num) : next.add(item.q_num));
                return next;
              });
              if (allOpen) setHighlight(null);
            }}>{currentItems.length > 0 && currentItems.every((item: any) => expanded.has(item.q_num)) ? 'Thu gọn tất cả' : 'Mở tất cả'}</button>
          </div>
          {!data.preview ? <div className="exam-review-guide" aria-label="Cách chữa bài hiệu quả"><span><b>1</b>Tự tìm bằng chứng</span><span><b>2</b>So đáp án</span><span><b>3</b>Phân tích bẫy</span></div> : null}
          <div ref={surveyRef} />
          <div className="rr-cards">{currentItems.length ? currentItems.map((item: any) => <QuestionCard
            item={item}
            expanded={expanded.has(item.q_num)}
            preview={data.preview}
            attemptId={data.attemptId}
            anonId={params?.anonId || null}
            onToggle={() => setExpanded((previous) => {
              const next = new Set(previous);
              if (next.has(item.q_num)) next.delete(item.q_num); else next.add(item.q_num);
              return next;
            })}
            onLocate={locate}
            key={item.q_num}
          />) : <p className="exam-review-empty">Không có câu nào trong bộ lọc này ở Passage {currentPart}.</p>}</div>
        </section>
      </main>
      <footer className="exam-palette" role="navigation" aria-label="Chọn câu để chữa">
        <div className="exam-palette__grid" role="group" aria-label={`${data.review.length} câu`}>{data.passages.map((part: any) => <div className="exam-palette__group" key={part.passage_order}>
          <span className="exam-palette__group-label">Passage {part.passage_order}</span>
          <div className="exam-palette__group-btns">{data.review.filter((item: any) => item.passage_order === part.passage_order).map((item: any) => <button
            type="button"
            className={`exam-palette__q rr-nav-q${data.preview ? '' : ` ${item.correct ? 'is-correct' : 'is-incorrect'}`}${currentQuestion === item.q_num ? ' is-current' : ''}`}
            aria-current={currentQuestion === item.q_num ? 'true' : undefined}
            aria-label={`Câu ${item.q_num}${data.preview ? ' — xem trước' : ` — ${item.correct ? 'đúng' : 'sai'}`}`}
            onClick={() => selectQuestion(item)}
            key={item.q_num}
          >{item.q_num}</button>)}</div>
        </div>)}</div>
        <div className="rr-nav-legend" aria-hidden="true">
          <span className="rr-nav-legend__item"><span className="rr-nav-legend__swatch is-correct" />Đúng</span>
          <span className="rr-nav-legend__item"><span className="rr-nav-legend__swatch is-incorrect" />Sai</span>
        </div>
      </footer>
    </> : null}
  </>;
}

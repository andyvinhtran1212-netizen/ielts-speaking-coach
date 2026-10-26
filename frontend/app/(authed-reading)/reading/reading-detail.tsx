'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { PracticeReadingText, type PracticeSupport, type PracticeEvidence, type EvidenceSelection } from './practice-reading-text';
import { readingSkillReturnHref } from '@/lib/reading-skill-context.mjs';

import { readingVocabReturnHref } from '@/lib/reading-vocab-context.mjs';

import { useAuth } from '@/lib/auth/auth-provider';
import { clearLearnerTabDraftAccount, createLearnerTabDrafts, type TabDraft } from '@/lib/learner-tab-drafts.mjs';
import {
  answerForQuestion,
  normalizeReadingCheck,
  normalizeReadingDetail,
  readingDetailPath,
  validReadingSlug,
} from '@/lib/reading-detail-model.mjs';
import { normalizeVocabContextLinks } from '@/lib/vocab-context-links-model.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

type Library = 'vocab' | 'skill';
type Option = { label: string; text: string };
type Question = { qNum: number; type: string; prompt: string; options: Option[]; skillTag: string | null; subSkill: string | null };
type GlossaryEntry = { term: string; definition: string; ipa: string | null; pos: string | null; example: string | null; synonyms: string | string[]; aliases: string[] };
type GrammarPoint = { point: string; example: string | null; analysis: string | null; review: string | null; tip: string | null };
type Detail = {
  id: string | null;
  slug: string;
  title: string;
  bodyMarkdown: string;
  sourceSha256: string | null;
  difficulty: string | null;
  topics: string[];
  imageUrl: string | null;
  glossary: GlossaryEntry[];
  skillFocus: string | null;
  wordCount: number | null;
  estimatedMinutes: number | null;
  translationVi: string | null;
  grammarFocus: GrammarPoint[];
  questions: Question[];
  practiceSupport: PracticeSupport | null;
};
type CheckResult = { qNum: number; correct: boolean; expected: string; explanation: string | null; skillTag: string | null; evidence: PracticeEvidence | null };
type ReadingDraft = { answers: Record<string, string> };
type ContextLink = { requestTerm: string; unitSlug: string; title: string; rationale: string; level: string };
type DialogState =
  | { kind: 'glossary'; entry: GlossaryEntry }
  | { kind: 'image'; src: string; alt: string }
  | null;
type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; detail: NonNullable<Detail> }
  | { status: 'empty' }
  | { status: 'error'; denied?: boolean };

const DIFFICULTY_LABEL: Record<string, string> = {
  foundation: 'Foundation', intermediate: 'Intermediate', advanced: 'Advanced',
};
const SKILL_LABEL: Record<string, string> = {
  skimming: 'Skimming', scanning: 'Scanning', detail: 'Detail', main_idea: 'Main idea',
  inference: 'Inference', vocabulary_in_context: 'Vocab in context',
  reference_cohesion: 'Reference / cohesion', writer_view_TFNG: "Writer's view (T/F/NG)",
};

function messageFor(library: Library, kind: 'empty' | 'error') {
  if (kind === 'empty') return library === 'vocab'
    ? 'Không tìm thấy bài đọc đã phát hành.'
    : 'Không tìm thấy bài luyện đã phát hành.';
  return library === 'vocab'
    ? 'Không tải được bài đọc. Hãy thử lại.'
    : 'Không tải được bài luyện. Hãy thử lại.';
}

function statusOf(caught: unknown) {
  return caught && typeof caught === 'object' && 'status' in caught
    ? Number((caught as { status?: unknown }).status)
    : 0;
}

export function ReadingDetail({ library, slug }: { library: Library; slug: string }) {
  const { status, user } = useAuth();
  const accountKey = status === 'signed-in' && user?.id ? user.id : null;
  const [returnState, setReturnState] = useState<'active' | 'checking'>('active');
  const [returnGeneration, setReturnGeneration] = useState(0);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const returnEpoch = useRef(0);
  const authAccount = useRef(accountKey);
  authAccount.current = accountKey;
  const currentAccount = useRef(accountKey);
  currentAccount.current = returnState === 'active' ? accountKey : null;
  const previousAccount = useRef(accountKey);
  useLayoutEffect(() => {
    // A checking→active transition can be batched; always reconcile the
    // synchronous pagehide concealment after the fresh workspace is mounted.
    if (workspaceRef.current) workspaceRef.current.hidden = returnState !== 'active';
  }, [returnGeneration, returnState]);
  useLayoutEffect(() => {
    // Rechecking a persisted page is not logout. Keep the last confirmed
    // account until auth supplies a signed-in or signed-out result.
    if (status === 'initial-loading') return;
    if (previousAccount.current && previousAccount.current !== accountKey) {
      clearLearnerTabDraftAccount(previousAccount.current);
    }
    previousAccount.current = accountKey;
    setReturnState('active');
  }, [accountKey, status]);
  useEffect(() => {
    if (library !== 'vocab') return undefined;
    let disposed = false;
    const conceal = () => {
      returnEpoch.current += 1;
      currentAccount.current = null;
      if (workspaceRef.current) workspaceRef.current.hidden = true;
      setReturnState('checking');
    };
    const resume = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      conceal();
      const epoch = returnEpoch.current;
      void (async () => {
        try {
          const ready = await whenGlobalReady(() => typeof window.getSupabase === 'function', 'Reading return account');
          if (!ready || disposed || epoch !== returnEpoch.current) return;
          const client = window.getSupabase() as { auth?: { getSession(): Promise<{ data?: { session?: { user?: { id?: string } } | null } }> } } | null;
          const account = (await client?.auth?.getSession())?.data?.session?.user?.id;
          if (disposed || epoch !== returnEpoch.current) return;
          if (account && account === authAccount.current) {
            setReturnGeneration(epoch);
            setReturnState('active');
          }
          else if (previousAccount.current) clearLearnerTabDraftAccount(previousAccount.current);
        } catch { /* Keep private answers concealed until the real account is confirmed. */ }
      })();
    };
    window.addEventListener('pagehide', conceal);
    window.addEventListener('pageshow', resume);
    return () => {
      disposed = true;
      returnEpoch.current += 1;
      window.removeEventListener('pagehide', conceal);
      window.removeEventListener('pageshow', resume);
    };
  }, [library]);
  useEffect(() => {
    if (status === 'signed-out') window.location.replace('/login');
  }, [status]);
  return (
    <>
      {returnState === 'checking' && <ReadingDetailState kind="loading" message="Đang xác nhận tài khoản…" />}
      <div hidden={returnState === 'checking'} ref={workspaceRef}>
        {returnState === 'active' && <ReadingDetailWorkspace
          accountKey={accountKey}
          getAccountId={() => currentAccount.current}
          key={`${accountKey || status}|${library}|${slug}|${returnGeneration}`}
          library={library}
          slug={slug}
        />}
      </div>
    </>
  );
}

function ReadingDetailWorkspace({ accountKey, getAccountId, library, slug }: {
  accountKey: string | null;
  getAccountId(): string | null;
  library: Library;
  slug: string;
}) {
  const [state, setState] = useState<LoadState>(() => validReadingSlug(slug)
    ? { status: 'loading' }
    : { status: 'empty' });

  useEffect(() => {
    if (!accountKey || !validReadingSlug(slug)) {
      setState(validReadingSlug(slug) ? { status: 'loading' } : { status: 'empty' });
      return undefined;
    }
    const path = readingDetailPath(library, slug);
    if (!path) {
      setState({ status: 'empty' });
      return undefined;
    }
    const controller = new AbortController();
    let disposed = false;
    setState({ status: 'loading' });
    (async () => {
      const ready = await whenGlobalReady(
        () => Boolean(window.api?.getWith),
        `window.api (reading ${library} detail)`,
      );
      if (!ready || disposed) {
        if (!disposed) setState({ status: 'error' });
        return;
      }
      try {
        const payload = await window.api.getWith<unknown>(path, undefined, { signal: controller.signal });
        if (disposed) return;
        const detail = normalizeReadingDetail(payload, slug) as Detail | null;
        setState(detail ? { status: 'ready', detail } : { status: 'error' });
      } catch (caught: unknown) {
        if (disposed || (caught instanceof DOMException && caught.name === 'AbortError')) return;
        setState(statusOf(caught) === 404 ? { status: 'empty' } : { status: 'error', denied: statusOf(caught) === 403 });
      }
    })();
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [accountKey, library, slug]);

  if (state.status === 'loading') {
    return <ReadingDetailState kind="loading" message="Đang mở không gian đọc…" />;
  }
  if (state.status === 'empty') {
    return <ReadingDetailState kind="empty" message={messageFor(library, 'empty')} />;
  }
  if (state.status === 'error') {
    return <ReadingDetailState kind="error" message={state.denied ? 'Bạn không có quyền mở bài đọc này.' : messageFor(library, 'error')} />;
  }
  const version = JSON.stringify([state.detail.id, state.detail.slug, state.detail.bodyMarkdown, state.detail.translationVi, state.detail.questions.map(({ qNum, type, prompt, options }) => ({ qNum, type, prompt, options }))]);
  return <ReadingWorkspace accountKey={accountKey} getAccountId={getAccountId} detail={state.detail} key={version} library={library} version={version} />;
}

function ReadingDetailState({ kind, message }: { kind: 'loading' | 'empty' | 'error'; message: string }) {
  return (
    <div className="shell">
      <main className="rv-shell rv-detail-shell">
        <div className={kind === 'error' ? 'rv-error' : 'rv-empty'} role={kind === 'error' ? 'alert' : 'status'}>
          {message}
          {kind === 'error' && <p><button className="rq-check" onClick={() => window.location.reload()} type="button">Thử lại</button></p>}
          {kind !== 'loading' && <p><a href="/reading">Trở về thư viện Reading</a></p>}
        </div>
      </main>
    </div>
  );
}

function ReadingWorkspace({ accountKey, getAccountId, detail, library, version }: {
  accountKey: string | null;
  getAccountId(): string | null;
  detail: NonNullable<Detail>;
  library: Library;
  version: string;
}) {
  const params = useSearchParams();
  const articleRef = useRef<HTMLElement>(null);
  const [progress, setProgress] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [results, setResults] = useState<Record<number, CheckResult>>({});
  const [evidenceSelection, setEvidenceSelection] = useState<EvidenceSelection>(null);
  const [contextLinks, setContextLinks] = useState<ContextLink[]>([]);
  const [draftReady, setDraftReady] = useState(library !== 'vocab');
  const [draftNotice, setDraftNotice] = useState<'restored' | 'unsaved' | 'discarded' | null>(null);
  const draft = useRef<TabDraft<ReadingDraft> | null>(null);
  const unchecked = useRef<Record<string, string>>({});
  const currentAnswers = useRef<Record<number, string>>({});
  const currentResults = useRef<Record<number, CheckResult>>({});
  const active = useRef(false);
  const accountGetter = useRef(getAccountId);
  accountGetter.current = getAccountId;
  const isCurrent = () => active.current && accountGetter.current() === accountKey;
  const correct = Object.values(results).filter((result) => result.correct).length;

  useLayoutEffect(() => {
    active.current = true;
    if (library !== 'vocab' || !accountKey) return () => { active.current = false; };
    const numbers = new Set(detail.questions.map((question) => String(question.qNum)));
    const session = createLearnerTabDrafts<ReadingDraft>({
      accountId: accountKey, scope: `reading-vocab:${detail.slug}`, version,
      getAccountId: () => accountGetter.current(),
      validate: (value: unknown) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)
          || Object.keys(value).length !== 1 || !Object.hasOwn(value, 'answers')) return false;
        const values = (value as ReadingDraft).answers;
        return Boolean(values && typeof values === 'object' && !Array.isArray(values)
          && Object.entries(values).every(([number, answer]) => numbers.has(number) && typeof answer === 'string'));
      },
    });
    draft.current = session;
    const restored = session.read();
    const values = restored.value?.answers || {};
    unchecked.current = { ...values };
    currentAnswers.current = { ...values };
    setAnswers({ ...values });
    setDraftNotice(restored.status === 'unavailable' ? 'unsaved' : restored.restored ? 'restored' : null);
    setDraftReady(true);
    return () => {
      active.current = false;
      session.dispose();
      if (draft.current === session) draft.current = null;
    };
  }, [accountKey, detail, library, version]);

  const persist = () => {
    if (draft.current?.save({ answers: unchecked.current }).status === 'unavailable') setDraftNotice('unsaved');
  };
  const changeAnswer = (number: number, value: string) => {
    if (!isCurrent() || !draftReady || currentResults.current[number]) return;
    currentAnswers.current = { ...currentAnswers.current, [number]: value };
    unchecked.current = { ...unchecked.current, [number]: value };
    setAnswers(currentAnswers.current);
    if (library === 'vocab') persist(); // The latest raw edit, including empty, is stored before navigation.
  };
  const acceptResult = (result: CheckResult, submittedAnswer: string) => {
    if (!isCurrent() || currentAnswers.current[result.qNum] !== submittedAnswer || currentResults.current[result.qNum]) return;
    currentResults.current = { ...currentResults.current, [result.qNum]: result };
    setResults(currentResults.current);
    if (library === 'vocab') {
      const next = { ...unchecked.current };
      delete next[result.qNum];
      unchecked.current = next;
      persist();
    }
  };
  const discardDraft = () => {
    if (!isCurrent()) return;
    const discarded = draft.current?.discard();
    unchecked.current = {};
    currentAnswers.current = Object.fromEntries(Object.entries(currentAnswers.current).filter(([number]) => currentResults.current[Number(number)]));
    setAnswers(currentAnswers.current);
    setDraftNotice(discarded?.status === 'unavailable' ? 'unsaved' : 'discarded');
  };

  useEffect(() => {
    const update = () => {
      const pane = articleRef.current;
      const scroller = pane && pane.scrollHeight > pane.clientHeight + 1
        ? pane
        : document.documentElement;
      const max = scroller.scrollHeight - scroller.clientHeight;
      const top = scroller === document.documentElement ? window.scrollY : scroller.scrollTop;
      setProgress(max > 0 ? Math.min(100, Math.max(0, top / max * 100)) : 0);
    };
    const pane = articleRef.current;
    window.addEventListener('scroll', update, { passive: true });
    pane?.addEventListener('scroll', update, { passive: true });
    update();
    return () => {
      window.removeEventListener('scroll', update);
      pane?.removeEventListener('scroll', update);
    };
  }, [detail.slug]);

  useEffect(() => {
    document.title = `${detail.title} — Aver Learning`;
  }, [detail.title]);

  useEffect(() => {
    const terms = detail.glossary.map((entry) => entry.term).filter(Boolean).slice(0, 30);
    setContextLinks([]);
    if (!accountKey || !terms.length) return undefined;
    const controller = new AbortController();
    let disposed = false;
    void (async () => {
      try {
        const ready = await whenGlobalReady(
          () => typeof window.api?.postWith === 'function',
          'window.api POST (Reading glossary context links)',
        );
        if (!ready || disposed) return;
        const payload = await window.api.postWith<unknown>(
          '/api/me/vocabulary/context-links',
          { terms },
          {},
          { signal: controller.signal, noRedirect: true },
        );
        if (!disposed) setContextLinks(normalizeVocabContextLinks(payload) as ContextLink[]);
      } catch {
        // Optional enrichment: a cohort/flag/network failure must not break Reading.
        if (!disposed) setContextLinks([]);
      }
    })();
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [accountKey, detail.glossary]);

  const backHref = library === 'vocab' ? readingVocabReturnHref(params || undefined) : readingSkillReturnHref(params || undefined);
  const kicker = library === 'vocab' ? 'READING LAB · VOCAB' : 'READING LAB · SKILL PRACTICE';
  const heading = library === 'vocab' ? 'Kiểm tra mức độ hiểu' : 'Luyện đúng kỹ năng';
  const description = library === 'vocab'
    ? 'Trả lời từng câu và nhận phản hồi ngay.'
    : 'Kiểm tra từng câu để nhận phản hồi tức thì.';

  return (
    <>
      <div className="rv-progress" aria-hidden="true"><div className="rv-progress__fill" style={{ width: `${progress}%` }} /></div>
      <div className="shell">
        <main className="rv-shell rv-detail-shell">
          <div className={`rv-detail${library === 'skill' ? ' rv-detail--skill' : ''}`}>
            <header className="rv-detail__header">
              <a className="rv-back" href={backHref}><span aria-hidden="true">←</span> {library === 'vocab' ? 'Thư viện Vocab Reading' : 'Skill Practice'}</a>
              <div className="rv-detail__heading">
                <div className="rv-detail__copy">
                  <p className="rv-kicker">{kicker}</p>
                  {library === 'skill' && detail.skillFocus && <div className="rv-skill-banner">Kỹ năng trọng tâm · {SKILL_LABEL[detail.skillFocus] || detail.skillFocus}</div>}
                  <h1 className="rv-passage__title">{detail.title}</h1>
                  {detail.topics.length > 0 && <div className="rv-detail__topics" aria-label="Chủ đề bài luyện">{detail.topics.map((topic) => <span key={topic}>{topic}</span>)}</div>}
                </div>
                <dl className="rv-detail__facts" aria-label="Thông tin bài luyện">
                  <div><dt>{detail.difficulty ? DIFFICULTY_LABEL[detail.difficulty] || detail.difficulty : 'Mọi trình độ'}</dt><dd>Trình độ</dd></div>
                  <div><dt>{detail.estimatedMinutes ?? '—'}</dt><dd>{library === 'vocab' ? 'Phút đọc' : 'Phút luyện'}</dd></div>
                  <div><dt>{detail.wordCount ?? '—'}</dt><dd>Từ</dd></div>
                </dl>
              </div>
            </header>
            <div className={`rv-passage-layout${detail.questions.length ? '' : ' rv-passage-layout--reading-only'}`}>
              <article className="rv-reader" aria-label={library === 'vocab' ? 'Nội dung bài đọc' : 'Nội dung bài luyện'} ref={articleRef}>
                <header className="rv-reader__head"><p>Bài đọc</p><span>{library === 'vocab' ? 'Chạm vào từ gạch chân để xem nghĩa trong ngữ cảnh.' : 'Đọc theo mục tiêu kỹ năng, sau đó kiểm tra từng câu.'}</span></header>
                <ReadingPanes contextLinks={contextLinks} detail={detail} evidenceSelection={evidenceSelection} onReturn={(qNum) => { const card = document.getElementById(`rq-card-${qNum}`); card?.scrollIntoView({ block: 'center', behavior: 'instant' }); card?.focus(); }} />
              </article>
              {detail.questions.length > 0 && (
                <aside className="rv-questions" aria-label={heading}>
                  <div className="rq-head">
                    <div className="rq-head__copy"><span className="rq-kicker">SAU KHI ĐỌC</span><h2 className="rq-title">{heading}</h2><p className="rq-description">{description}</p></div>
                    <div className="rq-summary" aria-live="polite">Đúng {correct}/{detail.questions.length}</div>
                  </div>
                  {library === 'vocab' && draftReady && <div className="rq-draft">
                    <p role="status" aria-live="polite">{draftNotice === 'unsaved'
                      ? 'Nháp chưa được lưu. Bạn vẫn có thể tiếp tục làm bài.'
                      : draftNotice === 'restored' ? 'Đã khôi phục nháp trong tab này.'
                        : draftNotice === 'discarded' ? 'Đã bỏ nháp của bài đọc này.' : 'Câu trả lời chưa kiểm tra được giữ trong tab này.'}</p>
                    <button className="rq-check rq-draft__discard" onClick={discardDraft} type="button">Bỏ nháp bài này</button>
                  </div>}
                  {draftReady && detail.questions.map((question) => (
                    <QuestionCard
                      answer={answers[question.qNum] || ''}
                      key={question.qNum}
                      library={library}
                      lockedResult={results[question.qNum] || null}
                      number={question.qNum}
                      isCurrent={isCurrent}
                      onAnswer={(value) => changeAnswer(question.qNum, value)}
                      onResult={acceptResult}
                      onLocate={(qNum, evidence) => setEvidenceSelection({ qNum, evidence, generation: (evidenceSelection?.generation || 0) + 1 })}
                      question={question}
                      slug={detail.slug}
                      sourceSha256={detail.sourceSha256}
                    />
                  ))}
                </aside>
              )}
            </div>
          </div>
        </main>
      </div>
    </>
  );
}

function InlineStrong({ value }: { value: string }) {
  return <>{value.split(/(\*\*[^*]+\*\*)/g).map((part, index) => {
    const match = /^\*\*([^*]+)\*\*$/.exec(part);
    return match ? <strong key={index}>{match[1]}</strong> : part;
  })}</>;
}

function ReadingPanes({ contextLinks, detail, evidenceSelection, onReturn }: { contextLinks: ContextLink[]; detail: NonNullable<Detail>; evidenceSelection: EvidenceSelection; onReturn(qNum: number): void }) {
  const tabs = useMemo(() => [
    { id: 'original', label: 'Văn bản gốc' },
    ...(detail.translationVi ? [{ id: 'translation', label: 'Bài dịch' }] : []),
    ...(detail.grammarFocus.length ? [{ id: 'grammar', label: 'Phân tích grammar' }] : []),
  ], [detail.grammarFocus.length, detail.translationVi]);
  const [active, setActive] = useState('original');
  useEffect(() => { if (evidenceSelection) setActive('original'); }, [evidenceSelection]);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const move = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    setActive(tabs[next].id);
    tabRefs.current[tabs[next].id]?.focus();
  };
  return (
    <>
      {tabs.length > 1 && <div className="rv-panes" data-count={tabs.length} role="tablist" aria-label="Chế độ xem bài đọc">
        {tabs.map((tab, index) => <button
          aria-controls={`rv-panel-${tab.id}`}
          aria-selected={active === tab.id}
          className={`rv-panes__btn${active === tab.id ? ' is-active' : ''}`}
          id={`rv-tab-${tab.id}`}
          key={tab.id}
          onClick={() => setActive(tab.id)}
          onKeyDown={(event) => move(event, index)}
          ref={(node) => { tabRefs.current[tab.id] = node; }}
          role="tab"
          tabIndex={active === tab.id ? 0 : -1}
          type="button"
        >{tab.label}</button>)}
      </div>}
      <div aria-labelledby="rv-tab-original" hidden={active === 'grammar'} id="rv-panel-original" role={tabs.length > 1 ? 'tabpanel' : undefined}>
        <ReadingBody contextLinks={contextLinks} detail={detail} evidenceSelection={evidenceSelection} onReturn={onReturn} />
      </div>
      {detail.translationVi && <div aria-labelledby="rv-tab-translation" className="rv-pane rv-pane--vi md-body" hidden={active !== 'translation'} id="rv-panel-translation" role="tabpanel">
        {detail.translationVi.split(/\n\s*\n/).map((paragraph, index) => paragraph.trim() ? <p key={index}><InlineStrong value={paragraph.trim()} /></p> : null)}
      </div>}
      {detail.grammarFocus.length > 0 && <div aria-labelledby="rv-tab-grammar" className="rv-pane rv-pane--grammar" hidden={active !== 'grammar'} id="rv-panel-grammar" role="tabpanel">
        {detail.grammarFocus.map((point, index) => <article className="rv-gpoint" key={`${point.point}-${index}`}>
          <h3 className="rv-gpoint__title">{point.point}</h3>
          {point.example && <p className="rv-gpoint__example"><InlineStrong value={point.example} /></p>}
          {([['analysis', 'Phân tích'], ['review', 'Cấu trúc'], ['tip', 'Mẹo đọc']] as const).map(([key, label]) => point[key] && <p className={`rv-gpoint__row rv-gpoint__${key}`} key={key}><strong className="rv-gpoint__lbl">{label}: </strong><span>{point[key]}</span></p>)}
        </article>)}
      </div>}
    </>
  );
}

function ReadingBody({ contextLinks, detail, evidenceSelection, onReturn }: { contextLinks: ContextLink[]; detail: NonNullable<Detail>; evidenceSelection: EvidenceSelection; onReturn(qNum: number): void }) {
  const [dialog, setDialog] = useState<DialogState>(null);
  return <>
    <PracticeReadingText body={detail.bodyMarkdown} glossary={detail.glossary} support={detail.practiceSupport} translation={detail.translationVi}
      coverImage={detail.imageUrl ? { src: detail.imageUrl, alt: detail.title } : null}
      evidenceSelection={evidenceSelection} onReturn={onReturn}
      onGlossary={(index) => { if (detail.glossary[index]) setDialog({ kind: 'glossary', entry: detail.glossary[index] }); }}
      onZoom={(src, alt) => setDialog({ kind: 'image', src, alt })} />
    <ReadingDialog contextLink={dialog?.kind === 'glossary' ? contextLinks.find((link) => link.requestTerm === dialog.entry.term) || null : null}
      dialog={dialog} onClose={() => setDialog(null)} />
  </>;
}

function ReadingDialog({ contextLink, dialog, onClose }: { contextLink: ContextLink | null; dialog: DialogState; onClose(): void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!dialog) return undefined;
    previousFocus.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab' || !panel) return;
      const focusable = [...panel.querySelectorAll<HTMLElement>('button,[href],[tabindex]:not([tabindex="-1"])')].filter((node) => !node.hasAttribute('disabled'));
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    panel?.querySelector<HTMLElement>('button')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      previousFocus.current?.focus();
    };
  }, [dialog, onClose]);
  if (!dialog) return null;
  return <div className="rv-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div aria-labelledby="rv-dialog-title" aria-modal="true" className={`rv-dialog rv-dialog--${dialog.kind}`} ref={panelRef} role="dialog">
      <button aria-label="Đóng" className="rv-dialog__close" onClick={onClose} type="button">✕</button>
      {dialog.kind === 'image'
        ? <><h2 className="rv-visually-hidden" id="rv-dialog-title">Xem ảnh bài đọc</h2><img alt={dialog.alt} src={dialog.src} /></>
        : <><h2 id="rv-dialog-title">{dialog.entry.term}</h2>{(dialog.entry.ipa || dialog.entry.pos) && <p className="rv-dialog__meta">{dialog.entry.ipa && `/${String(dialog.entry.ipa).replace(/^\/+|\/+$/g, '')}/`} {dialog.entry.pos}</p>}<p>{dialog.entry.definition}</p>{dialog.entry.example && <p className="rv-dialog__example">“{dialog.entry.example}”</p>}{dialog.entry.synonyms && <p className="rv-dialog__synonyms">Đồng nghĩa: {Array.isArray(dialog.entry.synonyms) ? dialog.entry.synonyms.join(', ') : dialog.entry.synonyms}</p>}{contextLink && <section className="rv-dialog__curated" aria-label="Bài học Vocab Wiki liên quan"><p className="rv-dialog__curated-kicker">VOCAB WIKI{contextLink.level ? ` · ${contextLink.level}` : ''}</p><h3>{contextLink.title}</h3><p>{contextLink.rationale}</p><a className="rv-dialog__curated-link" href={`/vocabulary/learn/${encodeURIComponent(contextLink.unitSlug)}`}>Học cách dùng sâu hơn <span aria-hidden="true">→</span></a></section>}</>}
    </div>
  </div>;
}

function QuestionCard({ answer, isCurrent, library, lockedResult, number, onAnswer, onResult, onLocate, question, slug, sourceSha256 }: {
  answer: string;
  isCurrent(): boolean;
  library: Library;
  lockedResult: CheckResult | null;
  number: number;
  onAnswer(value: string): void;
  onResult(result: CheckResult, submittedAnswer: string): void;
  onLocate(qNum: number, evidence: PracticeEvidence): void;
  question: Question;
  slug: string;
  sourceSha256: string | null;
}) {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<'failed' | 'stale' | null>(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // React dev Strict Mode performs a setup→cleanup→setup probe. Re-arm the
    // guard in setup so that probe cannot make every later ACK look stale.
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!lockedResult || !cardRef.current) return;
    void whenGlobalReady(
      () => typeof (window as any).AverFeedback?.attachCardFlag === 'function',
      'AverFeedback card flag (Reading detail)',
    ).then((ready) => {
      if (ready && mounted.current && cardRef.current) (window as any).AverFeedback.attachCardFlag({
        card: cardRef.current, top: cardRef.current, skill: 'reading', passageSlug: slug,
        qNum: question.qNum, label: 'Báo lỗi câu này',
      });
    });
  }, [lockedResult, question.qNum, slug]);
  const submit = async () => {
    const value = answerForQuestion(question, { [question.qNum]: answer });
    if (!value || lock.current || lockedResult || !isCurrent()) return;
    lock.current = true; setChecking(true); setError(null);
    try {
      const ready = await whenGlobalReady(() => Boolean(window.api?.post), 'window.api POST (Reading detail)');
      if (!mounted.current || !isCurrent()) return;
      if (!ready) throw new Error('api-unavailable');
      const raw = await window.api.post<unknown>(`/api/reading/${library}/${encodeURIComponent(slug)}/check`, {
        answers: [{ q_num: question.qNum, user_answer: value }],
        ...(sourceSha256 ? { source_sha256: sourceSha256 } : {}),
      });
      const result = normalizeReadingCheck(raw, question.qNum) as CheckResult | null;
      if (!result) throw new Error('invalid-check-contract');
      if (mounted.current && isCurrent()) onResult(result, answer);
    } catch (caught) {
      if (mounted.current) setError(statusOf(caught) === 409 ? 'stale' : 'failed');
    } finally {
      lock.current = false;
      if (mounted.current) setChecking(false);
    }
  };
  const disabled = Boolean(lockedResult);
  return <div className="rq-card" id={`rq-card-${question.qNum}`} tabIndex={-1} ref={cardRef}>
    <QuestionPrompt number={number} prompt={question.prompt} />
    <QuestionInput answer={answer} disabled={disabled} onAnswer={onAnswer} question={question} />
    <button className="rq-check" disabled={disabled || checking || !answer.trim()} onClick={() => void submit()} type="button">{checking ? 'Đang kiểm tra…' : lockedResult ? 'Đã kiểm tra' : 'Kiểm tra'}</button>
    {lockedResult && <div className={`rq-feedback ${lockedResult.correct ? 'is-correct' : 'is-incorrect'}`} role="status">
      {lockedResult.correct ? '✓ Đúng rồi!' : `✗ Chưa đúng${lockedResult.skillTag ? ` — gợi ý kỹ năng: ${lockedResult.skillTag}` : ''}${lockedResult.expected ? `. Đáp án: ${lockedResult.expected}` : ''}`}{lockedResult.explanation ? ` — ${lockedResult.explanation}` : ''}
      {lockedResult.evidence && <button className="rq-evidence" type="button" onClick={() => onLocate(question.qNum, lockedResult.evidence!)}>Xem căn cứ trong bài</button>}
    </div>}
    {error && <div className="rq-feedback is-incorrect" role="alert">{error === 'stale'
      ? <>Bài đọc đã thay đổi. <button className="rq-check" type="button" onClick={() => window.location.reload()}>Tải lại bài</button></>
      : 'Không kiểm tra được hoặc phản hồi không đúng contract. Bạn có thể thử lại.'}</div>}
  </div>;
}

function QuestionPrompt({ number, prompt }: { number: number; prompt: string }) {
  const [html, setHtml] = useState('');
  const structured = /\n|\*\*|^\s*\|/m.test(prompt);
  useEffect(() => {
    let disposed = false;
    setHtml('');
    if (!structured) return undefined;
    void whenGlobalReady(() => typeof window.renderMarkdown === 'function', 'window.renderMarkdown (Reading question)').then((ready) => {
      if (!disposed && ready) setHtml(window.renderMarkdown!(prompt, { breaks: true }));
    });
    return () => { disposed = true; };
  }, [prompt, structured]);
  return <div className={`rq-prompt${structured ? ' rq-prompt--structured' : ''}`}>
    {structured ? <><span className="rq-prompt__number">Câu {number}</span>{html
      ? <div className="md-body" dangerouslySetInnerHTML={{ __html: html }} />
      : <div className="rq-prompt__plain">{prompt}</div>}</>
      : <>{number}. {prompt}</>}
  </div>;
}

function QuestionInput({ answer, disabled, onAnswer, question }: {
  answer: string;
  disabled: boolean;
  onAnswer(value: string): void;
  question: Question;
}) {
  const name = `rq-${question.qNum}`;
  const fixed = question.type === 'true_false_not_given'
    ? ['TRUE', 'FALSE', 'NOT GIVEN']
    : question.type === 'yes_no_not_given'
      ? ['YES', 'NO', 'NOT GIVEN']
      : null;
  if (question.type === 'mcq_single' || fixed) {
    const options = fixed?.map((value) => ({ label: value, text: value })) || question.options;
    return <div className="rq-options">{options.map((option) => <label className="rq-option" key={`${option.label}-${option.text}`}><input checked={answer === option.label} disabled={disabled} name={name} onChange={() => onAnswer(option.label)} type="radio" value={option.label} /><span>{option.label === option.text ? option.text : `${option.label}. ${option.text}`}</span></label>)}</div>;
  }
  if (question.type === 'mcq_multi') {
    const selected = new Set(answer.split(',').map((value) => value.trim()).filter(Boolean));
    return <fieldset className="rq-options"><legend>Chọn các đáp án theo yêu cầu đề bài</legend>{question.options.map((option) => <label className="rq-option" key={option.label}>
      <input type="checkbox" checked={selected.has(option.label)} disabled={disabled} onChange={(event) => {
        const next = new Set(selected); if (event.target.checked) next.add(option.label); else next.delete(option.label);
        onAnswer(question.options.filter((item) => next.has(item.label)).map((item) => item.label).join(', '));
      }} value={option.label} /><span>{option.label}. {option.text}</span>
    </label>)}</fieldset>;
  }
  if (['matching_headings', 'matching_features', 'matching_sentence_endings', 'matching_information'].includes(question.type) && question.options.length) {
    return <select aria-label={`Câu ${question.qNum}`} className="rq-input" disabled={disabled} onChange={(event) => onAnswer(event.target.value)} value={answer}><option value="">— Chọn đáp án —</option>{question.options.map((option) => <option key={`${option.label}-${option.text}`} value={option.label}>{option.label === option.text ? option.text : `${option.label}. ${option.text}`}</option>)}</select>;
  }
  return <input aria-label={`Câu ${question.qNum}`} autoComplete="off" className="rq-input" disabled={disabled} onChange={(event) => onAnswer(event.target.value)} placeholder="Nhập câu trả lời…" type="text" value={answer} />;
}

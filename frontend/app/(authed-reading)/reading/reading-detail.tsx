'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
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
type GlossaryEntry = { term: string; definition: string; ipa: string | null; pos: string | null; example: string | null; synonyms: string | string[] };
type GrammarPoint = { point: string; example: string | null; analysis: string | null; review: string | null; tip: string | null };
type Detail = {
  id: string | null;
  slug: string;
  title: string;
  bodyMarkdown: string;
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
};
type CheckResult = { qNum: number; correct: boolean; expected: string; explanation: string | null; skillTag: string | null };
type ContextLink = { requestTerm: string; unitSlug: string; title: string; rationale: string; level: string };
type DialogState =
  | { kind: 'glossary'; entry: GlossaryEntry }
  | { kind: 'image'; src: string; alt: string }
  | null;
type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; detail: NonNullable<Detail> }
  | { status: 'empty' }
  | { status: 'error' };

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

function glossaryHtml(html: string, glossary: GlossaryEntry[]) {
  const documentCopy = new DOMParser().parseFromString(`<div id="reading-root">${html}</div>`, 'text/html');
  const root = documentCopy.getElementById('reading-root');
  if (!root) return html;
  root.querySelectorAll('img').forEach((image) => {
    image.classList.add('prompt-chart-img');
    image.setAttribute('role', 'button');
    image.setAttribute('tabindex', '0');
  });
  const remaining = new Map(glossary.map((entry, index) => [entry.term.toLocaleLowerCase(), index]));
  if (!remaining.size) return root.innerHTML;
  const skip = new Set(['A', 'BUTTON', 'CODE', 'PRE', 'SCRIPT', 'STYLE']);
  const walker = documentCopy.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue?.trim()) return NodeFilter.FILTER_REJECT;
      let parent = node.parentElement;
      while (parent && parent !== root) {
        if (skip.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        parent = parent.parentElement;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    if (!remaining.size || !node.parentNode) break;
    const source = node.nodeValue || '';
    const lower = source.toLocaleLowerCase();
    let match: { at: number; length: number; index: number; term: string } | null = null;
    for (const [term, index] of remaining) {
      let at = lower.indexOf(term);
      while (at >= 0) {
        const before = lower[at - 1]; const after = lower[at + term.length];
        const bounded = (!before || !/[\p{L}\p{N}]/u.test(before)) && (!after || !/[\p{L}\p{N}]/u.test(after));
        if (bounded) break;
        at = lower.indexOf(term, at + term.length);
      }
      if (at >= 0 && (!match || at < match.at)) match = { at, length: term.length, index, term };
    }
    if (!match) continue;
    const fragment = documentCopy.createDocumentFragment();
    fragment.append(source.slice(0, match.at));
    const button = documentCopy.createElement('button');
    button.type = 'button'; button.className = 'glossary-term';
    button.dataset.glossaryIndex = String(match.index);
    button.setAttribute('aria-label', `Định nghĩa: ${glossary[match.index].term}`);
    button.textContent = source.slice(match.at, match.at + match.length);
    fragment.append(button, source.slice(match.at + match.length));
    node.parentNode.replaceChild(fragment, node);
    remaining.delete(match.term);
  }
  return root.innerHTML;
}

export function ReadingDetail({ library, slug }: { library: Library; slug: string }) {
  const { status, user } = useAuth();
  useEffect(() => {
    if (status === 'signed-out') window.location.replace('/login');
  }, [status]);
  const accountKey = status === 'signed-in' && user?.id ? user.id : null;
  return (
    <ReadingDetailWorkspace
      accountKey={accountKey}
      key={`${accountKey || status}|${library}|${slug}`}
      library={library}
      slug={slug}
    />
  );
}

function ReadingDetailWorkspace({ accountKey, library, slug }: {
  accountKey: string | null;
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
        setState(statusOf(caught) === 404 ? { status: 'empty' } : { status: 'error' });
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
    return <ReadingDetailState kind="error" message={messageFor(library, 'error')} />;
  }
  return <ReadingWorkspace accountKey={accountKey} detail={state.detail} library={library} />;
}

function ReadingDetailState({ kind, message }: { kind: 'loading' | 'empty' | 'error'; message: string }) {
  return (
    <div className="shell">
      <main className="rv-shell rv-detail-shell">
        <div className={kind === 'error' ? 'rv-error' : 'rv-empty'} role={kind === 'error' ? 'alert' : 'status'}>
          {message}
        </div>
      </main>
    </div>
  );
}

function ReadingWorkspace({ accountKey, detail, library }: {
  accountKey: string | null;
  detail: NonNullable<Detail>;
  library: Library;
}) {
  const articleRef = useRef<HTMLElement>(null);
  const [progress, setProgress] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [results, setResults] = useState<Record<number, CheckResult>>({});
  const [contextLinks, setContextLinks] = useState<ContextLink[]>([]);
  const correct = Object.values(results).filter((result) => result.correct).length;

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

  const backHref = library === 'vocab' ? '/reading/vocab' : '/reading/skill';
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
                <ReadingPanes contextLinks={contextLinks} detail={detail} />
              </article>
              {detail.questions.length > 0 && (
                <aside className="rv-questions" aria-label={heading}>
                  <div className="rq-head">
                    <div className="rq-head__copy"><span className="rq-kicker">SAU KHI ĐỌC</span><h2 className="rq-title">{heading}</h2><p className="rq-description">{description}</p></div>
                    <div className="rq-summary" aria-live="polite">Đúng {correct}/{detail.questions.length}</div>
                  </div>
                  {detail.questions.map((question, index) => (
                    <QuestionCard
                      answer={answers[question.qNum] || ''}
                      key={question.qNum}
                      library={library}
                      lockedResult={results[question.qNum] || null}
                      number={index + 1}
                      onAnswer={(value) => setAnswers((current) => ({ ...current, [question.qNum]: value }))}
                      onResult={(result) => setResults((current) => current[result.qNum] ? current : ({ ...current, [result.qNum]: result }))}
                      question={question}
                      slug={detail.slug}
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

function ReadingPanes({ contextLinks, detail }: { contextLinks: ContextLink[]; detail: NonNullable<Detail> }) {
  const tabs = useMemo(() => [
    { id: 'original', label: 'Văn bản gốc' },
    ...(detail.translationVi ? [{ id: 'translation', label: 'Bài dịch' }] : []),
    ...(detail.grammarFocus.length ? [{ id: 'grammar', label: 'Phân tích grammar' }] : []),
  ], [detail.grammarFocus.length, detail.translationVi]);
  const [active, setActive] = useState('original');
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
      <div aria-labelledby="rv-tab-original" hidden={active !== 'original'} id="rv-panel-original" role={tabs.length > 1 ? 'tabpanel' : undefined}>
        <ReadingBody contextLinks={contextLinks} detail={detail} />
      </div>
      {detail.translationVi && <div aria-labelledby="rv-tab-translation" className="rv-pane rv-pane--vi md-body" hidden={active !== 'translation'} id="rv-panel-translation" role="tabpanel">
        {detail.translationVi.split(/\n\s*\n/).map((paragraph, index) => paragraph.trim() ? <p key={index}>{paragraph.trim()}</p> : null)}
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

function ReadingBody({ contextLinks, detail }: { contextLinks: ContextLink[]; detail: NonNullable<Detail> }) {
  const [html, setHtml] = useState('');
  const [dialog, setDialog] = useState<DialogState>(null);
  useEffect(() => {
    let disposed = false;
    void whenGlobalReady(() => typeof window.renderMarkdown === 'function', 'window.renderMarkdown (Reading detail)').then((ready) => {
      if (!disposed && ready) setHtml(glossaryHtml(window.renderMarkdown!(detail.bodyMarkdown, { breaks: false }), detail.glossary));
    });
    return () => { disposed = true; };
  }, [detail.bodyMarkdown, detail.glossary]);

  const activate = (target: Element | null) => {
    const glossary = target?.closest<HTMLElement>('.glossary-term');
    const glossaryIndex = glossary ? Number(glossary.dataset.glossaryIndex) : -1;
    if (Number.isInteger(glossaryIndex) && detail.glossary[glossaryIndex]) {
      setDialog({ kind: 'glossary', entry: detail.glossary[glossaryIndex] });
      return true;
    }
    const image = target?.closest('img') as HTMLImageElement | null;
    if (image?.src) {
      setDialog({ kind: 'image', src: image.src, alt: image.alt || detail.title });
      return true;
    }
    return false;
  };
  return (
    <>
      <div
        className="rv-passage__body md-body"
        onClick={(event) => { activate(event.target as Element); }}
        onKeyDown={(event) => {
          if ((event.key === 'Enter' || event.key === ' ') && activate(event.target as Element)) event.preventDefault();
        }}
      >
        {detail.imageUrl && <img alt={detail.title} className="prompt-chart-img" onClick={() => setDialog({ kind: 'image', src: detail.imageUrl!, alt: detail.title })} role="button" src={detail.imageUrl} tabIndex={0} />}
        {html ? <div dangerouslySetInnerHTML={{ __html: html }} /> : <p>{detail.bodyMarkdown}</p>}
      </div>
      <ReadingDialog
        contextLink={dialog?.kind === 'glossary' ? contextLinks.find((link) => link.requestTerm === dialog.entry.term) || null : null}
        dialog={dialog}
        onClose={() => setDialog(null)}
      />
    </>
  );
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

function QuestionCard({ answer, library, lockedResult, number, onAnswer, onResult, question, slug }: {
  answer: string;
  library: Library;
  lockedResult: CheckResult | null;
  number: number;
  onAnswer(value: string): void;
  onResult(result: CheckResult): void;
  question: Question;
  slug: string;
}) {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(false);
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
    if (!value || lock.current || lockedResult) return;
    lock.current = true; setChecking(true); setError(false);
    try {
      const ready = await whenGlobalReady(() => Boolean(window.api?.post), 'window.api POST (Reading detail)');
      if (!ready) throw new Error('api-unavailable');
      const raw = await window.api.post<unknown>(`/api/reading/${library}/${encodeURIComponent(slug)}/check`, {
        answers: [{ q_num: question.qNum, user_answer: value }],
      });
      const result = normalizeReadingCheck(raw, question.qNum) as CheckResult | null;
      if (!result) throw new Error('invalid-check-contract');
      if (mounted.current) onResult(result);
    } catch {
      if (mounted.current) setError(true);
    } finally {
      lock.current = false;
      if (mounted.current) setChecking(false);
    }
  };
  const disabled = Boolean(lockedResult);
  return <div className="rq-card" ref={cardRef}>
    <div className="rq-prompt">{number}. {question.prompt}</div>
    <QuestionInput answer={answer} disabled={disabled} onAnswer={onAnswer} question={question} />
    <button className="rq-check" disabled={disabled || checking || !answer.trim()} onClick={() => void submit()} type="button">{checking ? 'Đang kiểm tra…' : lockedResult ? 'Đã kiểm tra' : 'Kiểm tra'}</button>
    {lockedResult && <div className={`rq-feedback ${lockedResult.correct ? 'is-correct' : 'is-incorrect'}`} role="status">
      {lockedResult.correct ? '✓ Đúng rồi!' : `✗ Chưa đúng${lockedResult.skillTag ? ` — gợi ý kỹ năng: ${lockedResult.skillTag}` : ''}${lockedResult.expected ? `. Đáp án: ${lockedResult.expected}` : ''}`}{lockedResult.explanation ? ` — ${lockedResult.explanation}` : ''}
    </div>}
    {error && <div className="rq-feedback is-incorrect" role="alert">Không kiểm tra được hoặc phản hồi không đúng contract. Bạn có thể thử lại.</div>}
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
  if (question.type === 'matching_headings') {
    return <select aria-label={`Câu ${question.qNum}`} className="rq-input" disabled={disabled} onChange={(event) => onAnswer(event.target.value)} value={answer}><option value="">— Chọn tiêu đề —</option>{question.options.map((option) => <option key={`${option.label}-${option.text}`} value={option.label}>{option.label === option.text ? option.text : `${option.label}. ${option.text}`}</option>)}</select>;
  }
  return <input aria-label={`Câu ${question.qNum}`} autoComplete="off" className="rq-input" disabled={disabled} onChange={(event) => onAnswer(event.target.value)} placeholder="Nhập câu trả lời…" type="text" value={answer} />;
}

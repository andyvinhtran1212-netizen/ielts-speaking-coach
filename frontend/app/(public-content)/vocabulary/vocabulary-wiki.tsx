'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';

import { normalizeVocabularyArticle, vocabularyKey } from '@/lib/vocabulary-model.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

type Word = {
  slug: string; category: string; headword: string; level: string; partOfSpeech: string;
  pronunciation: string; glossVi: string; audioHeadword: string;
};
type Category = { slug: string; title: string; articleCount: number; articles: Word[] };
type Article = Word & {
  syllables: string; audioExample: string; definitionEn: string; definitionVi: string;
  example: string; collocations: string[]; synonyms: string[]; antonyms: string[];
  relatedWords: string[]; wordFamily: string[]; commonError: string; memoryHook: string;
  register: string; source: string; html: string;
};
type DetailState =
  | { key: string; status: 'loading' }
  | { key: string; status: 'error' }
  | { key: string; status: 'ready'; article: Article };

function prettyCategory(value: string) {
  return value.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function orthographicParts(value: string) {
  const parts = value.trim().split('-').map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return null;
  let primary = parts.findIndex((part) => /[A-Z]/.test(part));
  if (primary < 0 && parts.length === 1) primary = 0;
  return primary < 0 ? null : { parts, primary };
}

function stressParts(value: string) {
  const clean = value.replace(/\//g, '').trim();
  if (!clean || /\s/.test(clean)) return null;
  const parts = clean.replace(/([ˈˌ])/g, '|$1').replace(/\./g, '|').split('|').filter(Boolean);
  let primary = parts.findIndex((part) => part.startsWith('ˈ'));
  if (primary < 0 && parts.length === 1) primary = 0;
  return primary < 0 ? null : { parts: parts.map((part) => part.replace(/[ˈˌ]/g, '')), primary };
}

function StressSpecimen({ article }: { article: Article }) {
  const specimen = orthographicParts(article.syllables) || stressParts(article.pronunciation);
  if (!specimen) return null;
  return (
    <div className="va-stress" aria-hidden="true">
      {specimen.parts.map((part, index) => <span className={`va-syl${index === specimen.primary ? ' on' : ''}`} key={`${part}-${index}`}>{part}</span>)}
      <span className="va-stress-tag">trọng âm {specimen.primary + 1}</span>
    </div>
  );
}

function IpaLine({ article }: { article: Article }) {
  const specimen = orthographicParts(article.syllables) || stressParts(article.pronunciation);
  if (specimen || !article.pronunciation.includes('ˈ')) return <>{article.pronunciation}</>;
  const match = article.pronunciation.match(/^(.*?ˈ)([^ˈˌ./\s]+)(.*)$/);
  if (!match) return <>{article.pronunciation}</>;
  return <>{match[1]}<span className="va-st">{match[2]}</span>{match[3]}</>;
}

function CalloutIcon({ kind }: { kind: 'warn' | 'hook' }) {
  return kind === 'warn' ? (
    <svg className="va-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    </svg>
  ) : (
    <svg className="va-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 18h6" /><path d="M10 22h4" /><path d="M12 2a7 7 0 0 0-4 12.7c.5.4.8 1 .9 1.6l.1.7h6l.1-.7c.1-.6.4-1.2.9-1.6A7 7 0 0 0 12 2z" />
    </svg>
  );
}

function HighlightedExample({ example, headword }: { example: string; headword: string }) {
  if (!headword) return <>{example}</>;
  const escaped = headword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pieces = example.split(new RegExp(`(${escaped})`, 'ig'));
  return <>{pieces.map((piece, index) => piece.toLowerCase() === headword.toLowerCase()
    ? <span className="va-w" key={index}>{piece}</span>
    : <Fragment key={index}>{piece}</Fragment>)}</>;
}

function PlayIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>;
}

function PlayButton({ audio, say, small = false, onPlay }: {
  audio: string; say: string; small?: boolean; onPlay(audio: string, say: string, button: HTMLButtonElement): void;
}) {
  return (
    <button type="button" className={`va-play${small ? ' va-small va-ghost' : ''}`} aria-label={`Nghe ${say}`}
      onClick={(event) => { event.preventDefault(); event.stopPropagation(); onPlay(audio, say, event.currentTarget); }}>
      <PlayIcon />
    </button>
  );
}

function NetRow({ label, values }: { label: string; values: string[] }) {
  if (!values.length) return null;
  return <><dt>{label}</dt><dd>{values.map((value, index) => <Fragment key={`${value}-${index}`}><b>{value}</b>{index < values.length - 1 ? <span className="va-sep">·</span> : null}</Fragment>)}</dd></>;
}

function FlagControl({ article }: { article: Article }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function send(reason: 'content' | 'audio') {
    setStatus('sending');
    try {
      const ready = await whenGlobalReady(() => !!window.api?.post, 'window.api (vocabulary feedback)');
      if (!ready) throw new Error('api-not-ready');
      await window.api.post('/api/feedback', {
        type: 'report', skill: 'vocabulary', vocab_slug: article.slug,
        vocab_category: article.category,
        category: reason === 'audio' ? 'audio_issue' : 'content_issue',
      });
      setStatus('sent');
    } catch {
      setStatus('error');
    }
  }

  return (
    <span className="va-flag-wrap">
      <button type="button" className="va-flag" aria-haspopup="true" aria-expanded={open}
        aria-label="Báo lỗi thẻ từ này" onClick={() => { setOpen((value) => !value); setStatus('idle'); }}>
        <span aria-hidden="true">⚑</span> Báo lỗi
      </button>
      {open ? <span className="va-flag-menu" role="menu">
        {status === 'sent' ? <span className="va-flag-done">✓ Đã gửi, cảm ơn!</span> : <>
          <span className="va-flag-q">Báo lỗi về:</span>
          <button type="button" className="va-flag-opt" role="menuitem" disabled={status === 'sending'} onClick={() => void send('content')}>Nội dung</button>
          <button type="button" className="va-flag-opt" role="menuitem" disabled={status === 'sending'} onClick={() => void send('audio')}>Âm thanh</button>
          {status === 'error' ? <span className="va-flag-status" role="status" aria-live="polite">Không gửi được, thử lại.</span> : null}
        </>}
      </span> : null}
    </span>
  );
}

function ArticleCard({ article, onPlay }: { article: Article; onPlay(audio: string, say: string, button: HTMLButtonElement): void }) {
  const definitionVi = article.definitionVi.trim() || article.glossVi;
  const network = article.synonyms.length || article.antonyms.length || article.relatedWords.length || article.wordFamily.length;
  const hasStructuredBody = article.example.trim() || article.memoryHook.trim();
  const fallbackHtml = hasStructuredBody ? '' : article.html.replace(/^\s*<p>[\s\S]*?<\/p>\s*/, '').trim();
  return (
    <>
      <div className="va-card va-detail va-reveal">
        <div className="va-pad">
          <div className="va-eyebrow-row">
            <span className="va-eyebrow">{prettyCategory(article.category)}</span>
            <span className="va-eyebrow-actions">
              {article.level ? <span className="va-pill">{article.level}</span> : null}
              <FlagControl article={article} />
            </span>
          </div>
          <div className="va-head">
            <h2 className="va-headword">{article.headword}</h2>
            <PlayButton audio={article.audioHeadword} say={article.headword} onPlay={onPlay} />
          </div>
          {article.pronunciation ? <p className="va-ipa"><IpaLine article={article} />{article.partOfSpeech ? <span className="va-pos"> · {article.partOfSpeech}</span> : null}</p> : null}
          <StressSpecimen article={article} />
        </div>
        {article.definitionEn || definitionVi ? <><div className="va-rule" /><div className="va-pad">
          {article.definitionEn ? <p className="va-def-en">{article.definitionEn}</p> : null}
          {definitionVi ? <p className="va-def-vi">{definitionVi}</p> : null}
        </div></> : null}
        {article.example || article.collocations.length ? <><div className="va-rule" /><div className="va-pad">
          {article.example ? <><div className="va-use-head"><span className="va-eyebrow">Dùng khi nói</span><PlayButton audio={article.audioExample} say={article.example} small onPlay={onPlay} /></div>
            <p className="va-example">“<HighlightedExample example={article.example} headword={article.headword} />”</p></> : null}
          {article.collocations.length ? <div className="va-colloc">{article.collocations.map((item) => <span className="va-chip" key={item}>{item}</span>)}</div> : null}
        </div></> : null}
        {network ? <><div className="va-rule" /><div className="va-pad"><dl className="va-net">
          <NetRow label="Đồng nghĩa" values={article.synonyms} /><NetRow label="Trái nghĩa" values={article.antonyms} />
          <NetRow label="Từ liên quan" values={article.relatedWords} /><NetRow label="Họ từ" values={article.wordFamily} />
        </dl></div></> : null}
        {article.commonError || article.memoryHook ? <><div className="va-rule" /><div className="va-pad">
          {article.commonError ? <div className="va-callout va-warn"><CalloutIcon kind="warn" /><div><span className="va-t">Hay nhầm</span>{article.commonError}</div></div> : null}
          {article.memoryHook ? <div className="va-callout va-hook"><CalloutIcon kind="hook" /><div><span className="va-t">Mẹo nhớ</span>{article.memoryHook}</div></div> : null}
        </div></> : null}
        {article.register || article.source ? <><div className="va-rule" /><div className="va-pad va-foot"><span className="va-trace">
          {article.register ? <>register <b>{article.register}</b></> : null}
          {article.register && article.source ? ' · ' : null}
          {article.source ? <>nguồn <b>{article.source}</b></> : null}
        </span></div></> : null}
      </div>
      {fallbackHtml ? <div id="article-body" className="md-body" dangerouslySetInnerHTML={{ __html: fallbackHtml }} /> : null}
    </>
  );
}

export function VocabularyWiki({ categories, initialArticle, initialCategory, initialSlug }: {
  categories: Category[]; initialArticle: Article | null; initialCategory: string; initialSlug: string;
}) {
  const words = useMemo(() => categories.flatMap((category) => category.articles), [categories]);
  const validInitialCategory = categories.some((category) => category.slug === initialCategory) ? initialCategory : '';
  const requestedWord = words.find((word) => word.slug === initialSlug && (!initialCategory || word.category === initialCategory));
  const initialWord = initialArticle || requestedWord || (!initialSlug ? words[0] : null);
  const initialKey = initialWord ? vocabularyKey(initialWord.category, initialWord.slug) : '';
  const [category, setCategory] = useState(validInitialCategory);
  const [query, setQuery] = useState('');
  const [showDetail, setShowDetail] = useState(Boolean(initialSlug));
  const [desktopDetailVisible, setDesktopDetailVisible] = useState(false);
  const [detail, setDetail] = useState<DetailState | null>(initialArticle
    ? { key: initialKey, status: 'ready', article: initialArticle }
    : initialWord || initialSlug
      ? { key: initialKey || vocabularyKey(initialCategory, initialSlug), status: 'error' }
      : null);
  const requestRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const analyticsRef = useRef(new Set<string>());
  const selectedKey = detail?.key || initialKey;
  const visibleWords = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('vi');
    return words.filter((word) => (!category || word.category === category)
      && (!needle || word.headword.toLocaleLowerCase('vi').includes(needle) || word.glossVi.toLocaleLowerCase('vi').includes(needle)));
  }, [category, query, words]);

  useEffect(() => () => {
    requestRef.current?.abort();
    audioRef.current?.pause();
    window.speechSynthesis?.cancel();
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 861px)');
    const sync = () => setDesktopDetailVisible(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (detail?.status !== 'ready'
      || (!showDetail && !desktopDetailVisible)
      || analyticsRef.current.has(detail.key)) return;
    analyticsRef.current.add(detail.key);
    try {
      const sessionId = sessionStorage.getItem('vocab_session_id') || crypto.randomUUID();
      sessionStorage.setItem('vocab_session_id', sessionId);
      void whenGlobalReady(() => !!window.api?.post, 'window.api (vocabulary analytics)').then((ready) => {
        if (ready) void window.api.post('/api/analytics/events', {
          event_name: 'vocab_wiki_viewed',
          event_data: { slug: detail.article.slug, category: detail.article.category },
          session_id: sessionId,
        }).catch(() => undefined);
      });
    } catch { /* analytics is best effort */ }
  }, [desktopDetailVisible, detail, showDetail]);

  function play(audio: string, say: string, button: HTMLButtonElement) {
    window.speechSynthesis?.cancel();
    audioRef.current?.pause();
    audioRef.current = null;
    const speak = () => {
      if (!say || !window.speechSynthesis) return;
      const utterance = new SpeechSynthesisUtterance(say);
      utterance.lang = 'en-GB'; utterance.rate = 0.92;
      button.classList.add('is-playing');
      utterance.onend = utterance.onerror = () => button.classList.remove('is-playing');
      window.speechSynthesis.speak(utterance);
    };
    if (!audio) { speak(); return; }
    const player = new Audio(audio);
    audioRef.current = player;
    button.classList.add('is-playing');
    player.onended = () => button.classList.remove('is-playing');
    void player.play().catch(() => { button.classList.remove('is-playing'); speak(); });
  }

  async function selectWord(word: Word) {
    const key = vocabularyKey(word.category, word.slug);
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setShowDetail(true);
    setDetail({ key, status: 'loading' });
    try {
      const ready = await whenGlobalReady(() => !!window.api?.getWith, 'window.api (vocabulary article)');
      if (!ready || controller.signal.aborted) throw new Error('api-not-ready');
      const payload = await window.api.getWith(
        `/api/vocabulary/articles/${encodeURIComponent(word.category)}/${encodeURIComponent(word.slug)}`,
        undefined,
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      const article = normalizeVocabularyArticle(payload, word.category, word.slug) as Article;
      setDetail({ key, status: 'ready', article });
      window.history.replaceState(null, '', `/vocabulary?cat=${encodeURIComponent(word.category)}&slug=${encodeURIComponent(word.slug)}`);
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === 'AbortError')) setDetail({ key, status: 'error' });
    }
  }

  return (
    <div className={`vmd-shell${showDetail ? ' show-detail' : ''}`} id="vmd-shell">
      <aside className="vmd-list">
        <div className="vmd-list-head">
          <span className="va-eyebrow">📚 Vocabulary Wiki</span>
          <h1 className="vmd-title">Từ vựng theo chủ đề</h1>
          <span className="vmd-count">{visibleWords.length} từ{query || category ? ' (lọc)' : ''}</span>
          <div className="vmd-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
            <input type="search" placeholder="Tìm từ…" aria-label="Tìm từ vựng" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          <div className="vmd-chips" role="group" aria-label="Lọc theo chủ đề">
            <button type="button" aria-pressed={!category} className={`vmd-chip${!category ? ' is-active' : ''}`} onClick={() => setCategory('')}>Tất cả <span className="va-mono">{words.length}</span></button>
            {categories.filter((item) => item.articleCount).map((item) => <button type="button" aria-pressed={category === item.slug}
              className={`vmd-chip${category === item.slug ? ' is-active' : ''}`} key={item.slug} onClick={() => setCategory(item.slug)}>
              {item.title} <span className="va-mono">{item.articleCount}</span>
            </button>)}
          </div>
        </div>
        <div className="vmd-rows" aria-label="Danh sách từ">
          {visibleWords.length ? visibleWords.map((word) => <div className={`vmd-row${selectedKey === vocabularyKey(word.category, word.slug) ? ' active' : ''}`}
            data-category={word.category} data-slug={word.slug} key={vocabularyKey(word.category, word.slug)}>
            <PlayButton audio={word.audioHeadword} say={word.headword} small onPlay={play} />
            <button type="button" className="vmd-row-main" onClick={() => void selectWord(word)}>
              <span className="vmd-rw">{word.headword}</span><span className="vmd-rmeta">{word.pronunciation}{word.partOfSpeech ? ` · ${word.partOfSpeech}` : ''}</span>
            </button>
            {word.level ? <span className="vmd-rlvl">{word.level}</span> : null}
          </div>) : <p className="va-empty">Không tìm thấy từ nào.</p>}
        </div>
      </aside>
      <section className="vmd-detail" aria-live="polite">
        <button type="button" className="vmd-back" aria-label="Quay lại danh sách" onClick={() => setShowDetail(false)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg> Danh sách từ
        </button>
        {!detail ? <p className="va-empty">Chọn một từ ở danh sách để xem chi tiết.</p> : null}
        {detail?.status === 'loading' ? <p className="va-empty">Đang tải…</p> : null}
        {detail?.status === 'error' ? <p className="va-empty" role="alert">Không tải được từ này.</p> : null}
        {detail?.status === 'ready' ? <ArticleCard article={detail.article} onPlay={play} /> : null}
      </section>
    </div>
  );
}

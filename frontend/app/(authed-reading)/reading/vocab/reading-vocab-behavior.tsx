'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { readingVocabArticleHref, readingVocabContext, readingVocabHref } from '@/lib/reading-vocab-context.mjs';

import { useAuth } from '@/lib/auth/auth-provider';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

import { ReadingVocabShell } from './page-shell';

interface RawPassage {
  id?: unknown;
  slug?: unknown;
  title?: unknown;
  excerpt?: unknown;
  difficulty_level?: unknown;
  topic_tags?: unknown;
  word_count?: unknown;
  estimated_minutes?: unknown;
}

interface Passage {
  key: string;
  slug: string;
  title: string;
  excerpt: string;
  difficulty: string | null;
  tags: string[];
  wordCount: number | null;
  estimatedMinutes: number | null;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; passages: Passage[]; total: number; view: string }
  | { status: 'error' };

const DIFFICULTY_LABELS: Record<string, string> = {
  foundation: 'Foundation',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};
const PAGE_SIZE = 24;

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveInteger(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : null;
}

function normalizePassages(payload: unknown): Passage[] {
  const items = payload && typeof payload === 'object'
    ? (payload as { items?: unknown }).items
    : null;
  if (!Array.isArray(items)) return [];

  return items.flatMap((raw: RawPassage, index) => {
    const slug = textValue(raw?.slug);
    if (!slug) return [];
    const tags = Array.isArray(raw?.topic_tags)
      ? [...new Set(raw.topic_tags.map(textValue).filter(Boolean))]
      : [];
    const id = textValue(raw?.id);
    return [{
      key: `${id || slug}-${index}`,
      slug,
      title: textValue(raw?.title) || 'Bài đọc',
      excerpt: textValue(raw?.excerpt),
      difficulty: textValue(raw?.difficulty_level) || null,
      tags,
      wordCount: positiveInteger(raw?.word_count),
      estimatedMinutes: positiveInteger(raw?.estimated_minutes),
    }];
  });
}

function normalizeTotal(payload: unknown, shown: number): number {
  if (!payload || typeof payload !== 'object') return shown;
  const total = (payload as { total?: unknown }).total;
  return typeof total === 'number' && Number.isFinite(total) && total >= 0
    ? total
    : shown;
}

export function ReadingVocabBehavior() {
  const { status, user } = useAuth();

  useEffect(() => {
    if (status === 'signed-out') window.location.replace('/login');
  }, [status]);

  const accountKey = status === 'signed-in' && user?.id ? user.id : null;
  return <ReadingVocabLibrary accountKey={accountKey} key={accountKey || status} />;
}

function ReadingVocabLibrary({ accountKey }: { accountKey: string | null }) {
  const params = useSearchParams();
  const context = readingVocabContext(params || undefined);
  const { difficulty, tag, batches } = context;
  const contextHref = readingVocabHref(context);
  const cached = useRef<{ key: string; batches: number; passages: Passage[]; total: number } | null>(null);
  const scrollKey = accountKey ? `aver:reading-vocab-scroll:v1:${accountKey}:${contextHref}` : null;
  const changeFilters = (update: { difficulty?: string; tag?: string }) => {
    const latest = readingVocabContext(new URLSearchParams(window.location.search));
    window.history.replaceState(null, '', readingVocabHref({ ...latest, ...update, batches: 1 }));
  };
  const loadMore = () => {
    const latest = readingVocabContext(new URLSearchParams(window.location.search));
    window.history.replaceState(null, '', readingVocabHref({ ...latest, batches: latest.batches + 1 }));
  };
  const rememberScroll = () => {
    if (!scrollKey) return;
    try { window.sessionStorage.setItem(scrollKey, String(window.scrollY)); } catch { /* navigation stays usable */ }
  };
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    if (!accountKey) {
      setState({ status: 'loading' });
      return undefined;
    }

    const controller = new AbortController();
    let disposed = false;
    const filterKey = `${accountKey}:${difficulty}:${tag}`;
    const prior = cached.current?.key === filterKey && cached.current.batches < batches ? cached.current : null;
    if (!prior) setState({ status: 'loading' });
    else setLoadingMore(true);
    setLoadMoreError(false);

    (async () => {
      const ready = await whenGlobalReady(
        () => !!window.api?.getWith,
        'window.api (reading vocab)',
      );
      if (!ready || disposed) throw new Error('api-unavailable');
      let passages = prior?.passages || [];
      let total = prior?.total || 0;
      let loaded = prior?.batches || 0;
      // Restore every batch, rather than treating the final offset as a page.
      for (let batch = loaded; batch < batches; batch += 1) {
        const offset = batch * PAGE_SIZE;
        const query = new URLSearchParams();
        if (difficulty) query.set('difficulty', difficulty);
        if (tag) query.set('tag', tag);
        query.set('limit', String(PAGE_SIZE));
        query.set('offset', String(offset));
        const payload = await window.api!.getWith<unknown>(
          `/api/reading/vocab?${query.toString()}`, undefined, { signal: controller.signal },
        );
        if (disposed) return;
        const next = normalizePassages(payload);
        total = normalizeTotal(payload, offset + next.length);
        passages = [...passages, ...next].filter((passage, index, all) =>
          all.findIndex((candidate) => candidate.slug === passage.slug) === index);
        loaded = batch + 1;
        if (!next.length || offset + next.length >= total) break;
      }
      if (disposed) return;
      cached.current = { key: filterKey, batches: loaded, passages, total };
      setAvailableTags((current) => [...new Set([
        ...current, ...passages.flatMap((passage) => passage.tags), ...(tag ? [tag] : []),
      ])].sort());
      setState({ status: 'ready', passages, total, view: contextHref });
    })().catch((caught: unknown) => {
      if (disposed || (caught instanceof DOMException && caught.name === 'AbortError')) return;
      if (prior) setLoadMoreError(true);
      else setState({ status: 'error' });
    }).finally(() => { if (!disposed) setLoadingMore(false); });

    return () => { disposed = true; controller.abort(); };
  }, [accountKey, difficulty, tag, batches, retryToken]);

  useEffect(() => {
    if (state.status !== 'ready' || state.view !== contextHref || !scrollKey || loadingMore) return;
    let savedTop: number | null = null;
    try {
      const raw = window.sessionStorage.getItem(scrollKey);
      const top = Number(raw);
      if (raw !== null && Number.isFinite(top) && top >= 0) savedTop = top;
    } catch { /* storage is optional for scroll */ }
    const frame = requestAnimationFrame(() => {
      if (savedTop !== null) window.scrollTo({ top: savedTop, behavior: 'instant' });
    });
    window.addEventListener('scroll', rememberScroll, { passive: true });
    window.addEventListener('pagehide', rememberScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', rememberScroll);
      window.removeEventListener('pagehide', rememberScroll);
    };
  }, [state.status, state.status === 'ready' ? state.view : null, scrollKey, loadingMore]);

  const shown = state.status === 'ready' ? state.passages.length : 0;
  const total = state.status === 'ready' ? state.total : null;
  const resultText = state.status === 'loading'
    ? 'Đang cập nhật danh sách…'
    : state.status === 'error'
      ? 'Không thể tải danh sách'
      : total !== null && total > shown
        ? `${total} bài đọc phù hợp · đang hiển thị ${shown}`
        : `${total} bài đọc phù hợp`;
  const hasFilters = Boolean(difficulty || tag);

  return (
    <ReadingVocabShell totalCount={total ?? '—'}>
      <section className="rv-library" aria-labelledby="rv-library-title">
        <header className="rv-library__toolbar">
          <div>
            <p className="rv-kicker">THƯ VIỆN BÀI ĐỌC</p>
            <h2 id="rv-library-title">Chọn một bài để bắt đầu</h2>
            <p className="rv-result-count" id="rv-result-count" aria-live="polite">
              {resultText}
            </p>
          </div>
          <div className="rv-filters">
            <label>
              Trình độ
              <select
                id="filter-difficulty"
                value={difficulty}
                onChange={(event) => changeFilters({ difficulty: event.target.value })}
              >
                <option value="">Tất cả</option>
                <option value="foundation">Foundation</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </select>
            </label>
            <label>
              Chủ đề
              <select id="filter-tag" value={tag} onChange={(event) => changeFilters({ tag: event.target.value })}>
                <option value="">Tất cả</option>
                {[...new Set([...availableTags, ...(tag ? [tag] : [])])].map((value) => <option value={value} key={value}>{value}</option>)}
              </select>
            </label>
            <button
              className="rv-filter-reset"
              id="clear-filters"
              type="button"
              hidden={!hasFilters}
              onClick={() => {
                changeFilters({ difficulty: '', tag: '' });
              }}
            >
              Xóa lọc
            </button>
          </div>
        </header>

        {state.status === 'loading' ? (
          <div className="rv-empty" id="state-loading">Đang chuẩn bị bài đọc…</div>
        ) : null}
        {state.status === 'ready' && !state.passages.length ? (
          <div className="rv-empty" id="state-empty">Chưa có bài đọc nào khớp bộ lọc.</div>
        ) : null}
        {state.status === 'error' ? (
          <div className="rv-error" id="state-error">Không tải được thư viện. Vui lòng thử lại.</div>
        ) : null}
        {state.status === 'ready' && state.passages.length ? (
          <><div className="rv-grid rv-grid--articles" id="rv-grid">
            {state.passages.map((passage) => {
              const difficultyLabel = passage.difficulty
                ? DIFFICULTY_LABELS[passage.difficulty] || passage.difficulty
                : 'Mọi trình độ';
              return (
                <a
                  aria-label={`Đọc bài ${passage.title}`}
                  className="rv-card"
                  href={readingVocabArticleHref(passage.slug, context)}
                  onClick={rememberScroll}
                  key={passage.key}
                >
                  <div className="rv-card__top">
                    <span className="rv-card__type">TỪ VỰNG TRONG NGỮ CẢNH</span>
                    {passage.estimatedMinutes ? (
                      <span className="rv-card__time">{passage.estimatedMinutes} PHÚT</span>
                    ) : null}
                  </div>
                  <h3>{passage.title}</h3>
                  <p className="rv-card__excerpt">{passage.excerpt}</p>
                  <div className="rv-meta">
                    {passage.tags.slice(0, 2).map((value) => (
                      <span className="rv-pill" key={value}>{value}</span>
                    ))}
                    {passage.wordCount ? <span className="rv-pill">{passage.wordCount} từ</span> : null}
                  </div>
                  <div className="rv-card__footer">
                    <span className="rv-pill is-brand">{difficultyLabel}</span>
                    <span className="rv-card__cta">Đọc &amp; tra từ <span aria-hidden="true">→</span></span>
                  </div>
                </a>
              );
            })}
          </div>
          {total !== null && shown < total ? (
            <div className="rv-load-more">
              {loadMoreError ? <p role="alert">Chưa tải được trang tiếp theo.</p> : null}
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => loadMoreError
                  ? setRetryToken((value) => value + 1)
                  : loadMore()}
              >
                {loadingMore ? 'Đang tải…' : loadMoreError ? 'Thử lại' : `Xem thêm (${shown}/${total})`}
              </button>
            </div>
          ) : null}</>
        ) : null}
      </section>
    </ReadingVocabShell>
  );
}

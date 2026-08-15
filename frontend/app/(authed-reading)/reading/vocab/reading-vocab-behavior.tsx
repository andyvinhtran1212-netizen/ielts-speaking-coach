'use client';

import { useEffect, useState } from 'react';

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
  | { status: 'ready'; passages: Passage[]; total: number }
  | { status: 'error' };

const DIFFICULTY_LABELS: Record<string, string> = {
  foundation: 'Foundation',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

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
  const [difficulty, setDifficulty] = useState('');
  const [tag, setTag] = useState('');
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    if (!accountKey) {
      setState({ status: 'loading' });
      return undefined;
    }

    const controller = new AbortController();
    let disposed = false;
    setState({ status: 'loading' });

    (async () => {
      const ready = await whenGlobalReady(
        () => !!window.api?.getWith,
        'window.api (reading vocab)',
      );
      if (!ready || disposed) {
        if (!disposed) setState({ status: 'error' });
        return;
      }

      const query = new URLSearchParams();
      if (difficulty) query.set('difficulty', difficulty);
      if (tag) query.set('tag', tag);
      query.set('limit', '50');

      try {
        const payload = await window.api.getWith<unknown>(
          `/api/reading/vocab?${query.toString()}`,
          undefined,
          { signal: controller.signal },
        );
        if (disposed) return;
        const passages = normalizePassages(payload);
        setAvailableTags((current) => {
          if (current.length) return current;
          return [...new Set(passages.flatMap((passage) => passage.tags))].sort();
        });
        setState({ status: 'ready', passages, total: normalizeTotal(payload, passages.length) });
      } catch (caught: unknown) {
        if (disposed || (caught instanceof DOMException && caught.name === 'AbortError')) return;
        setState({ status: 'error' });
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [accountKey, difficulty, tag]);

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
                onChange={(event) => setDifficulty(event.target.value)}
              >
                <option value="">Tất cả</option>
                <option value="foundation">Foundation</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </select>
            </label>
            <label>
              Chủ đề
              <select id="filter-tag" value={tag} onChange={(event) => setTag(event.target.value)}>
                <option value="">Tất cả</option>
                {availableTags.map((value) => <option value={value} key={value}>{value}</option>)}
              </select>
            </label>
            <button
              className="rv-filter-reset"
              id="clear-filters"
              type="button"
              hidden={!hasFilters}
              onClick={() => {
                setDifficulty('');
                setTag('');
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
          <div className="rv-grid rv-grid--articles" id="rv-grid">
            {state.passages.map((passage) => {
              const difficultyLabel = passage.difficulty
                ? DIFFICULTY_LABELS[passage.difficulty] || passage.difficulty
                : 'Mọi trình độ';
              return (
                <a
                  aria-label={`Đọc bài ${passage.title}`}
                  className="rv-card"
                  href={`/pages/reading-vocab-passage.html?slug=${encodeURIComponent(passage.slug)}`}
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
        ) : null}
      </section>
    </ReadingVocabShell>
  );
}

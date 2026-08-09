'use client';

import { useEffect, useState } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

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
  | { status: 'ready'; passages: Passage[] }
  | { status: 'error'; message: string };

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

function errorMessage(caught: unknown): string {
  return caught instanceof Error && caught.message ? ` ${caught.message}` : '';
}

export function ReadingVocabBehavior() {
  const { status, user } = useAuth();

  useEffect(() => {
    if (status === 'signed-out') window.location.replace('/login.html');
  }, [status]);

  if (status !== 'signed-in' || !user?.id) {
    return <div className="rv-empty" id="state-loading">Đang tải…</div>;
  }

  return <ReadingVocabLibrary accountKey={user.id} key={user.id} />;
}

function ReadingVocabLibrary({ accountKey }: { accountKey: string }) {
  const [difficulty, setDifficulty] = useState('');
  const [tag, setTag] = useState('');
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    setState({ status: 'loading' });

    (async () => {
      const ready = await whenGlobalReady(
        () => !!window.api?.getWith,
        'window.api (reading vocab)',
      );
      if (!ready || disposed) {
        if (!disposed) setState({ status: 'error', message: '' });
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
        setState({ status: 'ready', passages });
      } catch (caught: unknown) {
        if (disposed || (caught instanceof DOMException && caught.name === 'AbortError')) return;
        setState({ status: 'error', message: errorMessage(caught) });
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [accountKey, difficulty, tag]);

  return (
    <>
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
      </div>

      {state.status === 'loading' ? (
        <div className="rv-empty" id="state-loading">Đang tải…</div>
      ) : null}
      {state.status === 'ready' && !state.passages.length ? (
        <div className="rv-empty" id="state-empty">Chưa có bài đọc nào khớp bộ lọc.</div>
      ) : null}
      {state.status === 'error' ? (
        <div className="rv-error" id="state-error">Không tải được thư viện.{state.message}</div>
      ) : null}
      {state.status === 'ready' && state.passages.length ? (
        <div className="rv-grid" id="rv-grid">
          {state.passages.map((passage) => (
            <a
              className="rv-card"
              href={`/pages/reading-vocab-passage.html?slug=${encodeURIComponent(passage.slug)}`}
              key={passage.key}
            >
              <h3>{passage.title}</h3>
              <div className="rv-card__excerpt">{passage.excerpt}</div>
              <div className="rv-meta">
                {passage.difficulty ? <span className="rv-pill is-brand">{passage.difficulty}</span> : null}
                {passage.tags.slice(0, 2).map((value) => (
                  <span className="rv-pill" key={value}>{value}</span>
                ))}
                {passage.estimatedMinutes ? <span className="rv-pill">{passage.estimatedMinutes}p</span> : null}
                {passage.wordCount ? <span className="rv-pill">{passage.wordCount} từ</span> : null}
              </div>
            </a>
          ))}
        </div>
      ) : null}
    </>
  );
}

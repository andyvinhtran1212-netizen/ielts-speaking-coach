'use client';

import { useEffect, useMemo, useState } from 'react';

import { whenGlobalReady } from '@/lib/when-global-ready.mjs';
import { FeaturedCards, type Article } from '../grammar-cards';

type Filters = { level: string; use: string };

function relevance(article: Article, use: string) {
  if (!use) return true;
  const value = article as Article & { speaking_relevance?: string; writing_relevance?: string; category?: string };
  if (use === 'speaking') return value.speaking_relevance === 'high';
  if (use === 'writing') return value.writing_relevance === 'high' || value.category === 'grammar-for-writing';
  if (use === 'reading') return value.category === 'grammar-for-reading';
  return true;
}

export function GrammarSearchBehavior({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [initial, setInitial] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Article[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState<Filters>({ level: '', use: '' });

  useEffect(() => {
    searchParams.then((params) => {
      const value = typeof params.q === 'string' ? params.q : '';
      const level = typeof params.level === 'string' && ['beginner', 'intermediate', 'advanced'].includes(params.level) ? params.level : '';
      const use = typeof params.use === 'string' && ['speaking', 'writing', 'reading'].includes(params.use) ? params.use : '';
      setInitial(value);
      setQuery(value);
      setFilters({ level, use });
    });
  }, [searchParams]);

  useEffect(() => {
    if (initial.trim().length < 2) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    (async () => {
      const ready = await whenGlobalReady(() => !!window.api?.getWith, 'window.api (grammar search)');
      if (!ready) throw new Error('API chưa sẵn sàng');
      return window.api.getWith<Article[]>(`/api/grammar/search?q=${encodeURIComponent(initial.trim())}`, undefined, { signal: controller.signal });
    })().then((items) => setResults(Array.isArray(items) ? items : []))
      .catch((caught: any) => { if (caught?.name !== 'AbortError') setError('Không tải được kết quả. Vui lòng thử lại.'); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [initial]);

  const visible = useMemo(() => results.filter((article) => {
    const levelOk = !filters.level || article.level?.toLowerCase() === filters.level;
    return levelOk && relevance(article, filters.use);
  }), [results, filters]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const value = query.trim();
    if (value.length < 2) return;
    replaceSearchUrl(value, filters);
    setInitial(value);
  };

  const updateFilters = (next: Filters) => {
    setFilters(next);
    if (initial) replaceSearchUrl(initial, next);
  };

  return (
    <div className="gw-search-workspace">
      <form onSubmit={submit} className="gw-search-command" role="search">
        <label htmlFor="grammar-search-query" className="sr-only">Từ khóa ngữ pháp</label>
        <input id="grammar-search-query" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ví dụ: present perfect, articles, complex sentence…" />
        <button type="submit">Tìm bài</button>
      </form>
      <div className="gw-filter-row" aria-label="Bộ lọc kết quả">
        <label>Trình độ
          <select value={filters.level} onChange={(event) => updateFilters({ ...filters, level: event.target.value })}>
            <option value="">Tất cả</option><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option>
          </select>
        </label>
        <label>Mục tiêu
          <select value={filters.use} onChange={(event) => updateFilters({ ...filters, use: event.target.value })}>
            <option value="">Tất cả</option><option value="speaking">Speaking</option><option value="writing">Writing</option><option value="reading">Reading</option>
          </select>
        </label>
        {(filters.level || filters.use) && <button type="button" className="gw-filter-reset" onClick={() => updateFilters({ level: '', use: '' })}>Xóa bộ lọc</button>}
      </div>
      <div className="flex items-baseline justify-between gap-4 my-6">
        <h2 className="text-lg font-bold text-white">{initial ? `Kết quả cho “${initial}”` : 'Nhập ít nhất 2 ký tự'}</h2>
        {!loading && initial && <span className="text-sm text-white/40">{visible.length} bài phù hợp</span>}
      </div>
      {loading ? <div className="skeleton h-48 rounded-2xl" /> : error ? <p className="gw-state-card">{error}</p> : visible.length ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"><FeaturedCards articles={visible} /></div>
      ) : initial ? <p className="gw-state-card">Không có bài phù hợp. Thử từ khóa rộng hơn hoặc xóa bộ lọc.</p> : null}
    </div>
  );
}

function replaceSearchUrl(query: string, filters: Filters) {
  const params = new URLSearchParams({ q: query });
  if (filters.level) params.set('level', filters.level);
  if (filters.use) params.set('use', filters.use);
  window.history.replaceState(null, '', `/grammar/search?${params.toString()}`);
}

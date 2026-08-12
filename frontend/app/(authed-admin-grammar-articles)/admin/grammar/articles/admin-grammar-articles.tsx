'use client';

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { useAdminProfile } from '@/components/admin-access-gate';
import {
  formatGrammarMetric,
  grammarStudentHref,
  normalizeGrammarArticlesPayload,
  normalizeGrammarPreview,
} from '@/lib/admin-grammar-articles-model.mjs';

type Article = {
  slug: string; title: string; category: string; sourcePath: string;
  summary: string | null; band: string | null; viewCount: number | null; saveCount: number | null;
};
type Payload = {
  total: number; availableTotal: number; categories: string[]; items: Article[]; malformedCount: number;
  analyticsStatus: { views: 'complete' | 'unavailable'; saves: 'complete' | 'unavailable' };
};
type PreviewState = { phase: 'loading' } | { phase: 'ready'; html: string } | { phase: 'error'; message: string };

function messageOf(caught: unknown) {
  return caught instanceof Error ? caught.message : String(caught || 'Không đọc được dữ liệu.');
}

function previewDocument(html: string) {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>body{margin:0;padding:24px;color:#202738;background:#fff;font:15px/1.7 system-ui,sans-serif}h1,h2,h3{line-height:1.25}img,table{max-width:100%}code{overflow-wrap:anywhere}a{color:#0f766e}</style></head><body>${html}</body></html>`;
}

export function AdminGrammarArticles() {
  const profile = useAdminProfile();
  const router = useRouter();
  const params = useSearchParams();
  const urlCategory = params?.get('category')?.trim() || '';
  const urlSearch = params?.get('search')?.trim() || '';
  const [category, setCategory] = useState(urlCategory);
  const [search, setSearch] = useState(urlSearch);
  const [snapshot, setSnapshot] = useState<{ key: string; value: Payload } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, PreviewState>>({});
  const sequence = useRef(0);
  const previewSequence = useRef<Record<string, number>>({});
  const keyOf = (nextCategory: string, nextSearch: string) => `${profile.id}:${nextCategory}:${nextSearch}`;
  const currentKey = keyOf(urlCategory, urlSearch);
  const payload = snapshot?.key === currentKey ? snapshot.value : null;

  const load = useCallback(async (nextCategory = urlCategory, nextSearch = urlSearch) => {
    const requestId = ++sequence.current;
    setLoading(true); setError(null); setExpandedSlug(null);
    try {
      const query = new URLSearchParams();
      if (nextCategory) query.set('category', nextCategory);
      if (nextSearch) query.set('search', nextSearch);
      const suffix = query.size ? `?${query}` : '';
      const normalized = normalizeGrammarArticlesPayload(await window.api.get<unknown>(`/admin/grammar/articles${suffix}`)) as Payload | null;
      if (!normalized) throw new Error('Phản hồi danh sách không đúng contract.');
      if (requestId === sequence.current) setSnapshot({ key: keyOf(nextCategory, nextSearch), value: normalized });
    } catch (caught) {
      if (requestId === sequence.current) setError(messageOf(caught));
    } finally {
      if (requestId === sequence.current) setLoading(false);
    }
  }, [profile.id, urlCategory, urlSearch]);

  useEffect(() => {
    setCategory(urlCategory); setSearch(urlSearch); void load(urlCategory, urlSearch);
    return () => { sequence.current += 1; previewSequence.current = {}; };
  }, [load, urlCategory, urlSearch]);

  const apply = (nextCategory = category, nextSearch = search.trim()) => {
    const url = new URL(window.location.href);
    if (nextCategory) url.searchParams.set('category', nextCategory); else url.searchParams.delete('category');
    if (nextSearch) url.searchParams.set('search', nextSearch); else url.searchParams.delete('search');
    const target = `${url.pathname}${url.search}`;
    const current = `${window.location.pathname}${window.location.search}`;
    if (target !== current) { setLoading(true); router.replace(target, { scroll: false }); }
    else void load(nextCategory, nextSearch);
  };

  const reset = () => { setCategory(''); setSearch(''); apply('', ''); };

  const togglePreview = async (article: Article) => {
    if (expandedSlug === article.slug) { setExpandedSlug(null); return; }
    setExpandedSlug(article.slug);
    if (previews[article.slug]) return;
    const requestId = (previewSequence.current[article.slug] || 0) + 1;
    previewSequence.current[article.slug] = requestId;
    setPreviews((current) => ({ ...current, [article.slug]: { phase: 'loading' } }));
    try {
      const normalized = normalizeGrammarPreview(
        await window.api.get<unknown>(`/admin/grammar/articles/${encodeURIComponent(article.slug)}/preview`), article.slug,
      );
      if (!normalized) throw new Error('Preview không đúng bài đang chọn.');
      if (requestId === previewSequence.current[article.slug]) setPreviews((current) => ({ ...current, [article.slug]: { phase: 'ready', html: normalized.html } }));
    } catch (caught) {
      if (requestId === previewSequence.current[article.slug]) setPreviews((current) => ({ ...current, [article.slug]: { phase: 'error', message: messageOf(caught) } }));
    }
  };

  const metricsUnavailable = payload && (payload.analyticsStatus.views === 'unavailable' || payload.analyticsStatus.saves === 'unavailable');
  return <main className="gaa-shell">
    <header className="gaa-header"><div><p className="gaa-eyebrow">Grammar · Kho nội dung</p><h1>Articles browser</h1><p className="gaa-subtitle">Tra cứu bản Markdown đã phát hành, kiểm đường dẫn nguồn và xem tín hiệu sử dụng. Màn hình này không chỉnh sửa nội dung.</p></div><div className="gaa-header-actions"><a className="btn-secondary" href="/admin/grammar">← Grammar workspace</a><button className="btn-secondary" type="button" onClick={() => void load()} disabled={loading}>{loading ? 'Đang làm mới…' : 'Làm mới'}</button></div></header>

    <section className="gaa-source" aria-labelledby="gaa-source-title"><span className="adm-status-pill is-readonly">READ-ONLY</span><div><h2 id="gaa-source-title">Repository là nguồn xuất bản canonical</h2><p>Chỉnh sửa tại <code>backend/content/&lt;category&gt;/&lt;slug&gt;.md</code>, sau đó review và commit. Không có thao tác ghi nội dung trên trang này.</p></div></section>

    <form className="gaa-filters" aria-label="Bộ lọc articles" onSubmit={(event) => { event.preventDefault(); apply(); }}>
      <label>Danh mục<select value={category} onChange={(event) => { const value = event.target.value; setCategory(value); apply(value, search.trim()); }}><option value="">Tất cả danh mục</option>{(payload?.categories || []).map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
      <label className="gaa-search">Tìm title hoặc slug<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ví dụ: modal verbs" /></label>
      <button className="btn-primary" type="submit" disabled={loading}>Áp dụng</button><button className="btn-secondary" type="button" onClick={reset} disabled={loading && !payload}>Đặt lại</button>
    </form>

    {error && <div className="gaa-banner is-error" role="alert"><div><strong>{payload ? 'Không thể làm mới — đang giữ danh sách trước đó.' : 'Không tải được articles.'}</strong><span>{error}</span></div><button className="btn-secondary" type="button" onClick={() => void load()} disabled={loading}>Thử lại</button></div>}
    {loading && !payload && <div className="gaa-state" role="status">Đang đọc kho Markdown và tín hiệu sử dụng…</div>}
    {metricsUnavailable && <div className="gaa-banner is-warning" role="status"><div><strong>Một phần số liệu sử dụng không khả dụng.</strong><span>{payload.analyticsStatus.views === 'unavailable' ? 'Views đang hiển thị —. ' : ''}{payload.analyticsStatus.saves === 'unavailable' ? 'Saves đang hiển thị —. ' : ''}Dấu — không có nghĩa là 0.</span></div></div>}
    {payload?.malformedCount ? <div className="gaa-banner is-warning" role="status"><div><strong>Một số article có metadata không hợp lệ.</strong><span>{payload.malformedCount} dòng đã bị loại khỏi bảng; kiểm tra backend logs trước khi kết luận kho đầy đủ.</span></div></div> : null}

    {payload && <section className="gaa-library" aria-labelledby="gaa-library-title"><div className="gaa-section-head"><div><p className="gaa-eyebrow">Thư viện đã phát hành</p><h2 id="gaa-library-title">{payload.total === payload.availableTotal ? `${payload.total} articles` : `${payload.total}/${payload.availableTotal} articles`}</h2></div><span>Chọn một bài để preview</span></div>
      {payload.items.length ? <div className="gaa-table-wrap" role="region" aria-label="Danh sách Grammar articles" tabIndex={0}><table className="gaa-table"><thead><tr><th scope="col">Article</th><th scope="col">Category</th><th scope="col">Band</th><th scope="col">Views</th><th scope="col">Saves</th><th scope="col">Source</th><th scope="col"><span className="gaa-sr-only">Preview</span></th></tr></thead><tbody>{payload.items.map((article) => {
        const preview = previews[article.slug]; const expanded = expandedSlug === article.slug;
        return <Fragment key={article.slug}><tr className={expanded ? 'is-expanded' : ''}><td data-label="Article"><strong>{article.title}</strong><code>{article.slug}</code>{article.summary && <small>{article.summary}</small>}</td><td data-label="Category"><span className="gaa-chip">{article.category}</span></td><td data-label="Band">{article.band || '—'}</td><td data-label="Views" className="is-number">{formatGrammarMetric(article.viewCount)}</td><td data-label="Saves" className="is-number">{formatGrammarMetric(article.saveCount)}</td><td data-label="Source"><code className="gaa-source-path">{article.sourcePath}</code></td><td data-label="Preview"><button className="gaa-preview-toggle" type="button" aria-expanded={expanded} aria-controls={`preview-${article.slug}`} onClick={() => void togglePreview(article)}>{expanded ? 'Đóng' : 'Xem trước'}</button></td></tr>{expanded && <tr className="gaa-preview-row"><td colSpan={7}><div className="gaa-preview" id={`preview-${article.slug}`}><div className="gaa-preview-head"><div><strong>{article.title}</strong><span>Bản render hiện đang phục vụ học viên</span></div><a href={grammarStudentHref(article.category, article.slug)} target="_blank" rel="noopener noreferrer">Mở student view ↗</a></div>{!preview || preview.phase === 'loading' ? <div className="gaa-preview-state" role="status">Đang tải preview…</div> : preview.phase === 'error' ? <div className="gaa-preview-state is-error" role="alert">Không tải được preview: {preview.message}</div> : <iframe title={`Preview ${article.title}`} sandbox="" srcDoc={previewDocument(preview.html)} />}</div></td></tr>}</Fragment>;
      })}</tbody></table></div> : <div className="gaa-empty"><strong>Không có article khớp bộ lọc</strong><span>Thử bỏ danh mục hoặc rút ngắn từ khóa tìm kiếm.</span><button className="btn-secondary" type="button" onClick={reset}>Xóa bộ lọc</button></div>}
    </section>}
  </main>;
}

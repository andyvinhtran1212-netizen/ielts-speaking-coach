/**
 * Grammar Article Page Shell — Server Component
 * Transcribes legacy grammar-article.html body structure verbatim,
 * SSR-filling only the runtime data that grammar.js would inject.
 */

export interface GrammarArticle {
  slug: string;
  category: string;
  title: string;
  summary?: string;
  level?: string;
  status?: 'published' | 'updating' | 'planned';
  reading_time?: number;
  word_count?: number;
  last_updated?: string;
  html?: string;
  toc?: TOCItem[];
  related_pages?: RelatedPage[];
  compare_with?: string[];
  next_articles?: ArticleLink[];
  prev_article?: ArticleLink | null;
  next_article?: ArticleLink | null;
  [key: string]: any; // Loose typing per spec
}

export interface TOCItem {
  id: string;
  name: string;
  depth?: number;
}

export interface RelatedPage {
  slug: string;
  category: string;
  title: string;
  [key: string]: any;
}

export interface ArticleLink {
  slug: string;
  category: string;
  title: string;
  [key: string]: any;
}

function escapeHtml(str: string | null | undefined): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function levelBadge(level?: string): string {
  if (!level) return '';
  const normalized = level.toLowerCase();
  const colorMap: Record<string, string> = {
    beginner: 'bg-emerald-500/15 text-emerald-400',
    intermediate: 'bg-yellow-500/15 text-yellow-400',
    advanced: 'bg-red-500/15 text-red-400',
  };
  const cls = colorMap[normalized] || 'bg-white/10 text-white/60';
  const display = level.charAt(0).toUpperCase() + level.slice(1);
  return `<span class="inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${cls}">${display}</span>`;
}

function updatingBadge(): string {
  return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-400"><span class="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block"></span>Đang cập nhật</span>`;
}

function renderBreadcrumb(category: string, title: string): string {
  const categoryUrl = `/grammar.html?category=${encodeURIComponent(category)}`;
  const categoryDisplay = category.replace(/-/g, ' ');
  return (
    `<a href="/grammar.html" class="hover:text-teal-light transition-colors">Grammar Wiki</a>` +
    `<span class="mx-2 text-white/20">›</span>` +
    `<a href="${categoryUrl}" class="hover:text-teal-light transition-colors capitalize">${escapeHtml(categoryDisplay)}</a>` +
    `<span class="mx-2 text-white/20">›</span>` +
    `<span class="text-white/80">${escapeHtml(title)}</span>`
  );
}

function renderTOC(items: TOCItem[]): string {
  if (!items || items.length === 0) return '';
  const listItems = items
    .map((item) => {
      const indent = item.depth ? `pl-${item.depth * 3}` : '';
      return `<li class="${indent}"><a href="#${item.id}" class="toc-link block text-sm text-white/50 hover:text-teal-light py-0.5 transition-colors leading-snug">${escapeHtml(item.name)}</a></li>`;
    })
    .join('');
  return `<nav><p class="text-xs font-semibold uppercase tracking-widest text-white/30 mb-3">Nội dung</p><ul class="space-y-1">${listItems}</ul></nav>`;
}

function renderRelatedPages(pages: RelatedPage[]): string {
  if (!pages || pages.length === 0) return '';
  return pages
    .map((p) => {
      const url = `/grammar/${encodeURIComponent(p.category)}/${encodeURIComponent(p.slug)}`;
      return `<a href="${url}" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.04] text-sm text-white/70 hover:border-teal/40 hover:text-teal-light transition-all">${escapeHtml(p.title)}</a>`;
    })
    .join('');
}

function renderPrevNext(prev: ArticleLink | null | undefined, next: ArticleLink | null | undefined): string {
  let html = '<div class="flex gap-3">';
  if (prev) {
    const url = `/grammar/${encodeURIComponent(prev.category)}/${encodeURIComponent(prev.slug)}`;
    html += `<a href="${url}" class="flex-1 p-4 rounded-xl border border-white/10 bg-white/[0.03] hover:border-teal/40 hover:bg-teal/[0.07] transition-all group"><p class="text-xs text-white/30 mb-1">← Bài trước</p><p class="text-sm font-medium text-white/80 group-hover:text-white">${escapeHtml(prev.title)}</p></a>`;
  }
  if (next) {
    const url = `/grammar/${encodeURIComponent(next.category)}/${encodeURIComponent(next.slug)}`;
    html += `<a href="${url}" class="flex-1 p-4 rounded-xl border border-white/10 bg-white/[0.03] hover:border-teal/40 hover:bg-teal/[0.07] transition-all group text-right"><p class="text-xs text-white/30 mb-1">Bài tiếp →</p><p class="text-sm font-medium text-white/80 group-hover:text-white">${escapeHtml(next.title)}</p></a>`;
  }
  html += '</div>';
  return html;
}

function renderCompareLinks(compareWith: string[], slug: string): string {
  if (!compareWith || compareWith.length === 0) return '';
  return compareWith
    .map((otherSlug) => {
      const compareSlug = `${slug}-vs-${otherSlug}`;
      const url = `/pages/grammar-compare.html?slug=${encodeURIComponent(compareSlug)}`;
      const otherDisplay = otherSlug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      return `<a href="${url}" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-teal/25 bg-teal/[0.06] text-sm text-teal-light hover:border-teal/50 hover:bg-teal/[0.12] transition-all">So sánh với ${escapeHtml(otherDisplay)} →</a>`;
    })
    .join('');
}

function renderNextArticles(articles: ArticleLink[]): string {
  if (!articles || articles.length === 0) return '';
  const items = articles.slice(0, 3);
  return items
    .map((a) => {
      const url = `/grammar/${encodeURIComponent(a.category)}/${encodeURIComponent(a.slug)}`;
      const categoryDisplay = (a.category || '').replace(/-/g, ' ');
      return `<a href="${url}" class="flex items-center gap-4 p-4 rounded-xl border border-white/8 bg-white/[0.03] hover:border-teal/40 hover:bg-teal/[0.07] transition-all group"><div class="flex-shrink-0 w-9 h-9 rounded-xl bg-teal/12 border border-teal/20 flex items-center justify-center"><svg class="w-4 h-4 text-teal-light" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"/></svg></div><div class="flex-1 min-w-0"><p class="text-sm font-semibold text-white/85 group-hover:text-white truncate">${escapeHtml(a.title)}</p><p class="text-xs text-white/35 capitalize">${escapeHtml(categoryDisplay)}</p></div><span class="text-xs text-teal-light opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">Học ngay →</span></a>`;
    })
    .join('');
}

/**
 * ArticleShell — Server Component
 * Renders grammar article page with SSR data filling runtime elements.
 * Structure transcribed verbatim from legacy grammar-article.html.
 */
export function ArticleShell({ article }: { article: GrammarArticle }) {
  const isUpdating = article.status === 'updating';

  // Build article meta spans (reading_time, word_count, last_updated) — exact format from grammar.js lines 688–692
  let metaHtml = `<span>${article.reading_time || 1} phút đọc</span>`;
  if (article.word_count) {
    metaHtml += `<span>· ${article.word_count} từ</span>`;
  }
  if (article.last_updated) {
    metaHtml += `<span>· Cập nhật: ${article.last_updated}</span>`;
  }

  return (
    <body className="av-page min-h-screen font-sans antialiased">
      {/* Reading progress bar (Sprint 6.17.2: grammar.js line 214–220) */}
      <div id="reading-progress" />

      {/* Canonical chrome (Sprint 7.13) */}
      {/* @ts-ignore */}
      <aver-chrome active="grammar" />

      {/* Grammar Wiki secondary nav — breadcrumb SSR'd (grammar.js line 673: renderBreadcrumb) */}
      <nav
        className="gw-subnav sticky top-0 z-20 border-b border-white/5"
        aria-label="Grammar Wiki"
        style={{
          background: 'var(--av-surface-sunken)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <div className="av-w-page h-12 flex items-center">
          <div
            id="breadcrumb"
            className="flex items-center text-sm text-white/40 flex-wrap gap-0"
            dangerouslySetInnerHTML={{ __html: renderBreadcrumb(article.category, article.title) }}
          />
        </div>
      </nav>

      {/* Article container (no hidden class for SSR — content is ready) */}
      <div id="article-container" className="av-w-page py-8 ds-fadein">
        <div className="flex gap-8 items-start justify-center">
          {/* Main article column (max-width: var(--av-width-read)) */}
          <article className="min-w-0 w-full" style={{ maxWidth: 'var(--av-width-read)' }}>
            {/* Header */}
            <div className="mb-8">
              <p className="eyebrow">Grammar Wiki</p>
              <div className="flex items-center gap-2 mb-3">
                {/* Level badge (grammar.js line 681–684) */}
                <span
                  id="article-level"
                  dangerouslySetInnerHTML={{
                    __html: isUpdating ? updatingBadge() : levelBadge(article.level),
                  }}
                />
              </div>
              {/* Article title (grammar.js line 677: titleEl.textContent = article.title) */}
              <h1 id="article-title" className="text-3xl font-extrabold text-white mb-3">
                {article.title}
              </h1>
              {/* Article meta spans: reading_time / word_count / last_updated (grammar.js line 688–692) */}
              <div
                id="article-meta"
                className="flex items-center gap-3 text-sm text-white/35"
                dangerouslySetInnerHTML={{ __html: metaHtml }}
              />
            </div>

            {/* Article body (grammar.js line 709–725: bodyEl.innerHTML = article.html or updating message) */}
            <div
              id="article-body"
              className="article-body mb-10"
              dangerouslySetInnerHTML={{
                __html: isUpdating
                  ? `<div class="my-8 p-6 rounded-2xl border border-amber-500/20 bg-amber-500/[0.05] text-center"><div class="w-12 h-12 rounded-full bg-amber-500/15 flex items-center justify-center mx-auto mb-4"><svg class="w-6 h-6 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg></div><h3 class="text-base font-semibold text-white/80 mb-2">Bài viết đang được hoàn thiện</h3><p class="text-sm text-white/50 max-w-md mx-auto leading-relaxed">Nội dung chi tiết cho chủ đề này đang được biên soạn. Bạn có thể xem các bài viết liên quan bên dưới trong thời gian chờ đợi.</p></div>`
                  : article.html || '',
              }}
            />

            {/* Exercise CTA (grammar.js line 770: _initExerciseCTA, shown by article-behavior.tsx) */}
            <section id="exercise-cta" className="mb-10 hidden">
              <a
                id="exercise-cta-link"
                href="#"
                className="group flex items-center gap-4 rounded-2xl border border-teal/25 bg-teal/[0.06] px-5 py-4 transition hover:border-teal/50 hover:bg-teal/[0.1]"
              >
                <div className="w-11 h-11 shrink-0 rounded-xl bg-teal/15 flex items-center justify-center text-xl">
                  ✍️
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-base font-semibold text-white">Kiểm tra nhanh</p>
                  <p id="exercise-cta-sub" className="text-sm text-white/45">
                    Làm bài tập để kiểm tra kiến thức bài này.
                  </p>
                </div>
                <span className="text-teal-light text-sm font-medium whitespace-nowrap group-hover:translate-x-0.5 transition-transform">
                  Bắt đầu →
                </span>
              </a>
            </section>

            {/* Compare section (grammar.js line 735–740: renderCompareLinks, shown by article-behavior.tsx) */}
            <section id="compare-section" className="mb-8 hidden">
              <p className="section-label">So sánh với</p>
              <div
                id="compare-links"
                className="flex flex-wrap gap-2"
                dangerouslySetInnerHTML={{ __html: renderCompareLinks(article.compare_with || [], article.slug) }}
              />
            </section>

            {/* Next articles section (grammar.js line 729: renderNextArticles, shown by article-behavior.tsx) */}
            <section id="next-articles-section" className="mb-8 hidden">
              <p className="section-label">Học tiếp theo</p>
              <div
                id="next-articles-list"
                className="flex flex-col gap-3"
                dangerouslySetInnerHTML={{ __html: renderNextArticles(article.next_articles || []) }}
              />
            </section>

            {/* Related pages (grammar.js line 732: renderRelatedPages, always shown) */}
            <section id="related-section" className="mb-8">
              <p className="section-label">Bài liên quan</p>
              <div
                id="related-pages"
                className="flex flex-wrap gap-2"
                dangerouslySetInnerHTML={{ __html: renderRelatedPages(article.related_pages || []) }}
              />
            </section>

            {/* Prev/Next nav (grammar.js line 743: renderPrevNext, always shown) */}
            <div
              id="prev-next"
              className="border-t border-white/6 pt-6"
              dangerouslySetInnerHTML={{ __html: renderPrevNext(article.prev_article, article.next_article) }}
            />
          </article>

          {/* TOC sidebar (grammar.js line 702: renderTOC, hidden for updating articles) */}
          {!isUpdating && (
            <aside className="hidden lg:block w-56 flex-shrink-0">
              <div className="toc-sidebar">
                <div
                  id="toc-container"
                  dangerouslySetInnerHTML={{ __html: renderTOC(article.toc || []) }}
                />
              </div>
            </aside>
          )}
        </div>
      </div>

      {/* Guest CTA bar (grammar.js line 767: _initGuestCTA, shown by article-behavior.tsx) */}
      <div
        id="guest-cta-bar"
        className="hidden fixed bottom-0 left-0 right-0 z-40 border-t border-teal/20"
        style={{ background: 'var(--av-surface-page)', backdropFilter: 'blur(14px)' }}
      >
        <div className="av-w-read py-3 flex items-center justify-between gap-4">
          <p className="text-sm text-white/70 leading-snug">
            Luyện IELTS Speaking với AI — nhận feedback ngay lập tức
          </p>
          <a
            href="/login.html"
            className="flex-shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-teal text-white hover:bg-teal-light transition-colors whitespace-nowrap"
          >
            Dùng thử miễn phí →
          </a>
        </div>
      </div>

      {/* Guest modal (grammar.js line 767: _initGuestCTA, shown by article-behavior.tsx) */}
      <div
        id="guest-modal-overlay"
        className="hidden fixed inset-0 z-50 flex items-center justify-center px-4"
        style={{ background: 'var(--av-surface-overlay)', backdropFilter: 'blur(4px)' }}
      >
        <div
          className="w-full max-w-sm rounded-2xl border border-white/10 p-6 text-center"
          style={{ background: 'var(--av-surface-sunken)' }}
        >
          <div className="w-12 h-12 rounded-full bg-teal/15 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-teal-light" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.347.347A3.5 3.5 0 0112 15.5a3.5 3.5 0 01-2.071-.653l-.347-.347z"
              />
            </svg>
          </div>
          <h3 id="guest-modal-title" className="text-base font-semibold text-white mb-2">
            Bạn đang đọc bài ngữ pháp
          </h3>
          <p className="text-sm text-white/55 mb-5 leading-relaxed">
            Muốn biết mình có dùng đúng trong IELTS Speaking không? Thử luyện với AI để nhận feedback ngay.
          </p>
          <div className="flex flex-col gap-2">
            <a
              href="/login.html"
              className="block w-full py-2.5 rounded-xl text-sm font-semibold bg-teal text-white hover:bg-teal-light transition-colors"
            >
              Luyện Speaking ngay
            </a>
            <button
              id="guest-modal-dismiss"
              className="block w-full py-2.5 rounded-xl text-sm text-white/40 hover:text-white/70 transition-colors"
            >
              Tiếp tục đọc
            </button>
          </div>
        </div>
      </div>
    </body>
  );
}

// Các thẻ dùng chung của khu Grammar — chép TRUNG THỰC từ `public/js/grammar.js`
// (renderGroups / renderFeaturedCards / renderCategoryCards + badge helpers).
//
// Vì sao chép nguyên class thay vì "viết lại cho đẹp": bài học pilot 2 (#741) —
// dựng lại từ đầu làm gãy cascade của `grammar-wiki.css` (chữ trắng trên nền
// trắng), chỉ phát hiện được nhờ so ảnh chụp. CSS legacy bám vào đúng những
// class/id này, nên chúng là HỢP ĐỒNG, không phải chi tiết trang trí.
//
// Đây cũng là mảnh dùng chung đầu tiên của Phase 3: 4 trang Grammar còn lại
// (search, roadmap, compare, exercises) dùng lại chính các thẻ này.
import type { ReactNode } from 'react';

export type Article = {
  slug: string;
  title: string;
  category: string;
  level?: string;
  status?: string;
  summary?: string;
  reading_time?: number;
};

export type Category = {
  slug: string;
  title: string;
  article_count: number;
  articles?: Article[];
};

export type Group = {
  title: string;
  description?: string;
  color?: string;
  complete_count: number;
  article_count: number;
  articles?: Article[];
};

const GROUP_ARTICLE_PREVIEW = 5;

/** URL sạch của bài viết — nay là route Next canonical (pilot 2, 28/07). */
export const articleUrl = (category: string, slug: string) =>
  `/grammar/${encodeURIComponent(category)}/${encodeURIComponent(slug)}`;

// Bảng màu nhóm: cố ý dùng inline style, y như legacy — Tailwind JIT không
// sinh được class từ dữ liệu runtime.
const GROUP_PALETTE: Record<string, { hex: string; bg: string; border: string }> = {
  teal: { hex: '#14b8a6', bg: 'rgba(20,184,166,0.07)', border: 'rgba(20,184,166,0.22)' },
  blue: { hex: '#60a5fa', bg: 'rgba(96,165,250,0.07)', border: 'rgba(96,165,250,0.22)' },
  violet: { hex: '#a78bfa', bg: 'rgba(167,139,250,0.07)', border: 'rgba(167,139,250,0.22)' },
  amber: { hex: '#fbbf24', bg: 'rgba(251,191,36,0.07)', border: 'rgba(251,191,36,0.22)' },
  emerald: { hex: '#34d399', bg: 'rgba(52,211,153,0.07)', border: 'rgba(52,211,153,0.22)' },
  rose: { hex: '#fb7185', bg: 'rgba(251,113,133,0.07)', border: 'rgba(251,113,133,0.22)' },
  sky: { hex: '#38bdf8', bg: 'rgba(56,189,248,0.07)', border: 'rgba(56,189,248,0.22)' },
  orange: { hex: '#fb923c', bg: 'rgba(251,146,60,0.07)', border: 'rgba(251,146,60,0.22)' },
  indigo: { hex: '#818cf8', bg: 'rgba(129,140,248,0.07)', border: 'rgba(129,140,248,0.22)' },
};

const LEVEL_COLORS: Record<string, string> = {
  beginner: 'bg-emerald-500/15 text-emerald-400',
  intermediate: 'bg-yellow-500/15 text-yellow-400',
  advanced: 'bg-red-500/15 text-red-400',
};

export function LevelBadge({ level }: { level?: string }) {
  if (!level) return null;
  const cls = LEVEL_COLORS[level.toLowerCase()] || 'bg-white/10 text-white/60';
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${cls}`}>
      {level.charAt(0).toUpperCase() + level.slice(1)}
    </span>
  );
}

export function UpdatingBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-400">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
      Đang cập nhật
    </span>
  );
}

function prettifySlug(slug: string) {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export function CategoryBadge({ category }: { category: string }) {
  return (
    <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-white/8 text-white/50">
      {prettifySlug(category)}
    </span>
  );
}

const BookIcon = ({ className, style }: { className: string; style?: React.CSSProperties }) => (
  <svg className={className} style={style} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
    />
  </svg>
);

function Empty({ children, span }: { children: ReactNode; span?: boolean }) {
  return <p className={`text-white/40 text-sm${span ? ' col-span-2' : ''}`}>{children}</p>;
}

/** Thẻ bài nổi bật — cũng dùng cho danh sách bài của một thư mục. */
export function FeaturedCards({ articles }: { articles?: Article[] }) {
  const list = (articles || []).filter((a) => a && a.slug && a.title && a.category);
  if (!list.length) return <Empty>Chưa có bài nào.</Empty>;
  return (
    <>
      {list.map((a) => (
        <a
          key={`${a.category}/${a.slug}`}
          href={articleUrl(a.category, a.slug)}
          className="block p-4 rounded-xl border border-white/8 bg-white/[0.03] hover:border-teal/40 hover:bg-teal/[0.07] transition-all duration-200"
        >
          <div className="flex items-start justify-between gap-2 mb-1">
            <h4 className="font-semibold text-white text-sm leading-snug">{a.title}</h4>
            {a.status === 'updating' ? <UpdatingBadge /> : <LevelBadge level={a.level} />}
          </div>
          <p className="text-xs text-white/50 line-clamp-2 mb-2">{a.summary || ''}</p>
          <div className="flex items-center gap-3 text-xs text-white/30">
            <span>{a.category}</span>
            <span>{a.reading_time || 1} phút</span>
          </div>
        </a>
      ))}
    </>
  );
}

/** Thẻ kết quả tìm kiếm — cùng hình dạng với `renderSearchCards` của rollback. */
export function SearchResultCards({ articles, query }: { articles?: Article[]; query: string }) {
  const list = (articles || []).filter((a) => a && a.slug && a.title && a.category);
  if (!list.length) {
    return (
      <div className="col-span-3 py-12 text-center">
        <p className="text-white/40 mb-2">
          Không tìm thấy kết quả cho &quot;<strong className="text-white/80">{query}</strong>&quot;
        </p>
        <p className="text-white/30 text-sm">
          Thử từ khóa khác:{' '}
          <a href="/grammar/search?q=present+perfect" className="text-teal-light hover:underline">present perfect</a>,{' '}
          <a href="/grammar/search?q=conditionals" className="text-teal-light hover:underline">conditionals</a>,{' '}
          <a href="/grammar/search?q=passive" className="text-teal-light hover:underline">passive voice</a>
        </p>
      </div>
    );
  }

  return (
    <>
      {list.map((article) => (
        <a
          key={`${article.category}/${article.slug}`}
          href={articleUrl(article.category, article.slug)}
          className="block p-4 rounded-xl border border-white/8 bg-white/[0.03] hover:border-teal/40 hover:bg-teal/[0.07] transition-all duration-200"
        >
          <div className="flex items-start justify-between gap-2 mb-1">
            <h4 className="font-semibold text-white text-sm leading-snug">{article.title}</h4>
            {article.status === 'updating' ? <UpdatingBadge /> : <LevelBadge level={article.level} />}
          </div>
          <p className="text-xs text-white/50 line-clamp-2 mb-3">{article.summary || ''}</p>
          <div className="flex items-center gap-2">
            <CategoryBadge category={article.category} />
            <span className="text-xs text-white/25">{article.reading_time || 1} phút</span>
          </div>
        </a>
      ))}
    </>
  );
}

/**
 * Thẻ thư mục. Legacy dùng `onclick`/`onkeydown` inline để cả thẻ bấm được;
 * ở đây dùng `<a>` bọc tiêu đề + danh sách bài là link riêng — cùng đích đến,
 * nhưng bàn phím và chuột phải hoạt động đúng chuẩn thay vì giả lập bằng JS.
 */
export function CategoryCards({ categories }: { categories?: Category[] }) {
  const list = (categories || []).filter((c) => c && c.slug && c.title);
  if (!list.length) return <Empty>Chưa có chủ đề nào.</Empty>;
  return (
    <>
      {list.map((cat) => (
        <div key={cat.slug} className="cat-card group block p-5 rounded-2xl border border-white/8 bg-white/[0.03]">
          <a href={`/grammar?category=${encodeURIComponent(cat.slug)}`} className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-xl bg-teal/15 flex items-center justify-center flex-shrink-0">
              <BookIcon className="w-5 h-5 text-teal-light" />
            </div>
            <div>
              <h3 className="font-semibold text-white group-hover:text-teal-light transition-colors">{cat.title}</h3>
              <p className="text-xs text-white/40">{cat.article_count} bài</p>
            </div>
          </a>
          {cat.articles?.length ? (
            <ul className="space-y-1">
              {cat.articles
                .filter((a) => a && a.slug && a.title && a.category)
                .slice(0, 3)
                .map((a) => (
                  <li key={a.slug} className="flex items-center text-sm text-white/55 hover:text-white/90 truncate">
                    {a.status === 'updating' ? (
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400/70 inline-block mr-1 flex-shrink-0" />
                    ) : null}
                    <a href={articleUrl(a.category, a.slug)}>{a.title}</a>
                  </li>
                ))}
            </ul>
          ) : null}
        </div>
      ))}
    </>
  );
}

function GroupArticleRow({ article, color }: { article: Article; color: string }) {
  if (article.status === 'planned') {
    return (
      <div className="group-article-row flex items-center gap-2 px-2 py-1">
        <span className="gw-status-dot gw-status-dot--planned w-1.5 h-1.5 rounded-full flex-shrink-0" />
        <span className="text-sm text-white/28 flex-1 truncate">{article.title}</span>
        <span className="gw-status-badge gw-status-badge--planned text-xs px-1.5 py-0.5 rounded-full flex-shrink-0">
          Sắp ra mắt
        </span>
      </div>
    );
  }
  if (article.status === 'updating') {
    return (
      <div className="group-article-row flex items-center gap-2 px-2 py-1">
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#fbbf24' }} />
        <a
          href={articleUrl(article.category, article.slug)}
          className="text-sm text-white/55 hover:text-white/85 transition-colors flex-1 truncate"
        >
          {article.title}
        </a>
        <span
          className="text-xs px-1.5 py-0.5 rounded-full flex-shrink-0"
          style={{ background: 'rgba(251,191,36,0.15)', color: '#fbbf24' }}
        >
          Đang cập nhật
        </span>
      </div>
    );
  }
  return (
    <div className="group-article-row flex items-center gap-2 px-2 py-1">
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
      <a
        href={articleUrl(article.category, article.slug)}
        className="text-sm text-white/65 hover:text-white/90 transition-colors flex-1 truncate"
      >
        {article.title}
      </a>
    </div>
  );
}

/** Thẻ nhóm chủ đề — điều hướng chính của trang chủ Grammar. */
export function GroupCards({ groups }: { groups?: Group[] }) {
  if (!groups?.length) return <Empty span>Chưa có dữ liệu nhóm chủ đề.</Empty>;
  return (
    <>
      {groups.map((g) => {
        const pal = GROUP_PALETTE[g.color || 'teal'] || GROUP_PALETTE.teal;
        const pct = g.article_count > 0 ? Math.round((g.complete_count / g.article_count) * 100) : 0;
        const articles = g.articles || [];
        const preview = articles.slice(0, GROUP_ARTICLE_PREVIEW);
        const remaining = articles.slice(GROUP_ARTICLE_PREVIEW);
        return (
          <div key={g.title} className="group-card rounded-2xl p-5 border" style={{ background: pal.bg, borderColor: pal.border }}>
            <div className="flex items-start gap-3 mb-4">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: pal.bg, border: `1px solid ${pal.border}` }}
              >
                <BookIcon className="w-4 h-4" style={{ color: pal.hex }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <h3 className="font-semibold text-white text-base leading-tight">{g.title}</h3>
                  <span
                    className="text-xs flex-shrink-0 px-2 py-0.5 rounded-full font-medium"
                    style={{ background: pal.bg, color: pal.hex, border: `1px solid ${pal.border}` }}
                  >
                    {g.complete_count}/{g.article_count}
                  </span>
                </div>
                <p className="text-xs text-white/40 leading-relaxed">{g.description || ''}</p>
              </div>
            </div>

            {/* Nền thanh tiến độ đi qua class hook để chủ đề sáng lấy đúng token;
                màu phần đã hoàn thành vẫn inline vì nó theo dữ liệu. */}
            <div className="gw-progress-track h-0.5 rounded-full mb-4 overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: pal.hex }} />
            </div>

            <div className="space-y-0.5">
              {preview.map((article) => (
                <GroupArticleRow key={article.slug || article.title} article={article} color={pal.hex} />
              ))}
              {remaining.length > 0 ? (
                <details className="gw-group-more">
                  <summary>Xem thêm {remaining.length} bài</summary>
                  <div className="space-y-0.5 gw-group-more__list">
                    {remaining.map((article) => (
                      <GroupArticleRow key={article.slug || article.title} article={article} color={pal.hex} />
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          </div>
        );
      })}
    </>
  );
}

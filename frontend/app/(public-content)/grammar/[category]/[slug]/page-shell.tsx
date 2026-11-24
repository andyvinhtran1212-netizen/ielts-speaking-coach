/**
 * Grammar article page — Server Component (LIBRARY-0061 T014 PR (a), FR-040,
 * FR-044; tờ GrammarWikiBai, khuôn bài đọc NguPhap / T007).
 *
 * The page sits in the legacy `(public-content)` layout until T014 PR (c), so
 * the "Bản in" tokens and base rules are imported here and scoped by the
 * `.av2-root` wrapper (base.css only styles inside it). The article HTML from
 * the backend keeps `class="article-body"` and `grammar-wiki.css` (still in the
 * layout) until PR (c), so Grammar Lab blocks and `<figure class="gw-fig">`
 * render exactly as today.
 *
 * Everything the reader needs is in the server HTML (FR-001); the browser only
 * adds the save control, view tracking, the quick-check link and Grammar Lab
 * checks (`article-behavior.tsx`).
 */
import '@/styles/av2/tokens.css';
import '@/styles/av2/base.css';

import type { GrammarArticleWire } from '@/lib/grammar-api';
import { grammarArticleHref, grammarReturnHref } from '@/lib/grammar-navigation-context.mjs';
import { CourseLinkLine } from '@/components/library/course-link-line';
import { ReadingBlock, ReadingLayout, type ReadingTocItem } from '@/components/library/reading-layout';
import { BackLink, Breadcrumb, Notice } from '@/components/ui';
import { av2FontClass } from '@/styles/av2/fonts';

import styles from './article.module.css';
import { SaveControl } from './save-control';

export type GrammarArticle = GrammarArticleWire;
type TOCItem = GrammarArticle['toc'][number];
type ArticleLink = GrammarArticle['next_articles'][number];

/** Words per minute used for "đọc khoảng N phút" (Vietnamese + English mixed text). */
const WORDS_PER_MINUTE = 200;

const LEVEL_LABELS: Record<string, string> = {
  beginner: 'cơ bản',
  'beginner-intermediate': 'cơ bản đến trung cấp',
  intermediate: 'trung cấp',
  advanced: 'nâng cao',
};

/** "Passive Voice — Câu bị động" → main + second line; a title without " — " stays one line. */
export function splitTitle(title: string): { main: string; sub: string | null } {
  const at = title.indexOf(' — ');
  if (at <= 0) return { main: title, sub: null };
  const sub = title.slice(at + 3).trim();
  return { main: title.slice(0, at).trim(), sub: sub || null };
}

/** Minutes from `word_count`; null (line hidden) when the count is missing. */
export function readingMinutes(wordCount: number | null | undefined): number | null {
  if (!wordCount || wordCount <= 0) return null;
  return Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE));
}

/** "2026-09-30" → "30/09/2026"; any other shape is shown as given. */
export function formatUpdated(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : value;
}

/** Top-level sections of the article, numbered from 1 (tờ GrammarWikiBai: mục lục theo H2). */
export function articleToc(items: readonly TOCItem[] | null | undefined): ReadingTocItem[] {
  const list = (items || []).filter((item) => item.id && item.name);
  if (list.length === 0) return [];
  const top = Math.min(...list.map((item) => item.depth || 0));
  return list
    .filter((item) => (item.depth || 0) === top)
    .map((item, i) => ({ id: item.id, label: item.name, n: String(i + 1) }));
}

function categoryLabel(category: string): string {
  const words = (category || '').replace(/-/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
}

function compareLabel(otherSlug: string): string {
  return otherSlug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ArticleShell({ article, source = '' }: { article: GrammarArticle; source?: string }) {
  const returnHref = grammarReturnHref({ from: source });
  const isUpdating = article.status === 'updating';
  const toc = isUpdating ? [] : articleToc(article.toc);
  const { main, sub } = splitTitle(article.title);
  const minutes = readingMinutes(article.word_count);
  const updated = formatUpdated(article.last_updated);
  const level = article.level ? LEVEL_LABELS[article.level.toLowerCase()] || article.level : null;
  const category = categoryLabel(article.category);
  const categoryHref = `/grammar?category=${encodeURIComponent(article.category)}`;

  const meta = [
    isUpdating ? 'Đang cập nhật' : null,
    level ? `Trình độ ${level}` : null,
    minutes ? `đọc khoảng ${minutes} phút` : null,
    updated ? `cập nhật ${updated}` : null,
  ].filter(Boolean) as string[];
  if (meta.length) meta[0] = meta[0].charAt(0).toUpperCase() + meta[0].slice(1);

  const nextArticles = (article.next_articles || []).slice(0, 3);
  const related = article.related_pages || [];
  const compareWith = article.compare_with || [];
  const prev = article.prev_article;
  const next = article.next_article;

  const header = (
    <>
      <p className={styles.eyebrow}>Grammar Wiki · {category}</p>
      <h1 id="article-title" className={styles.title}>
        {main}
        {sub ? <span className={styles.subtitle}>{sub}</span> : null}
      </h1>
      <p id="article-meta" className={styles.meta}>{meta.join(' · ')}</p>
      {/* "Lưu bài" for a signed-in reader, the sign-in line for a guest (decided in the browser). */}
      <div id="article-save" className={styles.save}>
        <SaveControl slug={article.slug} />
      </div>
    </>
  );

  return (
    <>
      {/* The legacy layout's top bar stays until T014 PR (c). */}
      {/* @ts-ignore custom element registered by the public-content layout */}
      <aver-chrome active="grammar" />

      <div className={`av2-root ${av2FontClass} ${styles.page}`} data-grammar-article="">
        <div className={styles.inner}>
          <div id="breadcrumb">
            <Breadcrumb
              items={[
                { label: 'Thư viện', href: '/library' },
                { label: 'Grammar Wiki', href: '/grammar' },
                { label: category, href: categoryHref },
                { label: main },
              ]}
            />
          </div>
          {returnHref ? (
            <p className={styles.back}>
              <BackLink parentLabel="Học & luyện" href={returnHref} />
            </p>
          ) : null}

          <main id="article-container" tabIndex={-1} className={styles.main}>
            <ReadingLayout
              toc={toc}
              header={header}
              tocFooter={category ? <>Thuộc nhóm <a href={categoryHref}>{category}</a></> : undefined}
            >
              <ReadingBlock>
                {isUpdating ? (
                  <Notice kind="info" title="Bài viết đang được hoàn thiện." live="none">
                    Nội dung chi tiết cho chủ đề này đang được biên soạn. Bạn có thể đọc các bài liên quan bên dưới trong lúc chờ.
                  </Notice>
                ) : (
                  // Backend-rendered article: anchors, Grammar Lab blocks and
                  // `<figure class="gw-fig">` are kept as they arrive (FR-044).
                  <div id="article-body" className="article-body" dangerouslySetInnerHTML={{ __html: article.html || '' }} />
                )}
              </ReadingBlock>

              {/* Shown by article-behavior.tsx only when a published quiz bank exists. */}
              <ReadingBlock>
                <p id="exercise-cta" className={styles.practice} hidden>
                  Luyện thêm:{' '}
                  <a id="exercise-cta-link" href="#">Kiểm tra nhanh về {main}</a>
                  <span id="exercise-cta-sub" className={styles.muted} />
                </p>
              </ReadingBlock>

              {compareWith.length ? (
                <ReadingBlock>
                  <section id="compare-section" aria-labelledby="compare-h" className={styles.section}>
                    <h2 id="compare-h" className={styles.sectionTitle}>So sánh với</h2>
                    <ul id="compare-links" className={styles.linkList}>
                      {compareWith.map((other) => {
                        const compareSlug = `${article.slug}-vs-${other}`;
                        return (
                          <li key={other}>
                            <a href={`/grammar/compare?slug=${encodeURIComponent(compareSlug)}`}>{compareLabel(other)}</a>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                </ReadingBlock>
              ) : null}

              {nextArticles.length ? (
                <ReadingBlock>
                  <section id="next-articles-section" aria-labelledby="next-articles-h" className={styles.section}>
                    <h2 id="next-articles-h" className={styles.sectionTitle}>Học tiếp theo</h2>
                    <ul id="next-articles-list" className={styles.linkList}>
                      {nextArticles.map((a: ArticleLink) => (
                        <li key={`${a.category}/${a.slug}`}>
                          <a href={grammarArticleHref(a.category, a.slug, source)}>{a.title}</a>
                          <span className={styles.muted}> · {categoryLabel(a.category)}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                </ReadingBlock>
              ) : null}

              {related.length ? (
                <ReadingBlock>
                  <section id="related-section" aria-labelledby="related-h" className={styles.section}>
                    <h2 id="related-h" className={styles.sectionTitle}>Bài liên quan</h2>
                    <ul id="related-pages" className={styles.linkList}>
                      {related.map((p) => (
                        <li key={`${p.category}/${p.slug}`}>
                          <a href={grammarArticleHref(p.category, p.slug, source)}>{p.title}</a>
                        </li>
                      ))}
                    </ul>
                  </section>
                </ReadingBlock>
              ) : null}

              <ReadingBlock>
                <CourseLinkLine href="/" linkLabel="Xem các khoá học">
                  Đọc Grammar Wiki luôn miễn phí. Muốn có bài tập theo thứ tự và bài viết được chấm, cần một khoá học:
                </CourseLinkLine>
              </ReadingBlock>

              {prev || next ? (
                <ReadingBlock>
                  <nav id="prev-next" aria-label="Bài trước và bài sau" className={styles.prevNext}>
                    {prev ? (
                      <a href={grammarArticleHref(prev.category, prev.slug, source)} className={styles.prev}>
                        <span className={styles.muted}>‹ Bài trước</span>
                        <span>{prev.title}</span>
                      </a>
                    ) : <span />}
                    {next ? (
                      <a href={grammarArticleHref(next.category, next.slug, source)} className={styles.next}>
                        <span className={styles.muted}>Bài sau ›</span>
                        <span>{next.title}</span>
                      </a>
                    ) : null}
                  </nav>
                </ReadingBlock>
              ) : null}
            </ReadingLayout>
          </main>
        </div>
      </div>
    </>
  );
}

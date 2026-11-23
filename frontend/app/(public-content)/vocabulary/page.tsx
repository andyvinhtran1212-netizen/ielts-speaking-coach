// `/vocabulary`: the Vocabulary shelf of the public Library (LIBRARY-0061 T015,
// tờ TuVung). The URL stays as it was (FR-050): `?cat=&slug=` opens an entry,
// `?cat=` filters the list by topic, `?q=` is the look-up results page, and a
// historical slug-only link still resolves when the slug is unique.
//
// Each entry declares its own canonical URL, `/vocabulary?cat=<cat>&slug=<slug>`
// (FR-050); every other view keeps `/vocabulary`. Entries, lists and results
// are rendered on the server, so they are in the HTML without JavaScript.
import '@/styles/av2/tokens.css';
import '@/styles/av2/base.css';

import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { CourseLinkLine } from '@/components/library/course-link-line';
import { av2FontClass } from '@/styles/av2/fonts';
import { getAllVocabularyWords, getVocabularyArticle, getVocabularyCategories, getVocabularyDirectory } from '@/lib/vocabulary-api';
import { normalizeVocabularyArticle, normalizeVocabularyCategories, normalizeVocabularyDirectory, resolveVocabularySelection } from '@/lib/vocabulary-model.mjs';
import { entryHref, matchWords, nearWords } from '@/lib/vocabulary-suggest.mjs';
import type { VocabularyArticle, VocabularyCategory, VocabularyDirectory, VocabularyWord } from '@/lib/vocabulary-types';

import { VocabularyEntry } from './vocabulary-entry';
import { VocabularySearch } from './vocabulary-search';
import { VocabularyTable, WordTable } from './vocabulary-table';
import styles from './vocabulary.module.css';

const LIST_METADATA: Metadata = {
  title: 'Từ vựng IELTS: nghĩa, phát âm, cách dùng | Aver Learning',
  description: 'Tra cứu từ vựng IELTS theo chủ đề: nghĩa tiếng Việt, phát âm, kết hợp từ và lỗi người Việt hay mắc. Đọc và nghe miễn phí, không cần tài khoản.',
  alternates: { canonical: '/vocabulary' },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function queryText(value: string | string[] | undefined) {
  return typeof value === 'string' ? value.trim() : '';
}

const RESULTS_LIMIT = 50;

/** The entry an address opens, if any (compound identity, or a unique legacy slug). */
async function resolveEntry(category: string, slug: string): Promise<VocabularyArticle | null> {
  if (!slug) return null;
  if (category) {
    const direct = await getVocabularyArticle(category, slug);
    if (direct) return normalizeVocabularyArticle(direct, category, slug) as VocabularyArticle;
  }
  // A retired category or a slug-only link: resolve only a slug that names one word.
  const categories = normalizeVocabularyCategories(await getVocabularyCategories());
  const selected = resolveVocabularySelection(categories.flatMap((item) => item.articles), '', slug);
  if (!selected) return null;
  const payload = await getVocabularyArticle(selected.category, selected.slug);
  return payload ? normalizeVocabularyArticle(payload, selected.category, selected.slug) as VocabularyArticle : null;
}

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const params = await searchParams;
  const slug = queryText(params.slug);
  if (!slug) return LIST_METADATA;
  let article: VocabularyArticle | null = null;
  try {
    article = await resolveEntry(queryText(params.cat), slug);
  } catch {
    article = null;
  }
  if (!article) return { ...LIST_METADATA, robots: { index: false, follow: true } };
  const meaning = article.definitionVi.trim() || article.glossVi;
  return {
    title: `${article.headword} — nghĩa, phát âm, cách dùng | Aver Learning`,
    description: meaning
      ? `${article.headword}: ${meaning}. Phát âm, ví dụ, kết hợp từ và lỗi hay mắc khi dùng trong IELTS.`
      : `${article.headword}: nghĩa, phát âm, ví dụ và cách dùng trong IELTS.`,
    alternates: { canonical: entryHref(article) },
  };
}

function Breadcrumb({ trail }: { trail: Array<{ label: string; href?: string }> }) {
  return (
    <nav aria-label="Đường dẫn" className={styles.breadcrumb}>
      <ol>
        <li><a href="/library">Thư viện</a></li>
        {trail.map((item) => <li key={item.label}>{item.href ? <a href={item.href}>{item.label}</a> : <span aria-current="page">{item.label}</span>}</li>)}
      </ol>
    </nav>
  );
}

function CourseLine() {
  return (
    <CourseLinkLine href="/" linkLabel="Xem các khoá học">
      Đọc và nghe ở đây luôn miễn phí. Muốn tự viết câu với từ mới và được AI chấm, cần một khoá học:
    </CourseLinkLine>
  );
}

function TopicLinks({ categories, active, total }: { categories: VocabularyCategory[]; active: string; total: number }) {
  return (
    <nav aria-label="Lọc theo chủ đề" className={styles.topics} id="theo-chu-de">
      <h2 className={styles.sectionTitle}>Theo chủ đề</h2>
      <ul>
        <li><a href="/vocabulary" aria-current={!active ? 'page' : undefined}>Tất cả <span className={styles.count}>{total}</span></a></li>
        {categories.filter((item) => item.articleCount).map((item) => (
          <li key={item.slug}>
            <a href={`/vocabulary?cat=${encodeURIComponent(item.slug)}`} aria-current={active === item.slug ? 'page' : undefined}>
              {item.title} <span className={styles.count}>{item.articleCount}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

async function ListView({ category }: { category: string }) {
  let effective = category;
  let directory = normalizeVocabularyDirectory(await getVocabularyDirectory({ category: effective })) as VocabularyDirectory;
  if (effective && !directory.categories.some((item) => item.slug === effective)) {
    // A retired topic falls back to the whole list.
    effective = '';
    directory = normalizeVocabularyDirectory(await getVocabularyDirectory()) as VocabularyDirectory;
  }
  const total = directory.categories.reduce((sum, item) => sum + item.articleCount, 0);
  const topic = directory.categories.find((item) => item.slug === effective);
  return (
    <main className={styles.page}>
      <Breadcrumb trail={topic ? [{ label: 'Từ vựng', href: '/vocabulary' }, { label: topic.title }] : [{ label: 'Từ vựng' }]} />
      <header className={styles.intro}>
        <h1>{topic ? topic.title : 'Từ vựng'}</h1>
        <p>
          {topic
            ? `${topic.articleCount} từ của chủ đề ${topic.title}, giải thích bằng tiếng Việt.`
            : `Nghĩa, phát âm và cách dùng của ${total} từ thường gặp trong IELTS, giải thích bằng tiếng Việt. Đọc và nghe miễn phí, không cần tài khoản.`}
        </p>
      </header>
      <VocabularySearch />
      <TopicLinks categories={directory.categories} active={effective} total={total} />
      <section aria-labelledby="vocabulary-words" className={styles.words}>
        <h2 id="vocabulary-words" className={styles.sectionTitle}>{topic ? `Các từ · ${topic.title}` : 'Tất cả từ'}</h2>
        <VocabularyTable initial={directory} category={effective} />
      </section>
      <CourseLine />
    </main>
  );
}

async function ResultsView({ query }: { query: string }) {
  const wire = await getAllVocabularyWords();
  const categories = normalizeVocabularyCategories(await getVocabularyCategories().catch(() => []) ?? []);
  const known = new Set(categories.map((item) => item.slug));
  const words = (normalizeVocabularyDirectory({
    categories: categories.map((item) => ({ slug: item.slug, title: item.title, article_count: item.articleCount })),
    items: wire.filter((item) => known.has(item.category)),
    total: wire.length,
    offset: 0,
    limit: Math.max(wire.length, 1),
  }) as VocabularyDirectory).items;
  const matches = matchWords(query, words).slice(0, RESULTS_LIMIT) as VocabularyWord[];
  const near = matches.length ? [] : nearWords(query, words) as VocabularyWord[];
  return (
    <main className={styles.page}>
      <Breadcrumb trail={[{ label: 'Từ vựng', href: '/vocabulary' }, { label: 'Kết quả tra' }]} />
      <VocabularySearch initialQuery={query} />
      {matches.length ? (
        <section aria-labelledby="vocabulary-results" className={styles.words}>
          <h1 id="vocabulary-results" className={styles.resultsTitle}>{matches.length} mục từ khớp “{query}”</h1>
          <WordTable words={matches} />
        </section>
      ) : (
        <section className={styles.notFound} aria-labelledby="vocabulary-results">
          <h1 id="vocabulary-results" className={styles.resultsTitle}>Chưa có mục từ “{query}”</h1>
          {near.length ? (
            <>
              <p>Có thể bạn gõ nhầm một chữ. Các từ gần giống nhất:</p>
              <WordTable words={near} />
            </>
          ) : null}
          <p className={styles.tip}>
            Mẹo: gõ dạng gốc của từ (<i>mitigated</i> → <i>mitigate</i>), hoặc duyệt <a href="/vocabulary">theo A–Z</a> và <a href="/vocabulary#theo-chu-de">theo chủ đề</a>.
          </p>
        </section>
      )}
      <CourseLine />
    </main>
  );
}

function MissingEntry() {
  return (
    <main className={styles.page}>
      <Breadcrumb trail={[{ label: 'Từ vựng', href: '/vocabulary' }, { label: 'Không tìm thấy' }]} />
      <section className={styles.notFound}>
        <h1 className={styles.resultsTitle} role="alert">Không tải được mục từ này</h1>
        <p>Mục từ có thể đã đổi chỗ hoặc chưa tải được. Thử tra lại:</p>
        <VocabularySearch />
        <p className={styles.tip}>Hoặc duyệt <a href="/vocabulary">toàn bộ từ vựng</a>.</p>
      </section>
    </main>
  );
}

async function VocabularyBody({ searchParams }: { searchParams: SearchParams }) {
  // `next build` has no backend: keep the shell prerenderable and read the
  // catalogue only for a real request.
  await connection();
  const params = await searchParams;
  const category = queryText(params.cat);
  const slug = queryText(params.slug);
  const query = queryText(params.q).slice(0, 160);
  if (slug) {
    const article = await resolveEntry(category, slug).catch(() => null);
    if (!article) return <MissingEntry />;
    return (
      <main className={styles.page}>
        <Breadcrumb trail={[{ label: 'Từ vựng', href: '/vocabulary' }, { label: article.headword }]} />
        <VocabularyEntry article={article} />
        <CourseLine />
      </main>
    );
  }
  if (query) return <ResultsView query={query} />;
  return <ListView category={category} />;
}

function VocabularySkeleton() {
  return <main className={styles.page}><p className={styles.loading} role="status">Đang tải từ vựng…</p></main>;
}

export default function VocabularyPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      {/* @ts-ignore custom element được đăng ký bởi public-content layout */}
      <aver-chrome active="vocabulary" />
      <div className={`av2-root ${av2FontClass} ${styles.root}`}>
        <Suspense fallback={<VocabularySkeleton />}><VocabularyBody searchParams={searchParams} /></Suspense>
      </div>
    </>
  );
}


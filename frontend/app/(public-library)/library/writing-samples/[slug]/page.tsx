// `/library/writing-samples/[slug]` — one Writing sample set of the public
// Library (LIBRARY-0061 T010, FR-013–FR-019; tờ BaiMauWriting.dc.html).
//
// - Public, no login (FR-001). The prompt, all three essays, both delta logs
//   and the judgement are in the server HTML; the views only show or hide
//   them (`sample-views.tsx`).
// - Data: `GET /api/library/writing-samples/{slug}`, uncached (`no-store`),
//   so an unpublished set is `notFound()` on the next request (FR-019). A
//   slug renamed after publishing is a backend 308; the page calls
//   `permanentRedirect` to the current page URL. Any other failure throws (no
//   fake 404 while the backend is down).
// - No `loading.tsx` and no Suspense around the read (`instant = false`
//   lets the route block on it). MEASURED with `next build && next start`
//   (23/11): under cacheComponents the route is still a partial prerender, so
//   the status is committed before the page runs. A missing set answers
//   HTTP 200 with the 404 body + `robots: noindex`, and a renamed slug answers
//   200 with a client redirect (`NEXT_REDIRECT;replace;…;308`). A hard
//   404/308 has to be decided before rendering, in `proxy.ts`, the same way as
//   Grammar articles; that is a separate change.
// - Only display-ready values reach the client components (their props are in
//   the page payload): no stored code (`problem_solution`, `task1_academic`,
//   `TR`) and no per-criterion estimate (FR-015).
// - Sections with no data leave the contents and the rest are renumbered
//   (FR-016). "Ma trận ý" is not served by the public API yet, so a Task 2 set
//   currently has six sections.
// - "Viết đề này" (FR-018): the course/credit state has no read API yet (G04)
//   and the editor has no prefill parameter yet (G08), so every reader sees
//   the "Tự viết đề này" block for now; `writeOffer` in `sample-model.mjs`
//   already decides the three states.
import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { cache } from 'react';

import { ReadingBlock, ReadingLayout } from '@/components/library/reading-layout';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { API_BASE, ABORT_MS, getPublicJson } from '@/lib/backend';
import { buildComparison, splitParagraphs } from '@/lib/delta-highlight.mjs';
import { routeFor } from '@/lib/route-registry.mjs';

import { PromptFigure } from './prompt-figure';
import {
  BANDS,
  PAIRS,
  clean,
  displayTitle,
  keyFeatures,
  outlineRows,
  pageSections,
  pickViewState,
  sampleMetadata,
  shorten,
  taskLabel,
  vocabEntryHref,
  vocabRows,
  writeOffer,
} from './sample-model.mjs';
import { SampleViews, type ComparisonView, type EssayView } from './sample-views';
import styles from './sample-page.module.css';

// The page may block on the set read (no Suspense shell inside the page); see the header comment.
export const instant = false;

type Params = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type Band = (typeof BANDS)[number];
type Delta = { criterion: string | null; before: string | null; after: string | null; why: string | null };
type Essay = { text?: string | null; word_count?: number | null; outline?: unknown; vocab_table?: unknown; structures?: unknown };
type Change = { lower_form?: string | null; higher_form?: string | null; why_vi?: string | null };
type Judgement = { criterion: string | null; summary_vi: string | null; jumps: { pair: string | null; changes: Change[] }[] };
type ListItem = { slug: string; title_en: string | null; task: string | null; question_type_label: string | null; prompt_text?: string | null };
type Sample = {
  slug: string;
  title_en: string | null;
  task: 'task2' | 'task1' | null;
  question_type_label: string | null;
  task1_subtype: string | null;
  prompt_text: string | null;
  figure_url: string | null;
  essays: Partial<Record<Band, Essay>>;
  delta_75_70: Delta[];
  delta_70_60: Delta[];
  justification: Judgement[];
  task1_data: unknown;
  updated_at: string | null;
  related: ListItem[];
  prev: { slug: string; title_en: string | null } | null;
  next: { slug: string; title_en: string | null } | null;
};

type Loaded = { kind: 'ok'; sample: Sample } | { kind: 'missing' } | { kind: 'moved'; slug: string };

const SAMPLE_PATH = '/api/library/writing-samples/';

/**
 * Reads one set, once per request (metadata and page share it). 404 → missing;
 * backend 308 → the new slug; anything else that is not 200 throws.
 */
const loadSample = cache(async (slug: string): Promise<Loaded> => {
  const res = await fetch(`${API_BASE}${SAMPLE_PATH}${encodeURIComponent(slug)}`, {
    cache: 'no-store',
    redirect: 'manual',
    signal: AbortSignal.timeout(ABORT_MS),
  });
  if (res.status === 404) return { kind: 'missing' };
  if (res.status === 308 || res.status === 301) {
    const location = res.headers.get('location') ?? '';
    const moved = decodeURIComponent(location.split(SAMPLE_PATH)[1]?.split(/[?#]/)[0] ?? '');
    if (moved && moved !== slug) return { kind: 'moved', slug: moved };
    throw new Error(`writing sample ${res.status} without a usable location`);
  }
  if (!res.ok) throw new Error(`backend ${res.status} for writing sample`);
  return { kind: 'ok', sample: (await res.json()) as Sample };
});

async function resolveSample(slug: string): Promise<Sample> {
  const loaded = await loadSample(slug);
  if (loaded.kind === 'missing') notFound();
  if (loaded.kind === 'moved') permanentRedirect(`/library/writing-samples/${encodeURIComponent(loaded.slug)}`);
  return loaded.sample;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const sample = await resolveSample(slug);
  const meta = sampleMetadata(sample);
  return {
    title: meta.title,
    description: meta.description,
    alternates: { canonical: meta.canonical },
    openGraph: { title: meta.ogTitle, description: meta.description, url: meta.canonical },
  };
}

function isLive(href: string): boolean {
  return routeFor(href)?.status === 'live';
}

/** Vocabulary entry links, looked up once per term through the cached public reader. */
async function vocabLinks(terms: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(terms.map((t) => t.trim()).filter(Boolean))];
  await Promise.all(
    unique.map(async (term) => {
      try {
        const results = await getPublicJson(`/api/vocabulary/search?q=${encodeURIComponent(term)}`);
        const href = vocabEntryHref(term, results);
        if (href) out.set(term, href);
      } catch (error) {
        // Lookup failed: show the term without a link (never a link to a missing entry).
        console.error('[library] vocabulary lookup failed', error);
      }
    }),
  );
  return out;
}

function updatedLabel(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

/** "6.0->7.0" / "7.0-7.5" → "6.0 → 7.0"; anything else is not printed. */
function pairLabel(pair: string | null): string | null {
  const bands = (pair ?? '').match(/\d\.\d/g);
  if (!bands || bands.length !== 2) return null;
  const [a, b] = bands.map(Number).sort((x, y) => x - y);
  return `${a.toFixed(1)} → ${b.toFixed(1)}`;
}

const TASK1_KIND: Record<string, string> = {
  bar: 'Biểu đồ cột',
  line: 'Biểu đồ đường',
  pie: 'Biểu đồ tròn',
  table: 'Bảng số liệu',
  process: 'Quy trình',
  map: 'Bản đồ',
  mixed: 'Biểu đồ kết hợp',
};

function kindLine(sample: { task: string | null; question_type_label: string | null; task1_subtype?: string | null }): string {
  const kind = sample.task === 'task1' ? TASK1_KIND[sample.task1_subtype ?? ''] ?? null : sample.question_type_label;
  return [taskLabel(sample.task), kind].filter(Boolean).join(' · ');
}

function promptParagraphs(text: string | null): string[] {
  return (text ?? '').split(/\n+/).map((p) => p.trim()).filter(Boolean);
}

function essayView(band: Band, essay: Essay | undefined, task: Sample['task']): EssayView | null {
  const text = clean(essay?.text);
  if (!essay || !text) return null;
  const paragraphs = splitParagraphs(text);
  const roles = outlineRows(essay.outline, task);
  const sameCount = roles.length === paragraphs.length;
  return {
    band,
    words: typeof essay.word_count === 'number' ? essay.word_count : null,
    paragraphs: paragraphs.map((p, i) => ({
      part: sameCount ? roles[i].part : null,
      fn: sameCount ? roles[i].fn : null,
      text: p,
    })),
  };
}

function WriteBlock({ offer }: { offer: 'guest' | 'write' | 'buy' }) {
  if (offer === 'write') {
    return (
      <p className={styles.writeLine}>
        Thử viết bài của bạn rồi so với bài 7.0 · <a href="/writing/dashboard">Viết đề này ›</a>
      </p>
    );
  }
  return (
    <section aria-labelledby="tu-viet" className={styles.writeBlock} data-testid="write-block">
      <h2 id="tu-viet" className={styles.writeTitle}>Tự viết đề này và để AI chấm</h2>
      <p>
        Viết bài của bạn cho đúng đề này; AI chấm theo bốn tiêu chí và chú thích từng câu như phần so sánh ở trên. Việc nộp
        bài cần một khoá học có lượt chấm AI. Bài mẫu vẫn đọc miễn phí.
      </p>
      <p className={styles.writeActions}>
        {offer === 'buy' ? (
          <a href="/" className={styles.secondary}>Đăng ký thêm lượt chấm</a>
        ) : (
          <>
            <a href="/" className={styles.secondary}>Xem các khoá học</a>
            <a href="/login">Đã có khoá? Đăng nhập</a>
          </>
        )}
      </p>
    </section>
  );
}

export default async function WritingSamplePage({ params, searchParams }: Params) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const sample = await resolveSample(slug);
  const view = pickViewState(query);
  const task = sample.task;
  const title = displayTitle(sample);
  const essays = sample.essays ?? {};

  const essayViews = BANDS.map((b) => essayView(b, essays[b], task)).filter((e): e is EssayView => e !== null);
  const comparisons: ComparisonView[] = PAIRS.flatMap((pair) => {
    const high = clean(essays[pair.high as Band]?.text);
    const low = clean(essays[pair.low as Band]?.text);
    if (!high || !low) return [];
    const { rows, marginOnly } = buildComparison(high, low, sample[pair.delta as 'delta_75_70' | 'delta_70_60']);
    return [{
      pair: pair.id,
      high: pair.high,
      low: pair.low,
      highWords: essays[pair.high as Band]?.word_count ?? null,
      lowWords: essays[pair.low as Band]?.word_count ?? null,
      rows,
      marginOnly,
    }];
  });

  const top = essays['7.5'];
  const outline = outlineRows(top?.outline, task);
  const features = task === 'task1' ? keyFeatures(sample.task1_data) : [];
  const vocab = vocabRows(top?.vocab_table);
  const links = await vocabLinks(vocab.map((v) => v.term));
  const judgement = (sample.justification ?? []).filter((j) => j.criterion && (j.summary_vi || j.jumps?.length));
  const related = (sample.related ?? []).slice(0, 4);
  const prompt = promptParagraphs(sample.prompt_text);

  const toc = pageSections({
    task,
    hasPrompt: prompt.length > 0,
    hasOutline: outline.length > 0,
    hasIdeas: false,
    hasFeatures: features.length > 0,
    hasEssays: essayViews.length > 0,
    hasJudgement: judgement.length > 0,
    hasVocab: vocab.length > 0,
    hasRelated: related.length > 0,
  });
  const num = (id: string) => toc.find((s) => s.id === id)?.n ?? '';
  const listHref = '/library/writing-samples';
  const offer = writeOffer(null);
  const updated = updatedLabel(sample.updated_at);

  const header = (
    <>
      <Breadcrumb
        items={[
          { label: 'Thư viện', href: '/library' },
          { label: 'Bài mẫu Writing', href: isLive(listHref) ? listHref : undefined },
          { label: shorten(title, 40) },
        ]}
      />
      <p className={styles.eyebrow}>{kindLine(sample)}</p>
      <h1 className={styles.title} lang="en">{title}</h1>
      <p className={styles.meta}>
        Bài mẫu 7.5 · 7.0 · 6.0 · Biên soạn Aver Learning{updated ? ` · Cập nhật ${updated}` : ''}
      </p>
    </>
  );

  return (
    <div className={styles.page}>
      <ReadingLayout toc={toc} header={header} tocLabel="Trong trang">
        {prompt.length > 0 ? (
          <ReadingBlock
            notes={
              task !== 'task1' && sample.question_type_label ? (
                <p className={styles.sideNote}>
                  <strong>Dạng đề:</strong> <span lang="en">{sample.question_type_label}</span>
                </p>
              ) : undefined
            }
          >
            <h2 id="de-bai" className={styles.h2}><span className={styles.num}>{num('de-bai')}</span> Đề bài</h2>
            <div className={styles.promptBox}>
              <p className={styles.promptEyebrow}>WRITING {taskLabel(task).toUpperCase()}</p>
              {prompt.map((p, i) => <p key={i} lang="en">{p}</p>)}
              {task === 'task1' && sample.figure_url ? (
                <PromptFigure src={`${API_BASE}${sample.figure_url}`} alt={`Hình của đề: ${title}`} />
              ) : null}
            </div>
          </ReadingBlock>
        ) : null}

        {outline.length > 0 ? (
          <ReadingBlock>
            <h2 id="dan-y" className={styles.h2}><span className={styles.num}>{num('dan-y')}</span> Dàn ý</h2>
            <p>Câu chủ đề lấy từ bài 7.5. Ba bài dùng chung dàn ý này; khác nhau ở cách diễn đạt và độ sâu phát triển ý.</p>
            <ol className={styles.outline}>
              {outline.map((row, i) => (
                <li key={i}>
                  <p className={styles.paraRole}>{[row.part, row.fn].filter(Boolean).join(' · ')}</p>
                  {row.ts ? <p lang="en">{row.ts}</p> : null}
                </li>
              ))}
            </ol>
          </ReadingBlock>
        ) : null}

        {features.length > 0 ? (
          <ReadingBlock>
            <h2 id="dac-diem-chinh" className={styles.h2}><span className={styles.num}>{num('dac-diem-chinh')}</span> Đặc điểm chính</h2>
            <ol className={styles.features}>
              {features.map((f, i) => <li key={i} lang="en">{f}</li>)}
            </ol>
          </ReadingBlock>
        ) : null}

        {essayViews.length > 0 ? (
          <section aria-labelledby="ba-bai-mau" className={styles.wide}>
            <h2 id="ba-bai-mau" className={styles.h2}><span className={styles.num}>{num('ba-bai-mau')}</span> Ba bài mẫu</h2>
            <SampleViews essays={essayViews} comparisons={comparisons} initial={view} />
          </section>
        ) : null}

        {judgement.length > 0 ? (
          <section aria-labelledby="nhan-dinh" className={styles.wide}>
            <h2 id="nhan-dinh" className={styles.h2}><span className={styles.num}>{num('nhan-dinh')}</span> Nhận định theo bốn tiêu chí</h2>
            <div className={styles.judgement}>
              {judgement.map((j, i) => (
                <div key={i} className={styles.criterion}>
                  <h3 lang="en" className={styles.h3}>{j.criterion}</h3>
                  {j.summary_vi ? <p>{j.summary_vi}</p> : null}
                  {(j.jumps ?? []).map((jump, k) => {
                    const label = pairLabel(jump.pair);
                    const changes = (jump.changes ?? []).filter((c) => c.higher_form || c.lower_form || c.why_vi);
                    if (!label || changes.length === 0) return null;
                    return (
                      <div key={k} className={styles.jump}>
                        <p className={styles.paraRole}>Từ {label}</p>
                        <ul>
                          {changes.map((c, m) => (
                            <li key={m}>
                              {c.lower_form ? <span lang="en">“{c.lower_form}”</span> : null}
                              {c.lower_form && c.higher_form ? ' → ' : null}
                              {c.higher_form ? <span lang="en">“{c.higher_form}”</span> : null}
                              {c.why_vi ? <>: {c.why_vi}</> : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            <p className={styles.quiet}>Ba bài được viết nhắm tới band ghi trên thẻ. Trang không ghi điểm riêng từng tiêu chí.</p>
          </section>
        ) : null}

        {vocab.length > 0 ? (
          <ReadingBlock>
            <h2 id="tu-vung" className={styles.h2}><span className={styles.num}>{num('tu-vung')}</span> Từ vựng đáng học</h2>
            <p>Lấy từ bài 7.5, kèm đúng câu trong bài.</p>
            <ul className={styles.vocab}>
              {vocab.map((v, i) => {
                const href = links.get(v.term);
                return (
                  <li key={i} className={styles.vocabRow} data-testid="vocab-row">
                    <p>
                      <strong lang="en">{v.term}</strong>
                      {v.pos ? <span className={styles.muted}> {v.pos}</span> : null}
                      {v.vi ? <> · {v.vi}</> : null}
                    </p>
                    {v.sentence ? (
                      <p lang="en" className={styles.vocabSentence}>
                        {v.sentence.pre}
                        {v.sentence.hit ? <strong>{v.sentence.hit}</strong> : null}
                        {v.sentence.post}
                      </p>
                    ) : null}
                    {href ? <a href={href}>Mục từ ›</a> : null}
                  </li>
                );
              })}
            </ul>
          </ReadingBlock>
        ) : null}

        {related.length > 0 ? (
          <ReadingBlock>
            <h2 id="de-lien-quan" className={styles.h2}><span className={styles.num}>{num('de-lien-quan')}</span> Đề liên quan</h2>
            <ul className={styles.related}>
              {related.map((r) => (
                <li key={r.slug}>
                  <p className={styles.eyebrow}>{kindLine(r)}</p>
                  <a href={`/library/writing-samples/${encodeURIComponent(r.slug)}`} lang="en">{displayTitle(r)}</a>
                </li>
              ))}
            </ul>
          </ReadingBlock>
        ) : null}
      </ReadingLayout>

      <WriteBlock offer={offer} />

      {sample.prev || sample.next ? (
        <nav aria-label="Đề trước và đề sau" className={styles.prevNext}>
          {sample.prev ? (
            <a href={`/library/writing-samples/${encodeURIComponent(sample.prev.slug)}`} rel="prev">
              <span className={styles.muted}>‹ Đề trước</span>
              <span lang="en">{displayTitle(sample.prev)}</span>
            </a>
          ) : <span />}
          {sample.next ? (
            <a href={`/library/writing-samples/${encodeURIComponent(sample.next.slug)}`} rel="next" className={styles.nextLink}>
              <span className={styles.muted}>Đề sau ›</span>
              <span lang="en">{displayTitle(sample.next)}</span>
            </a>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}

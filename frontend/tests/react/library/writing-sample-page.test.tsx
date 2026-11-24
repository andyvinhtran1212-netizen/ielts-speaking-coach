// LIBRARY-0061 T010: `/library/writing-samples/[slug]` (FR-001, FR-013–FR-019).
// The Server Component is awaited and its tree rendered; only the backend
// transport (`fetch`, `getPublicJson`) and the Next navigation throws are faked.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const publicJson = vi.fn(async (_path: string): Promise<unknown> => []);

vi.mock('@/lib/backend', () => ({
  API_BASE: 'https://api.test',
  ABORT_MS: 5000,
  getPublicJson: (p: string) => publicJson(p),
}));

class NotFound extends Error {}
class Redirect extends Error {
  constructor(public to: string) { super(to); }
}
vi.mock('next/navigation', () => ({
  notFound: () => { throw new NotFound('not found'); },
  permanentRedirect: (to: string) => { throw new Redirect(to); },
}));

import WritingSamplePage, { generateMetadata } from '@/app/(public-library)/library/writing-samples/[slug]/page';

const E75 = 'Remote work saves commuting time for many employees.\n\nIt also blurs the line between home and office.\n\nOverall, the benefits are greater.';
const E70 = 'Remote work save time of travel for many employees.\n\nIt also blurs the line between home and office.\n\nOverall, benefits are bigger.';
const E60 = 'Remote work is good because people save time.\n\nBut home and office is mix.\n\nSo benefits is more.';

function task2(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'working-from-home',
    title_en: 'Working from home: benefits versus drawbacks',
    task: 'task2',
    question_type: 'advantages-disadvantages',
    question_type_label: 'Advantages and Disadvantages',
    task1_subtype: null,
    topic_slug: 'work',
    prompt_text: 'More people now work from home using digital technology.\nDo the advantages outweigh the disadvantages?',
    figure_url: null,
    essays: {
      '7.5': {
        text: E75,
        word_count: 307,
        outline: [
          { paragraph: 1, function: 'intro', topic_sentence: 'Remote work saves commuting time.' },
          { paragraph: 2, function: 'body1', topic_sentence: 'It blurs the line.' },
          { paragraph: 3, function: 'conclusion', topic_sentence: 'Benefits are greater.' },
        ],
        vocab_table: [
          { term: 'commuting', pos: 'n', meaning_vi: 'việc đi làm', sentence_in_essay: 'Remote work saves commuting time for many employees.' },
          { term: 'blurs', pos: 'v', meaning_vi: 'làm mờ', sentence_in_essay: 'It also blurs the line.' },
        ],
        structures: [],
      },
      '7.0': { text: E70, word_count: 290, outline: [], vocab_table: [], structures: [] },
      '6.0': { text: E60, word_count: 260, outline: [], vocab_table: [], structures: [] },
    },
    delta_75_70: [
      { criterion: 'Lexical Resource', before: 'saves commuting time', after: 'save time of travel', why: 'Cụm danh từ tự nhiên hơn.' },
      { criterion: 'Grammatical Range and Accuracy', before: '', after: 'benefits are bigger', why: 'Thiếu mạo từ, so sánh chưa hợp.' },
      { criterion: 'Task Response', before: 'not in this essay', after: 'nor this', why: 'Ghi chú lề.' },
    ],
    delta_70_60: [
      { criterion: 'Coherence and Cohesion', before: 'It also blurs', after: 'But home', why: 'Liên kết yếu.' },
    ],
    justification: [
      { criterion: 'Lexical Resource', summary_vi: 'Từ vựng chính xác dần lên.', jumps: [{ pair: '7.0-7.5', changes: [{ lower_form: 'big', higher_form: 'substantial', why_vi: 'chính xác hơn' }] }] },
    ],
    task1_data: null,
    published_at: '2026-11-20T00:00:00Z',
    updated_at: '2026-11-21T03:00:00Z',
    related: [1, 2, 3, 4, 5].map((i) => ({ slug: `rel-${i}`, title_en: `Related ${i}`, task: 'task2', question_type: 'opinion', question_type_label: 'Opinion', topic_slug: 'work', prompt_text: 'p' })),
    prev: { slug: 'bike-lanes', title_en: 'Bike lanes in cities' },
    next: { slug: 'plastic-bags', title_en: 'Paying for plastic bags' },
    ...overrides,
  };
}

type Reply = { status: number; body?: unknown; location?: string };
let reply: Reply;
const fetchCalls: { url: string; init?: RequestInit }[] = [];

beforeEach(() => {
  reply = { status: 200, body: task2() };
  fetchCalls.length = 0;
  publicJson.mockReset();
  publicJson.mockImplementation(async (p: string) =>
    p.includes('q=commuting') ? [{ headword: 'commuting', slug: 'commuting', category: 'work' }] : [{ headword: 'blurry', slug: 'blurry', category: 'misc' }]);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    fetchCalls.push({ url, init });
    const headers = new Headers(reply.location ? { location: reply.location } : {});
    return new Response(reply.status === 200 ? JSON.stringify(reply.body) : '{}', { status: reply.status, headers });
  }));
  window.history.replaceState(null, '', '/library/writing-samples/working-from-home');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderPage(slug = 'working-from-home', query: Record<string, string> = {}) {
  const ui = await WritingSamplePage({ params: Promise.resolve({ slug }), searchParams: Promise.resolve(query) });
  return render(ui);
}

function visible(el: Element | null): boolean {
  for (let cur = el; cur; cur = cur.parentElement) if ((cur as HTMLElement).hidden) return false;
  return Boolean(el);
}

describe('server HTML (FR-001, FR-013, FR-015)', () => {
  it('reads the set uncached, renders all three essays and the delta notes, and no stored code', async () => {
    const { container } = await renderPage();
    expect(fetchCalls[0].url).toBe('https://api.test/api/library/writing-samples/working-from-home');
    expect(fetchCalls[0].init).toMatchObject({ cache: 'no-store', redirect: 'manual' });
    const html = container.innerHTML;
    for (const text of ['Remote work saves commuting time', 'Remote work save time of travel', 'Remote work is good because']) {
      expect(html).toContain(text);
    }
    expect(html).toContain('Cụm danh từ tự nhiên hơn.');
    expect(html).toContain('Liên kết yếu.');
    expect(html).not.toMatch(/problem_solution|advantages_disadvantages|task1_academic|TR:|CC:|LR:|GRA:/);
  });

  it('defaults to "Đọc từng bài" with band 7.5 shown and the others hidden', async () => {
    await renderPage();
    expect(visible(screen.getByTestId('view-doc'))).toBe(true);
    expect(visible(screen.getByTestId('view-compare'))).toBe(false);
    expect(visible(document.querySelector('[data-band=\"7.5\"]'))).toBe(true);
    expect(visible(document.querySelector('[data-band=\"7.0\"]'))).toBe(false);
    expect(screen.getByRole('link', { name: 'Đọc từng bài' }).getAttribute('aria-current')).toBe('true');
  });

  it('keeps xem / muc / cap from the URL', async () => {
    await renderPage('working-from-home', { xem: 'so-sanh', cap: '7.0-6.0' });
    expect(visible(screen.getByTestId('view-compare'))).toBe(true);
    expect(visible(document.querySelector('[data-pair=\"7.0-6.0\"]'))).toBe(true);
    expect(visible(document.querySelector('[data-pair=\"7.5-7.0\"]'))).toBe(false);
  });

  it('switching view or band rewrites the query string in place', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('link', { name: '6.0' }));
    expect(window.location.search).toBe('?muc=6.0');
    expect(visible(document.querySelector('[data-band=\"6.0\"]'))).toBe(true);
    fireEvent.click(screen.getByRole('link', { name: 'So sánh hai mức' }));
    expect(window.location.search).toBe('?xem=so-sanh&muc=6.0');
    expect(visible(screen.getByTestId('view-compare'))).toBe(true);
  });
});

describe('delta log in the comparison (FR-014)', () => {
  it('marks both columns, lower-only errors in the right column only, unmatched entries in the margin', async () => {
    await renderPage('working-from-home', { xem: 'so-sanh' });
    const pair = screen.getByRole('region', { name: 'So sánh 7.5 và 7.0' });
    const marks = [...pair.querySelectorAll('mark')].map((m) => [m.getAttribute('data-side'), m.textContent]);
    expect(marks).toEqual([
      ['high', 'saves commuting time'],
      ['low', 'save time of travel'],
      ['low', 'benefits are bigger'],
    ]);
    const margin = within(pair).getAllByTestId('margin-only-note');
    expect(margin).toHaveLength(1);
    expect(margin[0].textContent).toContain('Ghi chú lề.');
    expect(margin[0].textContent).toContain('Task Response');
  });

  it('pressing a note number highlights the phrase in both columns; pressing again clears it', async () => {
    await renderPage('working-from-home', { xem: 'so-sanh' });
    const pair = screen.getByRole('region', { name: 'So sánh 7.5 và 7.0' });
    const row = within(pair).getAllByTestId('compare-row')[0];
    const [noteButton] = within(row).getAllByRole('button', { name: '1' });
    fireEvent.click(noteButton);
    const pressed = within(row).getAllByRole('button', { name: 'Chú thích 1' }).map((b) => b.getAttribute('aria-pressed'));
    expect(pressed).toEqual(['true', 'true']);
    fireEvent.click(noteButton);
    expect(within(row).getAllByRole('button', { name: 'Chú thích 1' }).map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false']);
  });

  it('identical paragraphs are shown once', async () => {
    await renderPage('working-from-home', { xem: 'so-sanh' });
    const pair = screen.getByRole('region', { name: 'So sánh 7.5 và 7.0' });
    expect(within(pair).getByText('Hai mức viết giống hệt nhau; trang hiện một lần.')).toBeTruthy();
  });
});

describe('sections, links and offers (FR-016, FR-017, FR-018)', () => {
  it('Task 2: contents numbered without gaps; no "Ma trận ý" while the API has none', async () => {
    await renderPage();
    const toc = screen.getAllByRole('navigation', { name: 'Trong trang' })[0];
    const labels = within(toc).getAllByRole('link').map((a) => a.textContent);
    expect(labels).toEqual(['1Đề bài', '2Dàn ý', '3Ba bài mẫu', '4Nhận định theo bốn tiêu chí', '5Từ vựng đáng học', '6Đề liên quan']);
  });

  it('Task 1: prompt with its figure, section 3 "Đặc điểm chính", renumbered when the outline is missing', async () => {
    const base = task2();
    reply = {
      status: 200,
      body: task2({
        task: 'task1',
        question_type: null,
        question_type_label: null,
        task1_subtype: 'pie_bar',
        figure_url: '/api/library/media/writing-sample/chart/figure',
        task1_data: { key_features: ['Cost was the largest reason.', 'Daily use falls with age.'] },
        essays: { ...base.essays, '7.5': { ...base.essays['7.5'], outline: [] } },
      }),
    };
    const { container } = await renderPage('chart');
    const toc = screen.getAllByRole('navigation', { name: 'Trong trang' })[0];
    expect(within(toc).getAllByRole('link').map((a) => a.textContent).slice(0, 3)).toEqual(['1Đề bài', '2Đặc điểm chính', '3Ba bài mẫu']);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://api.test/api/library/media/writing-sample/chart/figure');
    expect(screen.getByText('WRITING TASK 1')).toBeTruthy();
    expect(container.innerHTML).not.toContain('pie_bar');
  });

  it('a vocabulary term links to its entry only when the entry exists', async () => {
    await renderPage();
    const rows = screen.getAllByTestId('vocab-row');
    expect(within(rows[0]).getByRole('link', { name: 'Mục từ ›' }).getAttribute('href')).toBe('/vocabulary?cat=work&slug=commuting');
    expect(within(rows[1]).queryByRole('link')).toBeNull();
  });

  it('a failed vocabulary lookup shows the term without a link, the page still renders', async () => {
    publicJson.mockImplementation(async () => { throw new Error('backend 503'); });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await renderPage();
    expect(screen.getAllByTestId('vocab-row').every((r) => within(r).queryByRole('link') === null)).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  it('at most four related prompts; prev / next link to their pages', async () => {
    await renderPage();
    const related = document.getElementById('de-lien-quan')!.parentElement!;
    expect(within(related).getAllByRole('link')).toHaveLength(4);
    const nav = screen.getByRole('navigation', { name: 'Đề trước và đề sau' });
    expect(within(nav).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '/library/writing-samples/bike-lanes',
      '/library/writing-samples/plastic-bags',
    ]);
  });

  it('every reader sees "Tự viết đề này" with a secondary course link (no course/credit read API yet)', async () => {
    await renderPage();
    const block = screen.getByTestId('write-block');
    expect(within(block).getByRole('heading', { name: 'Tự viết đề này và để AI chấm' })).toBeTruthy();
    expect(within(block).getByRole('link', { name: 'Xem các khoá học' }).getAttribute('href')).toBe('/');
  });
});

describe('missing and moved sets (FR-019) and metadata (plan §5.4)', () => {
  it('a 404 from the API calls notFound()', async () => {
    reply = { status: 404 };
    await expect(renderPage('gone')).rejects.toBeInstanceOf(NotFound);
  });

  it('a 308 from the API redirects permanently to the current slug', async () => {
    reply = { status: 308, location: '/api/library/writing-samples/new-slug' };
    await expect(renderPage('old-slug')).rejects.toMatchObject({ to: '/library/writing-samples/new-slug' });
  });

  it('any other failure throws (no fake 404)', async () => {
    reply = { status: 503 };
    await expect(renderPage()).rejects.toThrow('backend 503');
  });

  it('metadata: title, canonical, og title', async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ slug: 'working-from-home' }), searchParams: Promise.resolve({}) });
    expect(meta.title).toBe('Working from home: benefits versus drawbacks — IELTS Writing Task 2: bài mẫu 7.5, 7.0, 6.0 | Aver Learning');
    expect(meta.alternates?.canonical).toBe('/library/writing-samples/working-from-home');
    expect((meta.openGraph as { title?: string }).title).toBe('Working from home: benefits versus drawbacks');
  });
});

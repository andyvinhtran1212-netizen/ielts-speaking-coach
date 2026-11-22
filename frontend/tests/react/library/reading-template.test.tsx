// LIBRARY-0061 T007 (FR-003, FR-021, FR-022): reading layout, margin notes, course link line.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CourseLinkLine } from '@/components/library/course-link-line';
import { AnnotatedSample, MarginNote, NoteRef, numberSampleNotes } from '@/components/library/margin-note';
import { pickActiveSection, ReadingBlock, ReadingLayout } from '@/components/library/reading-layout';

type ObserverRecord = {
  callback: IntersectionObserverCallback;
  targets: Element[];
  options?: IntersectionObserverInit;
  disconnected: boolean;
};

let observers: ObserverRecord[] = [];
const OriginalObserver = globalThis.IntersectionObserver;

beforeEach(() => {
  observers = [];
  class FakeObserver {
    record: ObserverRecord;
    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      this.record = { callback, targets: [], options, disconnected: false };
      observers.push(this.record);
    }
    observe(el: Element) { this.record.targets.push(el); }
    unobserve() {}
    disconnect() { this.record.disconnected = true; }
    takeRecords() { return []; }
  }
  globalThis.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver;
});

afterEach(() => {
  cleanup();
  globalThis.IntersectionObserver = OriginalObserver;
});

function fire(entries: Array<{ id: string; intersecting: boolean; top?: number }>) {
  const record = observers.at(-1)!;
  act(() => {
    record.callback(
      entries.map(({ id, intersecting, top = 100 }) => ({
        target: document.getElementById(id)!,
        isIntersecting: intersecting,
        boundingClientRect: { top } as DOMRectReadOnly,
      })) as unknown as IntersectionObserverEntry[],
      {} as IntersectionObserver,
    );
  });
}

const TOC = [
  { id: 'hoi-gi', n: '1', label: 'Đề discussion hỏi gì' },
  { id: 'hai-cau', n: '2', label: 'Hai câu của mở bài' },
  { id: 'doan-mau', n: '3', label: 'Đoạn mẫu có chú thích' },
];

function Article() {
  return (
    <ReadingLayout
      toc={TOC}
      header={<h1>Cách viết mở bài Task 2 cho dạng discussion</h1>}
      tocFooter={<p>Thuộc nhóm Task 2</p>}
    >
      {TOC.map((item) => (
        <ReadingBlock key={item.id} notes={item.n === '1' ? <MarginNote n={1}>Câu lệnh là dấu hiệu.</MarginNote> : undefined}>
          <h2 id={item.id}>{item.n} {item.label}</h2>
          <p>
            Nội dung {item.n}
            {item.n === '1' ? <NoteRef n={1} /> : null}
          </p>
        </ReadingBlock>
      ))}
    </ReadingLayout>
  );
}

describe('ReadingLayout', () => {
  it('renders the article, the wide contents and the notes column in the markup', () => {
    render(<Article />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Cách viết mở bài Task 2 cho dạng discussion');
    const navs = screen.getAllByRole('navigation', { name: 'Trong bài này' });
    expect(navs).toHaveLength(2); // wide column + narrow disclosure; CSS shows exactly one
    const links = within(navs[0]).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['#hoi-gi', '#hai-cau', '#doan-mau']);
    expect(screen.getByText('Thuộc nhóm Task 2')).toBeTruthy();
    expect(screen.getByText('Câu lệnh là dấu hiệu.').closest('aside')).toBeTruthy();
  });

  it('marks the first section as being read before any scrolling', () => {
    render(<Article />);
    const [wide] = screen.getAllByRole('navigation', { name: 'Trong bài này' });
    const current = within(wide).getByRole('link', { current: 'location' });
    expect(current.getAttribute('href')).toBe('#hoi-gi');
  });

  it('observes every section heading with a reading line near the top', () => {
    render(<Article />);
    const record = observers.at(-1)!;
    expect(record.targets.map((el) => el.id)).toEqual(['hoi-gi', 'hai-cau', 'doan-mau']);
    expect(record.options?.rootMargin).toBe('0px 0px -70% 0px');
  });

  it('updates the section being read as headings cross the reading line (mô phỏng IntersectionObserver)', () => {
    render(<Article />);
    const wide = () => screen.getAllByRole('navigation', { name: 'Trong bài này' })[0];
    fire([{ id: 'hoi-gi', intersecting: false, top: -400 }, { id: 'hai-cau', intersecting: true }]);
    expect(within(wide()).getByRole('link', { current: 'location' }).getAttribute('href')).toBe('#hai-cau');
    expect(within(wide()).getByRole('link', { current: 'location' }).closest('li')?.className).toMatch(/tocCurrent/);
    fire([{ id: 'doan-mau', intersecting: true }]);
    expect(within(wide()).getByRole('link', { current: 'location' }).getAttribute('href')).toBe('#doan-mau');
    // Scrolling back up: the third heading drops below the line again.
    fire([{ id: 'doan-mau', intersecting: false, top: 900 }]);
    expect(within(wide()).getByRole('link', { current: 'location' }).getAttribute('href')).toBe('#hai-cau');
    // Exactly one current item in each contents list.
    for (const nav of screen.getAllByRole('navigation', { name: 'Trong bài này' })) {
      expect(within(nav).getAllByRole('link', { current: 'location' })).toHaveLength(1);
    }
  });

  it('disconnects the observer on unmount', () => {
    const { unmount } = render(<Article />);
    const record = observers.at(-1)!;
    unmount();
    expect(record.disconnected).toBe(true);
  });

  it('narrow screens: the contents is a disclosure closed by default and opens on press', () => {
    render(<Article />);
    const details = screen.getByTestId('reading-toc-narrow') as HTMLDetailsElement;
    expect(details.tagName).toBe('DETAILS');
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')?.textContent).toBe('Trong bài này · 3 mục');
    fireEvent.click(details.querySelector('summary')!);
    expect(details.open).toBe(true);
  });

  it('CSS: three columns 224/640/248 from 1024px, one column with the disclosure below it', () => {
    const css = readFileSync(path.join(__dirname, '../../../components/library/reading-layout.module.css'), 'utf8');
    expect(css).toMatch(/grid-template-columns: 224px/);
    expect(css).toMatch(/minmax\(0, 640px\) 248px/);
    expect(css).toMatch(/position: sticky/);
    expect(css).toMatch(/border-left: 3px solid transparent/);
    const narrow = css.slice(css.indexOf('@media (max-width: 1023px)'));
    expect(narrow).toMatch(/\.tocColumn \{ display: none; \}/);
    expect(narrow).toMatch(/\.tocNarrow \{\s*display: block;/);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('an empty contents list renders no contents at all', () => {
    render(
      <ReadingLayout toc={[]} header={<h1>Bài</h1>}>
        <p>Thân bài</p>
      </ReadingLayout>,
    );
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByTestId('reading-toc-narrow')).toBeNull();
  });

  it('pickActiveSection: last passed heading, else the first', () => {
    const ids = ['a', 'b', 'c'];
    expect(pickActiveSection(ids, new Set())).toBe('a');
    expect(pickActiveSection(ids, new Set(['a', 'b']))).toBe('b');
    expect(pickActiveSection(ids, new Set(['c']))).toBe('c');
    expect(pickActiveSection([], new Set())).toBeNull();
  });
});

const PARTS = [
  'While some people argue that',
  { anchor: 'frame', text: ' university students should be free to choose' },
  ' any subject',
  { anchor: 'paraphrase', text: ' they enjoy' },
  ', others believe that degrees should focus on',
  { anchor: 'future', text: ' fields with clear future value' },
  '.',
];

const NOTES = [
  { anchor: 'future', kind: 'Lexical Resource', text: 'Diễn đạt lại subjects that will be useful in the future.' },
  { anchor: 'frame', kind: 'Coherence and Cohesion', text: 'Khung nối hai quan điểm trong một câu.' },
  { anchor: 'paraphrase', kind: 'Lexical Resource', text: 'Diễn đạt lại study whatever they like.' },
];

describe('AnnotatedSample', () => {
  it('numbers notes from 1 in text order and keeps the full sample in the markup', () => {
    render(<AnnotatedSample label="Ví dụ minh hoạ · Aver Learning viết" parts={PARTS} notes={NOTES} />);
    const sample = screen.getByText((_, el) => el?.tagName === 'P' && el.getAttribute('lang') === 'en');
    expect(sample.textContent).toContain('university students should be free to choose');
    const margin = screen.getByRole('list');
    const kinds = within(margin).getAllByText(/Coherence|Lexical/).map((el) => el.textContent);
    expect(kinds).toEqual(['Coherence and Cohesion', 'Lexical Resource', 'Lexical Resource']);
    expect(within(margin).getAllByRole('button').map((b) => b.textContent)).toEqual(['1', '2', '3']);
  });

  it('pressing a margin number highlights exactly the phrase with that data-anchor; pressing again removes it', () => {
    const { container } = render(<AnnotatedSample parts={PARTS} notes={NOTES} />);
    const margin = screen.getByRole('list');
    const two = within(margin).getByRole('button', { name: 'Chú thích 2' });
    fireEvent.click(two);
    expect(two.getAttribute('aria-pressed')).toBe('true');
    const on = container.querySelectorAll('[data-active="true"]');
    expect(on).toHaveLength(1);
    expect(on[0].getAttribute('data-anchor')).toBe('paraphrase');
    expect(on[0].textContent).toBe(' they enjoy');
    expect(screen.getByText('Lexical Resource · đang chọn')).toBeTruthy();

    fireEvent.click(two);
    expect(two.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelectorAll('[data-active="true"]')).toHaveLength(0);
  });

  it('the superscript number in the text toggles the same phrase, and choosing another moves the highlight', () => {
    const { container } = render(<AnnotatedSample parts={PARTS} notes={NOTES} />);
    const sample = container.querySelector('p[lang="en"]')!;
    const supOne = within(sample as HTMLElement).getByRole('button', { name: 'Chú thích 1' });
    fireEvent.click(supOne);
    expect(container.querySelector('[data-active="true"]')?.getAttribute('data-anchor')).toBe('frame');
    const marginOne = within(screen.getByRole('list')).getByRole('button', { name: 'Chú thích 1' });
    expect(marginOne.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(sample as HTMLElement).getByRole('button', { name: 'Chú thích 3' }));
    const on = container.querySelectorAll('[data-active="true"]');
    expect(on).toHaveLength(1);
    expect(on[0].getAttribute('data-anchor')).toBe('future');
  });

  it('numbers restart from 1 in every sample paragraph', () => {
    render(
      <>
        <AnnotatedSample parts={PARTS} notes={NOTES} />
        <AnnotatedSample parts={['A ', { anchor: 'x', text: 'phrase' }]} notes={[{ anchor: 'x', text: 'Ghi chú.' }]} />
      </>,
    );
    const lists = screen.getAllByRole('list');
    expect(within(lists[1]).getAllByRole('button').map((b) => b.textContent)).toEqual(['1']);
  });

  it('a note whose phrase is missing stays in the margin, numbered last, and cannot be pressed', () => {
    const numbered = numberSampleNotes(PARTS, [...NOTES, { anchor: 'gone', text: 'Không có cụm.' }]);
    expect(numbered.map((n) => [n.anchor, n.n, n.linked])).toEqual([
      ['frame', 1, true],
      ['paraphrase', 2, true],
      ['future', 3, true],
      ['gone', 4, false],
    ]);
    render(<AnnotatedSample parts={PARTS} notes={[...NOTES, { anchor: 'gone', text: 'Không có cụm.' }]} />);
    expect(within(screen.getByRole('list')).getAllByRole('button')).toHaveLength(3);
    expect(screen.getByText('Không có cụm.')).toBeTruthy();
  });
});

describe('CourseLinkLine', () => {
  it('shows one line with one link when the course data is missing or the viewer has no course', () => {
    const { rerender } = render(
      <CourseLinkLine href="/" linkLabel="Xem các khoá học">
        Muốn nộp bài để AI chấm theo bốn tiêu chí, cần một khoá học:
      </CourseLinkLine>,
    );
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link').getAttribute('href')).toBe('/');
    rerender(
      <CourseLinkLine href="/" linkLabel="Xem các khoá học" hasCourse={false}>
        Muốn nộp bài:
      </CourseLinkLine>,
    );
    expect(screen.getByRole('link', { name: 'Xem các khoá học' })).toBeTruthy();
    rerender(
      <CourseLinkLine href="/" linkLabel="Xem các khoá học" hasCourse={null}>
        Muốn nộp bài:
      </CourseLinkLine>,
    );
    expect(screen.getByRole('link', { name: 'Xem các khoá học' })).toBeTruthy();
  });

  it('is hidden when the viewer already has a course with this content', () => {
    const { container } = render(
      <CourseLinkLine href="/" linkLabel="Xem các khoá học" hasCourse>
        Muốn nộp bài:
      </CourseLinkLine>,
    );
    expect(container.innerHTML).toBe('');
  });
});

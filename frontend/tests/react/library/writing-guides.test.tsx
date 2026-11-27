// LIBRARY-0061 T011 (G06-T11; FR-020, FR-021, FR-022, FR-023): Kiến thức Writing list and guide.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { GuideArticle, GuideMissing } from '@/app/(public-library)/library/writing-guides/[slug]/guide-article';
import type { GuideDetail, GuideList } from '@/app/(public-library)/library/writing-guides/guides-data';
import { GuideGroups, GuidesError, GuidesSkeleton, Intro } from '@/app/(public-library)/library/writing-guides/guides-list';

afterEach(cleanup);

const item = (slug: string, title: string, groups: string[]) => ({
  slug,
  title,
  summary: `Tóm tắt ${title}.`,
  reading_minutes: 4,
  groups,
  updated_at: '2026-11-20T08:00:00+00:00',
});

const LIST: GuideList = {
  total: 2,
  groups: [
    { id: 'task1', label: 'Task 1', items: [] },
    { id: 'task2', label: 'Task 2', items: [item('mo-bai-discussion', 'Mở bài discussion', ['task2', 'question-type'])] },
    { id: 'criteria', label: 'Tiêu chí chấm', items: [item('task-response', 'Task Response', ['criteria'])] },
    { id: 'question-type', label: 'Dạng đề', items: [item('mo-bai-discussion', 'Mở bài discussion', ['task2', 'question-type'])] },
    { id: 'extra', label: 'Không biết', items: [item('x', 'X', ['extra'])] },
  ],
};

describe('Kiến thức Writing list (FR-020)', () => {
  it('draws only non-empty fixed groups, in order, with their fixed numbers', () => {
    const { container } = render(<GuideGroups data={LIST} />);
    const sections = [...container.querySelectorAll('section[data-group]')].map((s) => s.getAttribute('data-group'));
    expect(sections).toEqual(['task2', 'criteria', 'question-type']);
    expect(screen.getByRole('heading', { level: 2, name: /3\s+Tiêu chí chấm/ })).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Các nhóm bài' });
    expect(within(nav).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '#nhom-task2',
      '#nhom-criteria',
      '#nhom-question-type',
    ]);
    expect(screen.queryByText('Không biết')).toBeNull();
  });

  it('lists a guide in two groups with one URL', () => {
    render(<GuideGroups data={LIST} />);
    const links = screen.getAllByRole('link', { name: 'Mở bài discussion' });
    expect(links).toHaveLength(2);
    expect(new Set(links.map((a) => a.getAttribute('href')))).toEqual(
      new Set(['/library/writing-guides/mo-bai-discussion']),
    );
    expect(screen.getAllByText('4 phút đọc').length).toBe(3);
  });

  it('shows the empty state when no group has a guide', () => {
    render(<GuideGroups data={{ total: 0, groups: LIST.groups.map((g) => ({ ...g, items: [] })) }} />);
    expect(screen.getByTestId('guides-empty').textContent).toContain('Chưa có bài kiến thức nào');
    expect(screen.queryByRole('navigation', { name: 'Các nhóm bài' })).toBeNull();
  });

  it('error offers "Tải lại" and never the empty state', () => {
    render(<GuidesError />);
    const alert = screen.getByRole('alert');
    expect(within(alert).getByRole('link', { name: 'Tải lại' }).getAttribute('href')).toBe('/library/writing-guides');
    expect(screen.queryByTestId('guides-empty')).toBeNull();
  });

  it('skeleton is busy and the count is hidden until known', () => {
    render(
      <>
        <Intro total={null} />
        <GuidesSkeleton />
      </>,
    );
    expect(screen.getByTestId('guides-skeleton').getAttribute('aria-busy')).toBe('true');
    expect(document.body.textContent).toMatch(/Các bài giải thích cách viết Task 1/);
    cleanup();
    render(<Intro total={1284} />);
    expect(document.body.textContent).toMatch(/^1\u00a0284 bài giải thích cách viết/);
  });
});

const GUIDE: GuideDetail = {
  slug: 'mo-bai-discussion',
  title: 'Mở bài discussion',
  groups: [
    { id: 'task2', label: 'Task 2' },
    { id: 'question-type', label: 'Dạng đề' },
  ],
  html:
    '<p>Mở đầu có <a class="sample-cite-link" href="/library/writing-samples/alpha?muc=7.0">Alpha (bản 7.0)</a>.</p>' +
    '<h2 id="de-hoi-gi">Đề hỏi gì</h2><p>Nội dung.</p>' +
    '<figure class="sample-cite"><figcaption>Bài mẫu Writing · Alpha · bản 7.5</figcaption>' +
    '<blockquote lang="en"><p>Quote.</p></blockquote>' +
    '<a class="sample-cite-open" href="/library/writing-samples/alpha?muc=7.5">Mở đề này, bản 7.5</a></figure>',
  toc: [{ id: 'de-hoi-gi', label: 'Đề hỏi gì', n: '1' }],
  reading_minutes: 3,
  updated_at: '2026-11-20T20:00:00+00:00',
  prev: { slug: 'mo-bai-opinion', title: 'Mở bài opinion' },
  next: null,
};

describe('Kiến thức Writing guide (FR-021–FR-023)', () => {
  it('header, contents, groups and the updated date (Vietnam time) from updated_at', () => {
    render(<GuideArticle guide={GUIDE} sampleLive />);
    expect(screen.getByRole('heading', { level: 1, name: 'Mở bài discussion' })).toBeTruthy();
    expect(screen.getByText('Kiến thức Writing · Task 2 · Dạng đề')).toBeTruthy();
    // 20:00Z on 20/11 is 21/11 in Vietnam.
    expect(screen.getByText('Đọc khoảng 3 phút · cập nhật 21/11/2026')).toBeTruthy();
    const toc = screen.getAllByRole('navigation', { name: 'Trong bài này' })[0];
    expect(within(toc).getByRole('link', { name: /Đề hỏi gì/ }).getAttribute('href')).toBe('#de-hoi-gi');
    const member = screen.getByText(/Thuộc nhóm/);
    expect(within(member).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '/library/writing-guides#nhom-task2',
      '/library/writing-guides#nhom-question-type',
    ]);
    expect(member.textContent).toBe('Thuộc nhóm 2 · Task 2 và 4 · Dạng đề');
  });

  it('keeps sample links once the sample page is live', () => {
    render(<GuideArticle guide={GUIDE} sampleLive />);
    const body = screen.getByTestId('guide-body');
    expect(within(body).getByRole('link', { name: 'Alpha (bản 7.0)' }).getAttribute('href')).toBe(
      '/library/writing-samples/alpha?muc=7.0',
    );
    expect(within(body).getByRole('link', { name: 'Mở đề này, bản 7.5' })).toBeTruthy();
  });

  it('never links a citation to a sample page that is not live yet', () => {
    render(<GuideArticle guide={GUIDE} sampleLive={false} />);
    const body = screen.getByTestId('guide-body');
    expect(body.querySelector('a[href^="/library/writing-samples"]')).toBeNull();
    expect(body.textContent).toContain('Alpha (bản 7.0)');
    expect(body.textContent).toContain('Quote.');
    expect(body.textContent).not.toContain('Mở đề này');
  });

  it('one course link, placed before prev/next within the first group', () => {
    const { container } = render(<GuideArticle guide={GUIDE} sampleLive />);
    expect(container.querySelectorAll('[data-course-link]')).toHaveLength(1);
    const pager = screen.getByRole('navigation', { name: 'Bài trong cùng nhóm' });
    const prev = within(pager).getByRole('link');
    expect(prev.getAttribute('href')).toBe('/library/writing-guides/mo-bai-opinion');
    expect(prev.textContent).toContain('Bài trước trong nhóm Task 2');
    const course = container.querySelector('[data-course-link]')!;
    expect(course.compareDocumentPosition(pager) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a missing guide says so and links back to the list', () => {
    render(<GuideMissing />);
    expect(screen.getByRole('heading', { level: 1, name: 'Không có bài kiến thức này' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Xem tất cả bài Kiến thức Writing' }).getAttribute('href')).toBe(
      '/library/writing-guides',
    );
  });
});

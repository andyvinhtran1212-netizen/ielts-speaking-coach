// LIBRARY-0061 T009 (G06-T09; FR-010, FR-011, FR-012): Writing sample list filters and states.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const router = { replace: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

import {
  WritingSamplesBrowser,
  type ListQuery,
  type SampleList,
} from '@/app/(public-library)/library/writing-samples/writing-samples-browser';
import { parseListQuery } from '@/lib/writing-samples-list-model.mjs';

function item(n: number, over: Partial<SampleList['items'][number]> = {}): SampleList['items'][number] {
  return {
    slug: `sample-${n}`,
    title_en: `Sample title ${n}`,
    task: 'task2',
    question_type: 'opinion',
    question_type_label: 'Opinion',
    topic_slug: 'environment',
    prompt_text: `Some people think ${n}. To what extent do you agree or disagree?`,
    ...over,
  };
}

function list(count: number, over: Partial<SampleList> = {}): SampleList {
  return {
    items: Array.from({ length: Math.min(count, 12) }, (_, i) => item(i + 1)),
    total: count,
    page: 1,
    page_size: 12,
    facets: {
      task: { task2: 479, task1: 70 },
      question_type: { opinion: 120, discussion: 90 },
      topic: { environment: 40 },
    },
    topics: [{ slug: 'environment', label_vi: 'Môi trường' }, { slug: 'work', label_vi: 'Công việc' }],
    ...over,
  };
}

const q = (params: Record<string, string> = {}) => parseListQuery(params) as ListQuery;

beforeEach(() => {
  router.replace.mockReset();
  router.refresh.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Writing sample list', () => {
  it('opens a shared link in its state: Task 2, Opinion, "work"', () => {
    render(<WritingSamplesBrowser query={q({ task: 'task2', dang: 'opinion', q: 'work' })} data={list(30)} detailLive={false} />);
    expect((screen.getByRole('radio', { name: /^Task 2/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('radio', { name: /^Opinion/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('searchbox', { name: 'Tìm trong đề' }) as HTMLInputElement).value).toBe('work');
    const chips = screen.getByRole('list', { name: 'Bộ lọc đang bật' });
    expect(within(chips).getByRole('button', { name: 'Bỏ lọc Opinion' })).toBeTruthy();
  });

  it('choosing Task 1 disables the question type group and drops the chosen type', () => {
    render(<WritingSamplesBrowser query={q({ task: 'task2', dang: 'opinion', trang: '2' })} data={list(30, { page: 2 })} detailLive={false} />);
    fireEvent.click(screen.getByRole('radio', { name: /^Task 1/ }));
    expect(router.replace).toHaveBeenCalledWith('/library/writing-samples?task=task1', { scroll: false });
    const group = screen.getByRole('group', { name: 'Dạng đề · Task 2' });
    expect((group as HTMLFieldSetElement).disabled).toBe(true);
    expect((within(group).getByRole('radio', { name: /^Opinion/ }) as HTMLInputElement).checked).toBe(false);
  });

  it('a filter change goes back to page 1', () => {
    render(<WritingSamplesBrowser query={q({ task: 'task2', trang: '3' })} data={list(40, { page: 3 })} detailLive={false} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Chủ đề' }), { target: { value: 'work' } });
    expect(router.replace).toHaveBeenCalledWith('/library/writing-samples?task=task2&chude=work', { scroll: false });
  });

  it('search waits 300 ms after the last keystroke, then replaces the URL once', () => {
    vi.useFakeTimers();
    render(<WritingSamplesBrowser query={q()} data={list(30)} detailLive={false} />);
    const box = screen.getByRole('searchbox', { name: 'Tìm trong đề' });
    fireEvent.change(box, { target: { value: 'wo' } });
    act(() => { vi.advanceTimersByTime(200); });
    fireEvent.change(box, { target: { value: 'work' } });
    act(() => { vi.advanceTimersByTime(299); });
    expect(router.replace).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith('/library/writing-samples?q=work', { scroll: false });
  });

  it('one page: no pagination; more pages: links keep the filters', () => {
    const { unmount } = render(<WritingSamplesBrowser query={q()} data={list(9)} detailLive={false} />);
    expect(screen.queryByRole('navigation', { name: 'Phân trang' })).toBeNull();
    unmount();
    render(<WritingSamplesBrowser query={q({ task: 'task2' })} data={list(30)} detailLive={false} />);
    const nav = screen.getByRole('navigation', { name: 'Phân trang' });
    expect(nav?.textContent ?? '').toContain('Trang 1 trên 3');
    expect(within(nav).getByRole('link', { name: 'Trang sau' }).getAttribute('href')).toBe('/library/writing-samples?task=task2&trang=2');
  });

  it('numbers rows within the filtered result and keeps the full prompt in the markup', () => {
    render(<WritingSamplesBrowser query={q({ trang: '2' })} data={list(30, { page: 2 })} detailLive={false} />);
    const rows = screen.getAllByRole('listitem').filter((li) => li.textContent?.includes('Sample title'));
    expect(rows).toHaveLength(12);
    expect(rows[0]?.textContent ?? '').toMatch(/^13/);
    expect(rows[0]?.textContent ?? '').toContain('Some people think 1. To what extent do you agree or disagree?');
    // The sample page (T010) is not live yet: no row links to a 404.
    expect(within(rows[0]).queryByRole('link')).toBeNull();
  });

  it('rows are whole links once the sample page is live', () => {
    render(<WritingSamplesBrowser query={q()} data={list(3)} detailLive />);
    expect(screen.getByRole('link', { name: /Sample title 1/ }).getAttribute('href')).toBe('/library/writing-samples/sample-1');
  });

  it('no result: keeps the filters, names the search, never "0/0"', () => {
    render(<WritingSamplesBrowser query={q({ task: 'task2', dang: 'positive-negative', q: 'space tourism' })} data={list(0, { items: [] })} detailLive={false} />);
    expect(screen.getByRole('heading', { name: 'Không có đề nào khớp “space tourism” trong dạng Positive or Negative Development' })).toBeTruthy();
    expect((screen.getByRole('searchbox', { name: 'Tìm trong đề' }) as HTMLInputElement).value).toBe('space tourism');
    expect(document.body.textContent).not.toMatch(/0\/0/);
    fireEvent.click(screen.getAllByRole('button', { name: 'Bỏ mọi bộ lọc' })[0]);
    expect(router.replace).toHaveBeenCalledWith('/library/writing-samples', { scroll: false });
  });

  it('a failed read keeps the filters and "Tải lại" asks again for the same query', () => {
    render(<WritingSamplesBrowser query={q({ task: 'task2', dang: 'opinion' })} data={null} detailLive={false} />);
    expect(screen.getByRole('heading', { name: 'Chưa tải được danh sách đề' })).toBeTruthy();
    expect((screen.getByRole('radio', { name: /^Opinion/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại' }));
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
    // No invented counts when nothing was read.
    expect(screen.getByRole('radio', { name: /^Task 2/ }).closest('label')?.textContent ?? '').toMatch(/^Task 2$/);
  });

  it('a topic that no longer exists: the list shows every topic and says why', () => {
    render(<WritingSamplesBrowser query={q({ task: 'task2' })} data={list(30)} notice="topic-gone" detailLive={false} />);
    expect(screen.getByRole('status').textContent).toContain('Chủ đề này không còn');
    expect((screen.getByRole('combobox', { name: 'Chủ đề' }) as HTMLSelectElement).value).toBe('');
    expect(screen.queryByRole('heading', { name: 'Chưa tải được danh sách đề' })).toBeNull();
  });

  it('never shows a stored question-type code', () => {
    render(<WritingSamplesBrowser query={q()} data={list(3)} detailLive={false} />);
    expect(document.body.innerHTML).not.toMatch(/problem_solution|advantages_disadvantages|positive_negative|two_part/);
  });
});

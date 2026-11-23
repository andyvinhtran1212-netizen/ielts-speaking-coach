// LIBRARY-0061 T016 (G06-T16; FR-060, FR-061, scenario 9): the "Của bạn"
// column of the Writing sample list shows the signed-in reader's own marks in
// words, in place of the topic column; guests keep the public list.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const router = { replace: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const auth = vi.hoisted(() => ({ status: 'signed-in' as 'signed-in' | 'signed-out' | 'initial-loading', userId: 'user-a' }));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => ({ status: auth.status, user: { id: auth.userId }, signOut: async () => {} }) }));

import {
  WritingSamplesBrowser,
  type ListQuery,
  type SampleList,
} from '@/app/(public-library)/library/writing-samples/writing-samples-browser';
import { MARKS_LOAD_ERROR } from '@/components/library/use-library-marks';
import { parseListQuery } from '@/lib/writing-samples-list-model.mjs';

const originalApi = window.api;
let getWith: ReturnType<typeof vi.fn>;

const DATA: SampleList = {
  items: ['alpha', 'beta', 'gamma'].map((slug) => ({
    slug,
    title_en: `Title ${slug}`,
    task: 'task2',
    question_type: 'opinion',
    question_type_label: 'Opinion',
    topic_slug: 'environment',
    prompt_text: `Prompt ${slug}`,
  })),
  total: 3,
  page: 1,
  page_size: 12,
  topics: [{ slug: 'environment', label_vi: 'Môi trường' }],
};

const query = parseListQuery({}) as ListQuery;
const flush = () => act(async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); });
const row = (slug: string) => screen.getByText(`Title ${slug}`).closest('li')!;

beforeEach(() => {
  auth.status = 'signed-in';
  auth.userId = 'user-a';
  getWith = vi.fn(async () => ({ marks: [
    { item_key: 'alpha', kind: 'read' },
    { item_key: 'beta', kind: 'saved' },
    { item_key: 'beta', kind: 'read' },
  ] }));
  window.api = { getWith } as unknown as typeof window.api;
});

afterEach(() => {
  cleanup();
  window.api = originalApi;
});

describe('Writing sample list: "Của bạn" column', () => {
  it('signed in: the column replaces "Chủ đề" and names each mark in words', async () => {
    render(<WritingSamplesBrowser query={query} data={DATA} detailLive />);
    await flush();
    expect(getWith).toHaveBeenCalledWith('/api/library/me/marks?shelf=writing_sample', undefined, { noRedirect: true });
    expect(screen.getByText('Của bạn')).toBeTruthy();
    expect(screen.queryByText('Chủ đề', { selector: 'span' })).toBeNull();
    expect(row('alpha').textContent).toContain('Đã đọc');
    expect(row('beta').textContent).toContain('Đã lưu · Đã đọc');
    expect(row('gamma').textContent).not.toMatch(/Đã (đọc|lưu)/);
    expect(row('gamma').textContent).not.toContain('Môi trường');
    // The marks are part of the row link's name, so they are read out too.
    expect(screen.getByRole('link', { name: /Title beta.*Đã lưu · Đã đọc/ })).toBeTruthy();
  });

  it('guest: no request, the topic column stays', async () => {
    auth.status = 'signed-out';
    render(<WritingSamplesBrowser query={query} data={DATA} detailLive={false} />);
    await flush();
    expect(getWith).not.toHaveBeenCalled();
    expect(screen.queryByText('Của bạn')).toBeNull();
    expect(row('alpha').textContent).toContain('Môi trường');
  });

  it('session expired on the server (401): back to the public list, no /login', async () => {
    getWith.mockRejectedValueOnce(Object.assign(new Error('HTTP 401'), { status: 401 }));
    render(<WritingSamplesBrowser query={query} data={DATA} detailLive={false} />);
    await flush();
    expect(screen.queryByText('Của bạn')).toBeNull();
    expect(row('alpha').textContent).toContain('Môi trường');
  });

  it('marks unreadable: says so in words and "Thử lại" reads again', async () => {
    getWith.mockRejectedValueOnce(Object.assign(new Error('HTTP 503'), { status: 503 }));
    render(<WritingSamplesBrowser query={query} data={DATA} detailLive={false} />);
    await flush();
    expect(screen.getByRole('status').textContent).toContain(MARKS_LOAD_ERROR);
    expect(row('alpha').textContent).not.toContain('Đã đọc');
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    await flush();
    expect(getWith).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(MARKS_LOAD_ERROR, { exact: false })).toBeNull();
    expect(row('alpha').textContent).toContain('Đã đọc');
  });
  it('account A to B without a reload: B never sees A\'s marks', async () => {
    const { rerender } = render(<WritingSamplesBrowser query={query} data={DATA} detailLive />);
    await flush();
    expect(row('alpha').textContent).toContain('Đã đọc');
    let answerB!: (v: unknown) => void;
    getWith.mockImplementationOnce(() => new Promise((resolve) => { answerB = resolve; }));
    auth.userId = 'user-b';
    rerender(<WritingSamplesBrowser query={query} data={DATA} detailLive />);
    // While B's marks load, A's are already gone.
    expect(row('alpha').textContent).not.toMatch(/Đã (đọc|lưu)/);
    expect(row('beta').textContent).not.toMatch(/Đã (đọc|lưu)/);
    await act(async () => { answerB({ marks: [{ item_key: 'gamma', kind: 'saved' }] }); });
    await flush();
    expect(getWith).toHaveBeenCalledTimes(2);
    expect(row('alpha').textContent).not.toMatch(/Đã (đọc|lưu)/);
    expect(row('gamma').textContent).toContain('Đã lưu');
  });
});

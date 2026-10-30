import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { InstructorDashboard } from '@/app/(authed-instructor)/instructor/instructor-dashboard';

// PC-J114 (PC-J100 step c): `pending` is React state read from the submit
// handler's closure, so two submits before the next render both passed it and
// the class got two fan-out groups. The synchronous lock lets only one through.
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => ({ status: 'signed-in', user: { id: 'inst-1' } }) }));
vi.mock('@/lib/auth-api', () => ({ getAuthorizationIdentity: async () => ({ id: 'inst-1', role: 'instructor', email: 'teacher@example.com' }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('') }));

const FAN_OUT = '/instructor/assignments/fan-out';
const PREVIEW = '/instructor/assignments/duplicates-preview';

const dashboardData: Record<string, unknown> = {
  '/instructor/cohorts': [{ id: 'c1', name: 'Lớp tối T2', created_at: null }],
  '/instructor/students': [{ id: 's1', full_name: 'Nguyễn An', student_code: 'HV01', cohort_id: 'c1', user_id: 'u1' }],
  '/instructor/prompts': [{ id: 'p1', title: 'Task 2 — Technology', task_type: 'task2' }],
  '/instructor/codes': [],
  '/instructor/assignments': [],
  '/instructor/reviews/queue': [],
};

let get: ReturnType<typeof vi.fn>;
let post: ReturnType<typeof vi.fn>;
beforeEach(() => {
  get = vi.fn(async (path: string) => dashboardData[path]);
  post = vi.fn();
  Object.defineProperty(window, 'api', { configurable: true, value: { get, post, patch: vi.fn() } });
  Object.defineProperty(window, 'WritingRenderers', { configurable: true, value: { SECTION_KEYS: {}, SECTION_RENDERERS: {} } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const fanOutCalls = () => post.mock.calls.filter(([path]) => path === FAN_OUT);

const openClassGiveForm = async () => {
  render(<InstructorDashboard />);
  expect(await screen.findByText('Nguyễn An')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Giao bài' }));
  const form = screen.getByRole('heading', { name: 'Giao một đề bài' }).closest('article')!.querySelector('form')!;
  fireEvent.change(within(form).getByLabelText('Đề bài'), { target: { value: 'p1' } });
  fireEvent.change(within(form).getByLabelText('Lớp'), { target: { value: 'c1' } });
  return form;
};

it('two submits before the next render send one fan-out POST', async () => {
  let finish!: (value: unknown) => void;
  post.mockImplementation((path: string) => {
    if (path === PREVIEW) return Promise.resolve({ student_count: 1, duplicate_student_ids: [] });
    if (path === FAN_OUT) return new Promise((resolve) => { finish = resolve; });
    throw new Error(`unexpected POST ${path}`);
  });
  const form = await openClassGiveForm();

  fireEvent.submit(form);
  fireEvent.submit(form);
  await waitFor(() => expect(fanOutCalls()).toHaveLength(1));
  // A third submit while the POST is in flight is refused too.
  fireEvent.submit(form);
  finish({ student_count: 1, created_count: 1, duplicates_warning: [] });
  expect(await screen.findByText('Đã giao bài cho lớp.')).toBeTruthy();
  expect(fanOutCalls()).toHaveLength(1);
  expect(post.mock.calls.filter(([path]) => path === PREVIEW)).toHaveLength(1);
});

it('a failed give releases the lock so the next submit is sent', async () => {
  let attempt = 0;
  post.mockImplementation(async (path: string) => {
    if (path === PREVIEW) return { student_count: 1, duplicate_student_ids: [] };
    if (path === FAN_OUT) {
      attempt += 1;
      if (attempt === 1) throw Object.assign(new Error('Lỗi máy chủ.'), { status: 500 });
      return { student_count: 1, created_count: 1, duplicates_warning: [] };
    }
    throw new Error(`unexpected POST ${path}`);
  });
  const form = await openClassGiveForm();

  fireEvent.submit(form);
  expect(await screen.findByText(/Lỗi máy chủ\./)).toBeTruthy();
  expect(fanOutCalls()).toHaveLength(1);

  fireEvent.submit(form);
  expect(await screen.findByText('Đã giao bài cho lớp.')).toBeTruthy();
  expect(fanOutCalls()).toHaveLength(2);
});

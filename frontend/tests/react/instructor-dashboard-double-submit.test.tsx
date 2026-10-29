import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { flushSync } from 'react-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { InstructorDashboard } from '@/app/(authed-instructor)/instructor/instructor-dashboard';

// PC-J114 (PC-J100 step c): `pending` is React state read from the submit
// handler's closure, so two submits before the next render both passed it and
// the class got two fan-out groups. The synchronous lock lets only one through.
const auth = vi.hoisted(() => ({ status: 'signed-in', user: { id: 'inst-1' } }));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => auth }));
vi.mock('@/lib/auth-api', () => ({ getAuthorizationIdentity: async () => ({ id: auth.user.id, role: 'instructor', email: 'teacher@example.com' }) }));
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
  auth.user = { id: 'inst-1' };
  get = vi.fn(async (path: string) => dashboardData[path]);
  post = vi.fn();
  Object.defineProperty(window, 'api', { configurable: true, value: { get, post, patch: vi.fn() } });
  Object.defineProperty(window, 'WritingRenderers', { configurable: true, value: { SECTION_KEYS: {}, SECTION_RENDERERS: {} } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const fanOutCalls = () => post.mock.calls.filter(([path]) => path === FAN_OUT);

const openGiveForm = async (target: 'cohort' | 'student' = 'cohort') => {
  const view = render(<InstructorDashboard />);
  expect(await screen.findByText('Nguyễn An')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Giao bài' }));
  const form = screen.getByRole('heading', { name: 'Giao một đề bài' }).closest('article')!.querySelector('form')!;
  fireEvent.change(within(form).getByLabelText('Đề bài'), { target: { value: 'p1' } });
  if (target === 'cohort') {
    fireEvent.change(within(form).getByLabelText('Lớp'), { target: { value: 'c1' } });
  } else {
    fireEvent.click(within(form).getByRole('radio', { name: 'Học viên lẻ' }));
    fireEvent.change(within(form).getByLabelText('Học viên lẻ', { selector: 'select' }), { target: { value: 's1' } });
  }
  return { ...view, form };
};

it('two submits before the next render send one fan-out POST', async () => {
  let finish!: (value: unknown) => void;
  post.mockImplementation((path: string) => {
    if (path === PREVIEW) return Promise.resolve({ student_count: 1, duplicate_student_ids: [] });
    if (path === FAN_OUT) return new Promise((resolve) => { finish = resolve; });
    throw new Error(`unexpected POST ${path}`);
  });
  const { form } = await openGiveForm();

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
  const { form } = await openGiveForm();

  fireEvent.submit(form);
  expect(await screen.findByText(/Lỗi máy chủ\./)).toBeTruthy();
  expect(fanOutCalls()).toHaveLength(1);

  fireEvent.submit(form);
  expect(await screen.findByText('Đã giao bài cho lớp.')).toBeTruthy();
  expect(fanOutCalls()).toHaveLength(2);
});

const seedExistingGive = () => {
  get.mockImplementation(async (path: string) => path === '/instructor/assignments'
    ? [{ id: 'a1', prompt_id: 'p1', student_id: 's1', cohort_id: 'c1', status: 'pending' }]
    : dashboardData[path]);
};

it.each(['cohort', 'student'] as const)('%s confirmation still sends one give and keeps mutations disabled through completion', async (target) => {
  seedExistingGive();
  let finish!: (value: unknown) => void;
  post.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const { form } = await openGiveForm(target);
  fireEvent.submit(form);
  fireEvent.submit(form);
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Giao thêm' }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  expect(post.mock.calls[0][0]).toBe(target === 'cohort' ? FAN_OUT : '/instructor/assignments');
  const create = screen.getByRole('button', { name: 'Tạo đề bài' }) as HTMLButtonElement;
  expect(create.disabled).toBe(true);
  fireEvent.submit(form);
  finish({ student_count: 1, created_count: 1, duplicates_warning: [] });
  expect(await screen.findByText(target === 'cohort' ? 'Đã giao bài cho lớp.' : 'Đã giao bài cho học viên.')).toBeTruthy();
  expect(create.disabled).toBe(false);
  expect(post).toHaveBeenCalledTimes(1);
});

it.each(['cohort', 'student'] as const)('%s confirmation disables other mutations and cancellation releases them', async (target) => {
  seedExistingGive();
  const { form } = await openGiveForm(target);
  fireEvent.submit(form);
  const dialog = await screen.findByRole('dialog');
  const promptForm = screen.getByRole('heading', { name: 'Tạo đề bài nhanh' }).closest('article')!.querySelector('form')!;
  fireEvent.change(within(promptForm).getByLabelText('Tiêu đề'), { target: { value: 'New prompt' } });
  fireEvent.change(within(promptForm).getByLabelText('Đề bài'), { target: { value: 'Discuss technology.' } });
  const create = within(promptForm).getByRole('button', { name: 'Tạo đề bài' }) as HTMLButtonElement;
  const refresh = screen.getByRole('button', { name: 'Làm mới' }) as HTMLButtonElement;

  expect(create.disabled).toBe(true);
  expect(refresh.disabled).toBe(true);
  const reads = get.mock.calls.length;
  fireEvent.click(refresh);
  expect(get.mock.calls).toHaveLength(reads);
  fireEvent.click(create);
  expect(post).not.toHaveBeenCalled();

  fireEvent.click(within(dialog).getByRole('button', { name: 'Hủy' }));
  await waitFor(() => expect(create.disabled).toBe(false));
  expect(refresh.disabled).toBe(false);
  fireEvent.click(create);
  expect(await screen.findByText('Đã tạo đề bài.')).toBeTruthy();
  expect(post).toHaveBeenCalledTimes(1);
  expect(post.mock.calls[0][0]).toBe('/instructor/prompts');
});

it.each(['cohort', 'student'] as const)('%s confirmation closes on account change and its old button cannot send', async (target) => {
  seedExistingGive();
  const { form, rerender } = await openGiveForm(target);
  fireEvent.submit(form);
  const dialog = await screen.findByRole('dialog');
  const confirm = within(dialog).getByRole('button', { name: 'Giao thêm' });

  auth.user = { id: 'inst-2' };
  rerender(<InstructorDashboard />);
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(confirm);
  expect(await screen.findByText('Nguyễn An')).toBeTruthy();
  expect(post).not.toHaveBeenCalled();
});

it.each(['cohort', 'student'] as const)('%s give does not send if the account changes before the confirmed continuation', async (target) => {
  seedExistingGive();
  const { form, rerender } = await openGiveForm(target);
  fireEvent.submit(form);
  const dialog = await screen.findByRole('dialog');

  // Resolve the dialog, then commit the account change before submitGive resumes.
  // Closing an open dialog in the auth effect alone cannot guard this race.
  await act(async () => {
    fireEvent.click(within(dialog).getByRole('button', { name: 'Giao thêm' }));
    auth.user = { id: 'inst-2' };
    flushSync(() => rerender(<InstructorDashboard />));
  });

  expect(screen.queryByRole('dialog')).toBeNull();
  expect(await screen.findByText('Nguyễn An')).toBeTruthy();
  expect(post).not.toHaveBeenCalled();
});

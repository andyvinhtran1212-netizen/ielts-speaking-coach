import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AdminClassHomework } from '@/app/(authed-admin-classes)/admin/classes/[cohortId]/admin-class-homework';

afterEach(cleanup);

it('clears a timer on bank changes and disables it for hybrid Course content', async () => {
  const post = vi.fn();
  const get = vi.fn(async (path: string) => {
    if (path.endsWith('/assignments')) return { assignments: [], reconcile_failed: false };
    if (path.endsWith('/course-banks')) return { items: [
      { id: 'midterm', title: 'Midterm', ready: true, single_attempt_ready: true },
      { id: 'b12', title: 'Buổi 12', ready: true, single_attempt_ready: false },
    ] };
    if (path.includes('/speaking-topics')) return { items: [] };
    throw new Error(path);
  });
  Object.defineProperty(window, 'api', { configurable: true, value: { get, post } });
  render(<AdminClassHomework cohortId="class-1" members={[]} refreshKey={0} onMutation={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Giao bài lớp' }));
  fireEvent.change(screen.getByLabelText('Kỹ năng'), { target: { value: 'course' } });
  await screen.findByRole('option', { name: 'Midterm' });
  fireEvent.change(screen.getByLabelText('Bộ bài tập'), { target: { value: 'midterm' } });
  const timer = screen.getByLabelText(/Thời gian tối đa/) as HTMLInputElement;
  expect(timer.disabled).toBe(false);
  fireEvent.change(timer, { target: { value: '75' } });
  expect(timer.value).toBe('75');
  fireEvent.change(screen.getByLabelText('Bộ bài tập'), { target: { value: 'b12' } });
  await waitFor(() => expect(timer.disabled).toBe(true));
  expect(timer.value).toBe('');
  expect(screen.getByText('Giới hạn thời gian chỉ áp dụng cho bộ trắc nghiệm thuần.')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Bộ bài tập'), { target: { value: 'midterm' } });
  expect(timer.disabled).toBe(false);
  expect(timer.value).toBe('');
  expect(post).not.toHaveBeenCalled();
});

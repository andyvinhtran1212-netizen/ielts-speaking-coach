import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { AdminWritingRegradeRequests } from '@/app/(authed-admin-writing-regrade)/admin/writing/regrade-requests/admin-writing-regrade-requests';

// G09-T39 (ADMINIA-0074 FR-062): three decisions, a 40-character explanation
// for "Giữ nguyên điểm", the no-deduct line, overdue against regrade_hours and
// "Chấm lại bằng AI" = accept, then the existing admin regrade route.

const params = vi.hoisted(() => ({ value: new URLSearchParams() }));
const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  useSearchParams: () => params.value,
  useRouter: () => ({ replace: vi.fn(), push }),
}));
vi.mock('@/components/admin-access-gate', () => ({ useAdminProfile: () => ({ id: 'admin-1' }) }));
afterEach(() => { cleanup(); push.mockReset(); });

const REQ = '00000000-0000-4000-8000-0000000000b1';
const ESSAY = '00000000-0000-4000-8000-0000000000e1';
const sent = new Date(Date.now() - 50 * 3_600_000).toISOString();
const row = (status: string, extra: Record<string, unknown> = {}) => ({
  id: REQ, essay_id: ESSAY, status, reason: 'Mình nghĩ bài đã bàn đủ hai quan điểm.\nNhờ giáo viên xem lại.',
  student_name: 'Như', student_code: 'S01', cohort_name: 'Lớp Tue–Thu', essay_task_type: 'task2',
  essay_prompt: 'Cities and green spaces', essay_status: 'delivered', essay_band: 5.5,
  admin_response: null, created_at: sent, updated_at: sent, actioned_at: null, fulfilled_at: null, ...extra,
});

function mount(initial: string, after?: string, hours: number | null = 48) {
  let current = initial;
  const get = vi.fn(async (path: string) => {
    if (path === '/admin/writing/regrade-requests') return { requests: [row(current)], capped: false, regrade_hours: hours, thresholds_failed: hours === null };
    if (path === `/admin/writing/regrade-requests/${REQ}`) return row(current);
    throw new Error(`Unexpected read: ${path}`);
  });
  const patch = vi.fn(async (_path: string, body: { action: string; response: string | null }) => {
    current = after || (body.action === 'reject' ? 'rejected' : 'accepted');
    return row(current, body.response ? { admin_response: body.response } : {});
  });
  const post = vi.fn(async () => ({ status: 'grading' }));
  Object.defineProperty(window, 'api', { configurable: true, value: { get, patch, post } });
  render(<AdminWritingRegradeRequests />);
  return { get, patch, post };
}

const openRequest = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Xử lý' }));
  await waitFor(() => expect((screen.getByLabelText(/Giữ nguyên điểm/) as HTMLInputElement).disabled).toBe(false));
};

it('marks a request waiting past regrade_hours as overdue and keeps the reason verbatim', async () => {
  mount('pending');
  expect(await screen.findByText('Đã chờ 2 ngày · quá hạn')).toBeTruthy();
  expect(screen.getByText(/Nhờ giáo viên xem lại\./).textContent).toContain('\n');
});

it('says the threshold is unknown instead of marking nothing overdue', async () => {
  mount('pending', undefined, null);
  expect(await screen.findByText('Chưa đọc được ngưỡng')).toBeTruthy();
  expect(screen.getByText('Đã chờ 2 ngày')).toBeTruthy();
});

it('"Giữ nguyên điểm" stays disabled under 40 characters and sends a reject with the explanation', async () => {
  const { patch } = mount('pending');
  await openRequest();
  expect(screen.getByText(/Không trừ lượt chấm AI của học viên\./, { selector: 'strong' })).toBeTruthy();
  fireEvent.click(screen.getByLabelText(/Giữ nguyên điểm/));
  const send = screen.getByRole('button', { name: 'Gửi giải thích, giữ nguyên điểm' }) as HTMLButtonElement;
  fireEvent.change(screen.getByRole('textbox', { name: /Giải thích gửi học viên/ }), { target: { value: 'Quá ngắn.' } });
  expect(send.disabled).toBe(true);
  const explanation = 'Bài nêu đủ hai mặt nhưng phần lợi ích chưa có ví dụ cụ thể.';
  fireEvent.change(screen.getByRole('textbox', { name: /Giải thích gửi học viên/ }), { target: { value: explanation } });
  expect(send.disabled).toBe(false);
  fireEvent.click(send);
  await screen.findByText(/điểm giữ nguyên/);
  expect(patch).toHaveBeenCalledWith(`/admin/writing/regrade-requests/${REQ}`, { action: 'reject', response: explanation });
  // Answered: read-only, no decisions left.
  expect(screen.queryByLabelText(/Điều chỉnh điểm/)).toBeNull();
});

it('"Chấm lại bằng AI" warns about cost, accepts, then queues the existing regrade route', async () => {
  const { patch, post } = mount('pending');
  await openRequest();
  fireEvent.click(screen.getByLabelText(/Chấm lại bằng AI/));
  expect(screen.getByText('Cảnh báo · tốn chi phí AI')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Chấm lại bằng AI, chấp nhận chi phí' }));
  await screen.findByText(/gửi bài cho AI chấm lại/);
  expect(patch).toHaveBeenCalledWith(`/admin/writing/regrade-requests/${REQ}`, { action: 'accept', response: null });
  expect(post).toHaveBeenCalledWith(`/admin/writing/essays/${ESSAY}/regrade`, {});
  expect(screen.getByRole('link', { name: 'Mở màn chấm' })).toBeTruthy();
});

it('shows an AI queue failure after the accept instead of hiding it', async () => {
  const { post } = mount('pending');
  post.mockRejectedValueOnce(new Error('Đã đạt tối đa 3 version'));
  await openRequest();
  fireEvent.click(screen.getByLabelText(/Chấm lại bằng AI/));
  fireEvent.click(screen.getByRole('button', { name: 'Chấm lại bằng AI, chấp nhận chi phí' }));
  expect(await screen.findByText(/Đã nhận yêu cầu nhưng chưa gửi được bài cho AI: Đã đạt tối đa 3 version/)).toBeTruthy();
});

it('"Điều chỉnh điểm" accepts and opens the grading screen', async () => {
  const { patch } = mount('pending');
  await openRequest();
  fireEvent.click(screen.getByLabelText(/Điều chỉnh điểm/));
  fireEvent.click(screen.getByRole('button', { name: 'Nhận yêu cầu và mở màn chấm' }));
  await waitFor(() => expect(push).toHaveBeenCalledWith(`/admin/writing/grade?essay_id=${ESSAY}`));
  expect(patch).toHaveBeenCalledWith(`/admin/writing/regrade-requests/${REQ}`, { action: 'accept', response: null });
});

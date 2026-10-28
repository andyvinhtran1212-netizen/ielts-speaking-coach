import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdminMockReviews } from '@/app/(authed-admin-mock-reviews)/admin/mock-reviews/admin-mock-reviews';

vi.mock('@/components/admin-access-gate', () => ({ useAdminProfile: () => ({ id: 'admin-a' }) }));

// PC-J28: the red "Backend không xác nhận cờ test lại vừa chọn." banner must only
// mean the backend really did not keep the flag — never a superseded/failed
// readback, never an unticked skill being absent — and "↻ Tải lại" clears it.
const REFUSED = 'Backend không xác nhận cờ test lại vừa chọn.';
const EXAM = 'exam-a';
const rosterRow = (flags: Record<string, boolean>) => ({
  sitting_id: 'sitting-a', review_id: 'review-a', student_name: 'E2E student mock0016', sitting_status: 'submitted',
  listening: { score: 30, max: 40, band: 7 }, reading: { score: 28, max: 40, band: 6.5 },
  writing: { task1_wc: 160, task2_wc: 260, task1_essay_id: null, task2_essay_id: null, band: null, band_is_final: false },
  speaking: { count: 0, band: null, band_is_final: false },
  review_status: 'claimed', claimed: true, needs_retest: false, retest_flags: flags,
});
const summary = (reading: number) => ({ total_sittings: 1, reviewed_sittings: 0, needs_retest_count: reading, per_skill: { listening: 0, reading, writing: 0, speaking: 0 }, students: [] });

let stored: Record<string, boolean>;
let rosterFails: boolean;
let get: ReturnType<typeof vi.fn>;
let post: ReturnType<typeof vi.fn>;
beforeEach(() => {
  stored = {}; rosterFails = false;
  get = vi.fn(async (path: string) => {
    if (path === '/admin/mock-exams') return { exams: [] };
    if (path.endsWith('/roster')) {
      if (rosterFails) throw Object.assign(new Error('Gateway timeout'), { status: 504 });
      return { roster: [rosterRow(stored)] };
    }
    if (path.endsWith('/retest-summary')) return summary(stored.reading ? 1 : 0);
    throw new Error(`unexpected GET ${path}`);
  });
  // Mirrors set_retest_flags_for_sitting: keeps only the exam's skills (here
  // Speaking is not part of the exam) and returns the updated review row.
  post = vi.fn(async (_path: string, body: { retest_flags: Record<string, boolean> }) => {
    stored = Object.fromEntries(Object.entries(body.retest_flags).filter(([skill]) => skill !== 'speaking'));
    return { id: 'review-a', sitting_id: 'sitting-a', status: 'claimed', retest_flags: stored };
  });
  Object.defineProperty(window, 'api', { configurable: true, value: { get, post } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const checkbox = async (letter: string) => await screen.findByRole('checkbox', { name: letter }) as HTMLInputElement;

it('confirms a saved Reading flag from the canonical roster without the refusal banner', async () => {
  render(<AdminMockReviews examId={EXAM} embedded={false} />);
  fireEvent.click(await checkbox('R'));
  expect(await screen.findByText('Đã đánh dấu Reading cần test lại.')).toBeTruthy();
  expect(screen.queryByText(REFUSED)).toBeNull();
  expect(post).toHaveBeenCalledTimes(1);
  expect(post.mock.calls[0][1]).toEqual({ retest_flags: { listening: false, reading: true, writing: false, speaking: false } });
  await waitFor(async () => expect((await checkbox('R')).checked).toBe(true));
});

it('confirms clearing a flag even though the roster omits unticked skills', async () => {
  stored = { reading: true };
  render(<AdminMockReviews examId={EXAM} embedded={false} />);
  await waitFor(async () => expect((await checkbox('R')).checked).toBe(true));
  fireEvent.click(await checkbox('R'));
  expect(await screen.findByText('Đã bỏ đánh dấu Reading.')).toBeTruthy();
  expect(screen.queryByText(REFUSED)).toBeNull();
});

it('falls back to the backend write ACK when the roster readback cannot be read', async () => {
  render(<AdminMockReviews examId={EXAM} embedded={false} />);
  const reading = await checkbox('R');
  rosterFails = true;
  fireEvent.click(reading);
  expect(await screen.findByText('Đã đánh dấu Reading cần test lại.')).toBeTruthy();
  expect(screen.queryByText(REFUSED)).toBeNull();
  expect(await screen.findByText(/Không tải được bảng lớp: Gateway timeout/)).toBeTruthy();
  expect(post).toHaveBeenCalledTimes(1);
});

it('shows the refusal banner when the backend drops the flag, and Tải lại clears it', async () => {
  render(<AdminMockReviews examId={EXAM} embedded={false} />);
  fireEvent.click(await checkbox('S'));
  expect((await screen.findByRole('alert')).textContent).toBe(REFUSED);
  expect((await checkbox('S')).checked).toBe(false);
  const rosterReads = get.mock.calls.filter(([path]) => path.endsWith('/roster')).length;
  fireEvent.click(screen.getByRole('button', { name: '↻ Tải lại' }));
  await waitFor(() => expect(screen.queryByText(REFUSED)).toBeNull());
  await waitFor(() => expect(get.mock.calls.filter(([path]) => path.endsWith('/roster')).length).toBe(rosterReads + 1));
  expect(post).toHaveBeenCalledTimes(1);
});

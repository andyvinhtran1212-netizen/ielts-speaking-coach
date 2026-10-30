import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdminMockReviews } from '@/app/(authed-admin-mock-reviews)/admin/mock-reviews/admin-mock-reviews';

vi.mock('@/components/admin-access-gate', () => ({ useAdminProfile: () => ({ id: 'admin-a' }) }));

// PC-J146: a Reading-only retake sitting offered L/W/S boxes; ticking L was
// dropped behind a 200, so the console showed the generic refusal banner and the
// box un-ticked itself. The roster now names the tickable skills and the backend
// refuses the rest with 422 skill_not_in_sitting.
const GENERIC = 'Backend không xác nhận cờ test lại vừa chọn.';
const NOT_IN_SITTING = 'Kỹ năng Listening không thuộc lượt thi này.';
const rosterRow = (flags: Record<string, boolean>, retestSkills?: string[]) => ({
  sitting_id: 'sitting-a', review_id: 'review-a', student_name: 'E2E retake reading', sitting_status: 'submitted',
  listening: { score: null, max: null, band: null }, reading: { score: 28, max: 40, band: 6.5 },
  writing: { task1_wc: null, task2_wc: null, task1_essay_id: null, task2_essay_id: null, band: null, band_is_final: false },
  speaking: { count: 0, band: null, band_is_final: false },
  review_status: 'claimed', claimed: true, needs_retest: false, retest_flags: flags,
  ...(retestSkills ? { retest_skills: retestSkills } : {}),
});
const summary = () => ({ total_sittings: 1, reviewed_sittings: 0, needs_retest_count: 0, per_skill: { listening: 0, reading: 0, writing: 0, speaking: 0 }, students: [] });

let stored: Record<string, boolean>;
let retestSkills: string[] | undefined;
let post: ReturnType<typeof vi.fn>;
beforeEach(() => {
  stored = {}; retestSkills = ['reading'];
  const get = vi.fn(async (path: string) => {
    if (path === '/admin/mock-exams') return { exams: [] };
    if (path.endsWith('/roster')) return { roster: [rosterRow(stored, retestSkills)] };
    if (path.endsWith('/retest-summary')) return summary();
    throw new Error(`unexpected GET ${path}`);
  });
  // Mirrors set_retest_flags_for_sitting after PC-J146: a true flag outside the
  // sitting is a 422 that writes nothing; a false one is ignored.
  post = vi.fn(async (_path: string, body: { retest_flags: Record<string, boolean> }) => {
    const allowed = retestSkills ?? ['listening', 'reading', 'writing', 'speaking'];
    const refused = Object.entries(body.retest_flags).filter(([skill, value]) => value && !allowed.includes(skill)).map(([skill]) => skill);
    if (refused.length) throw Object.assign(new Error(NOT_IN_SITTING), { status: 422, detail: { error: 'skill_not_in_sitting', skills: refused, message: NOT_IN_SITTING } });
    stored = Object.fromEntries(Object.entries(body.retest_flags).filter(([skill, value]) => value && allowed.includes(skill)));
    return { id: 'review-a', sitting_id: 'sitting-a', status: 'claimed', retest_flags: stored };
  });
  Object.defineProperty(window, 'api', { configurable: true, value: { get, post } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('disables the boxes of skills outside a Reading-only sitting and still saves Reading', async () => {
  render(<AdminMockReviews examId="exam-a" embedded={false} />);
  for (const label of ['Listening', 'Writing', 'Speaking']) {
    const box = await screen.findByRole('checkbox', { name: `${label}: Không thuộc lượt thi này` }) as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(box.closest('label')?.getAttribute('title')).toBe('Không thuộc lượt thi này');
  }
  const reading = await screen.findByRole('checkbox', { name: 'R' }) as HTMLInputElement;
  expect(reading.disabled).toBe(false);
  fireEvent.click(reading);
  expect(await screen.findByText('Đã đánh dấu Reading cần test lại.')).toBeTruthy();
  expect(post.mock.calls[0][1]).toEqual({ retest_flags: { listening: false, reading: true, writing: false, speaking: false } });
});

it('shows the server message for a 422 skill_not_in_sitting instead of the generic banner', async () => {
  // An older roster (no retest_skills) keeps every box enabled, so the stale
  // tick still reaches the backend — whose refusal is shown verbatim.
  retestSkills = undefined;
  render(<AdminMockReviews examId="exam-a" embedded={false} />);
  const listening = await screen.findByRole('checkbox', { name: 'L' }) as HTMLInputElement;
  expect(listening.disabled).toBe(false);
  retestSkills = ['reading'];
  fireEvent.click(listening);
  expect((await screen.findByRole('alert')).textContent).toBe(NOT_IN_SITTING);
  expect(screen.queryByText(GENERIC)).toBeNull();
  expect(stored).toEqual({});
  await waitFor(async () => expect((await screen.findByRole('checkbox', { name: 'Listening: Không thuộc lượt thi này' }) as HTMLInputElement).disabled).toBe(true));
});

it('keeps the readback notice for any other failure', async () => {
  render(<AdminMockReviews examId="exam-a" embedded={false} />);
  const reading = await screen.findByRole('checkbox', { name: 'R' });
  post.mockRejectedValueOnce(Object.assign(new Error('Gateway timeout'), { status: 504 }));
  fireEvent.click(reading);
  expect((await screen.findByRole('alert')).textContent).toBe('Không cập nhật được: Gateway timeout Bảng đã được đọc lại từ backend.');
});

it('lets a stale true flag on an ineligible skill be unticked', async () => {
  stored = { listening: true };
  render(<AdminMockReviews examId="exam-a" embedded={false} />);
  const listening = await screen.findByRole('checkbox', { name: 'Listening: Không thuộc lượt thi này' }) as HTMLInputElement;
  expect(listening.checked).toBe(true);
  expect(listening.disabled).toBe(false);
  fireEvent.click(listening);
  expect(await screen.findByText('Đã bỏ đánh dấu Listening.')).toBeTruthy();
});

it('does not re-send a stale ineligible true flag when ticking an eligible skill', async () => {
  stored = { listening: true };
  render(<AdminMockReviews examId="exam-a" embedded={false} />);
  fireEvent.click(await screen.findByRole('checkbox', { name: 'R' }));
  expect(await screen.findByText('Đã đánh dấu Reading cần test lại.')).toBeTruthy();
  expect(post.mock.calls[0][1]).toEqual({ retest_flags: { listening: false, reading: true, writing: false, speaking: false } });
});

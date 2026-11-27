import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProgrammeResult } from '@/app/(authed-listening-review)/listening/programmes/result/[attemptId]/programme-result';
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => ({ status: 'signed-in', user: { id: 'count-learner' } }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/when-global-ready.mjs', () => ({ whenGlobalReady: async () => true }));

// G02-T06 (FR-02-005): the result never shows a count of nothing ("0/0").
const unscored = (q: number) => ({ q_num: q, state: 'unscored', prompt: `Self-review ${q}`, expected: 'ref' });
const result = (summary: Record<string, number>, review: Array<Record<string, unknown>>) => async () => ({
  programme_id: 'ielts-80-days-listening', scoring_policy: 'report_only', title: 'Count result', result_summary: summary, review });

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}); vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  Object.assign(window, { api: { getWith: vi.fn(), postWith: vi.fn(), patchWith: vi.fn(async () => ({})) } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('says the lesson is self-review instead of 0/0 when no item was checked', async () => {
  window.api.getWith = vi.fn(result({ checked_count: 0, correct_count: 0, unscored_count: 2, item_count: 2, completion_count: 2 }, [unscored(1), unscored(2)]));
  render(<ProgrammeResult attemptId="self-review" />);
  await screen.findByRole('heading', { name: 'Count result' });
  expect(screen.getByText('Bài này để bạn tự đối chiếu, không chấm đúng/sai tự động.')).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Tóm tắt kết quả' }).textContent).not.toContain('0/0');
  expect(document.body.textContent).not.toContain('0/0');
});

it('drops the checked box when nothing was checked but not every item is self-review', async () => {
  window.api.getWith = vi.fn(result({ blank_count: 1, unscored_count: 1, item_count: 2 }, [unscored(1), { q_num: 2, state: 'blank', prompt: 'Left blank', expected: 'B' }]));
  render(<ProgrammeResult attemptId="mixed" />);
  await screen.findByRole('heading', { name: 'Count result' });
  expect(screen.queryByText('Câu được kiểm tra đúng')).toBeNull();
  expect(screen.queryByText(/Bài này để bạn tự đối chiếu/)).toBeNull();
  expect(document.body.textContent).not.toContain('0/0');
});

it('keeps the correct/checked count when items were checked, and hides an empty completion count', async () => {
  window.api.getWith = vi.fn(result({ checked_count: 4, correct_count: 3, item_count: 4, completion_count: 4 }, []));
  render(<ProgrammeResult attemptId="checked" />);
  await screen.findByRole('heading', { name: 'Count result' });
  expect(screen.getByText('3/4')).toBeTruthy();
  expect(screen.getByText('Câu được kiểm tra đúng')).toBeTruthy();
  window.api.getWith = vi.fn(result({}, []));
  cleanup(); render(<ProgrammeResult attemptId="empty" />);
  await screen.findByRole('heading', { name: 'Count result' });
  expect(document.body.textContent).not.toMatch(/Hoàn thành 0\/0/);
  expect(document.body.textContent).not.toContain('0/0');
});

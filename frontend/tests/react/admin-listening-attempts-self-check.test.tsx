import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => navigation,
  useSearchParams: () => new URLSearchParams('attempt=a1'),
}));
vi.mock('@/components/admin-access-gate', () => ({ useAdminProfile: () => ({ id: 'admin-1' }) }));

import { AdminListeningAttempts } from '@/app/(authed-admin-listening)/admin/listening/attempts/admin-listening-attempts';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it.each([false, true])('renders self-check evidence in list and detail, mixed=%s, including reload', async (mixed) => {
  const row = { id: 'a1', status: 'submitted', scoring_policy: 'diagnostic',
    score: mixed ? 1 : 0, total_questions: mixed ? 1 : 0, accuracy: mixed ? 1 : null,
    user: { id: 'u1', display_name: 'Learner' },
    test: { id: 't1', title: 'Self-check test', test_type: 'mini' } };
  const lookup = { association_lookup_failed: false, association_lookup_failures: [] };
  const detail = { ...row, ...lookup, band_estimate: null, grading_details: [
    { q_num: 1, self_check: true, correct: null, user_answer: 'My words', expected: 'Reference answer' },
    ...(mixed ? [{ q_num: 2, correct: true, user_answer: 'A', expected: 'A' }] : []),
  ] };
  const get = vi.fn(async (path: string) => path.includes('/attempts/a1') ? detail
    : { items: [row], total: 1, limit: 50, offset: 0, ...lookup });
  Object.defineProperty(window, 'api', { configurable: true, value: { get } });
  for (let load = 0; load < 2; load += 1) {
    const view = render(<AdminListeningAttempts />);
    const table = await screen.findByRole('region', { name: 'Bảng lượt làm bài Listening' });
    await waitFor(() => expect(within(table).getByText(mixed ? '1/1' : 'Tự đối chiếu')).toBeTruthy());
    const questions = await screen.findByRole('region', { name: 'Đáp án từng câu' });
    expect(within(questions).getByText('My words')).toBeTruthy();
    expect(within(questions).getByText('Reference answer')).toBeTruthy();
    const neutral = within(questions).getByLabelText('Tự đối chiếu').closest('tr')!;
    expect(neutral.className).toBe('');
    expect(questions.querySelectorAll('tbody tr')).toHaveLength(mixed ? 2 : 1);
    expect(screen.queryByText('0/0')).toBeNull();
    expect(screen.queryByText('0%')).toBeNull();
    expect(screen.queryByText('Chi tiết cần kiểm tra')).toBeNull();
    view.unmount();
  }
  expect(get).toHaveBeenCalledTimes(4);
});

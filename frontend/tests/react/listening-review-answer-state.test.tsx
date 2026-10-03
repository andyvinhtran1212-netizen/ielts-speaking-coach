import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { ListeningReviewWorkspace } from '@/app/(authed-listening-review)/listening/review/listening-review-workspace';

vi.mock('@/lib/auth/auth-provider', () => ({
  useAuth: () => ({ status: 'signed-in', user: { id: 'review-owner' } }),
}));

let getWith: ReturnType<typeof vi.fn>;
const response = (blank: unknown = '', preview = false) => ({
  attempt_id: preview ? null : 'answer-state-attempt',
  test_id: 'ILR-LIS-CAM-B13-T3',
  title: 'Listening review answer states',
  status: 'submitted', preview, score: preview ? null : 1, max_score: 3,
  band_estimate: null, audio_url: '', audio_duration: 0,
  sections: [{ section_num: 3, transcript: '', title: 'Part 3' }],
  review: [
    { q_num: 27, correct: false, user_answer: blank, expected: 'B', section: '3' },
    { q_num: 28, correct: false, user_answer: 'A', expected: 'B', section: '3' },
    { q_num: 29, correct: true, user_answer: 'C', expected: 'C', section: '3' },
  ],
});

beforeEach(() => {
  window.history.replaceState(null, '', '/listening/review?attempt_id=answer-state-attempt');
  getWith = vi.fn();
  Object.defineProperty(window, 'api', { configurable: true, value: { getWith } });
  Object.defineProperty(window, 'AverFeedback', { configurable: true, value: {
    attachCardFlag: vi.fn(), mountSurvey: vi.fn(),
  } });
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/');
});

it.each(['', null, undefined, ' \n '])('labels an unanswered submitted item without changing its false canonical grade: %s', async (blank) => {
  const raw = response(blank);
  const before = JSON.stringify(raw);
  getWith.mockResolvedValue(raw);
  const view = render(<ListeningReviewWorkspace />);
  const nav = await screen.findByRole('button', { name: 'Câu 27 — bỏ trống' });
  const card = view.container.querySelector('#listening-review-q-27') as HTMLElement;
  expect(within(card).getByText('Bỏ trống')).toBeTruthy();
  expect(card.dataset.correct).toBe('false');
  expect(card.classList.contains('is-incorrect')).toBe(false);
  expect(nav.classList.contains('is-incorrect')).toBe(false);
  expect(screen.getByRole('button', { name: 'Câu 28 — sai' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Câu 29 — đúng' })).toBeTruthy();
  expect(screen.getByText(/2 câu cần xem lại · 1 câu đúng/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Đúng', exact: true }));
  expect(view.container.querySelector('#listening-review-q-27')).toBeNull();
  expect(view.container.querySelector('#listening-review-q-29')?.getAttribute('data-correct')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Cần xem lại', exact: true }));
  expect(view.container.querySelector('#listening-review-q-27')).toBeTruthy();
  expect(view.container.querySelector('#listening-review-q-28')).toBeTruthy();
  expect(JSON.stringify(raw)).toBe(before);
  expect(getWith).toHaveBeenCalledTimes(1);
});

it('keeps an admin preview scoreless and does not label its empty sample answers as outcomes', async () => {
  window.history.replaceState(null, '', '/listening/review?admin_test_id=ILR-LIS-CAM-B13-T3');
  getWith.mockResolvedValue(response('', true));
  const view = render(<ListeningReviewWorkspace />);
  const nav = await screen.findByRole('button', { name: 'Câu 27 — xem trước' });
  expect(nav.classList.contains('is-incorrect')).toBe(false);
  expect(view.container.querySelector('.lr-card__verdict')).toBeNull();
  expect(screen.queryByText('Bỏ trống')).toBeNull();
  expect(screen.queryByRole('group', { name: 'Lọc kết quả câu hỏi' })).toBeNull();
});

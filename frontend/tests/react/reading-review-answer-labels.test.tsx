import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { ReadingReviewWorkspace } from '@/app/(reading-review)/reading/review/reading-review-workspace';

vi.mock('@/lib/auth/auth-provider', () => ({
  useAuth: () => ({ status: 'signed-in', user: { id: 'review-owner' } }),
}));

let getWith: ReturnType<typeof vi.fn>;
let post: ReturnType<typeof vi.fn>;
beforeEach(() => {
  window.history.replaceState(null, '', '/reading/review?attempt_id=label-fixture');
  getWith = vi.fn(); post = vi.fn();
  Object.defineProperty(window, 'api', { configurable: true, value: { getWith, post } });
  Object.defineProperty(window, 'renderMarkdown', { configurable: true, value: (text: string) => text });
  Object.defineProperty(window, 'AverFeedback', { configurable: true, value: { attachCardFlag: vi.fn(), mountSurvey: vi.fn() } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });

it('distinguishes blank, incorrect and correct responses without changing their canonical grade or filtering', async () => {
  const fixture = {
    attempt_id: 'label-fixture', status: 'submitted', test_id: 'review-label-fixture', title: 'Review labels',
    score: 1, max_score: 3, band_estimate: 3, skill_breakdown: {},
    passages: [{ passage_order: 2, title: 'Source', body_markdown: 'Source text.' }],
    review: [
      { q_num: 18, passage_order: 2, correct: false, user_answer: '  ', expected: 'A', prompt: 'Blank response' },
      { q_num: 19, passage_order: 2, correct: false, user_answer: 'B', expected: 'C', prompt: 'Wrong response' },
      { q_num: 20, passage_order: 2, correct: true, user_answer: '0', expected: '0', prompt: 'Correct response' },
    ],
  };
  const original = JSON.stringify(fixture);
  getWith.mockResolvedValue(fixture);
  const view = render(<ReadingReviewWorkspace />);
  const blank = await screen.findByText('Bỏ trống', { selector: '.rr-card__verdict' });
  expect(blank.closest('.rr-card')?.classList.contains('is-blank')).toBe(true);
  expect(screen.getByRole('button', { name: 'Câu 18 — bỏ trống' }).classList.contains('is-blank')).toBe(true);
  expect(screen.getByRole('button', { name: 'Câu 19 — sai' })).toBeTruthy();
  expect(view.container.querySelector('#reading-review-q-19 .rr-card__verdict')?.textContent).toBe('✗ Sai');
  expect(view.container.querySelector('#reading-review-q-20')).toBeNull(); // Existing needs-review filter remains.
  fireEvent.click(screen.getByRole('button', { name: 'Tất cả', exact: true }));
  expect(view.container.querySelector('#reading-review-q-20 .rr-card__verdict')?.textContent).toBe('✓ Đúng');
  expect(within(view.container.querySelector('#reading-review-q-20') as HTMLElement).getAllByText('0')).toHaveLength(2);
  expect(view.container.querySelector('#reading-review-q-18 .rr-card__ans.is-correct code')?.textContent).toBe('A');
  expect(JSON.stringify(fixture)).toBe(original);
  expect(post).not.toHaveBeenCalled();
});

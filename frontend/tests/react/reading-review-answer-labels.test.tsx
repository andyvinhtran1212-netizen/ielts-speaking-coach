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

it('labels Cambridge choose-TWO review rows as multiple answers while retaining stored slot types and keys', async () => {
  window.history.replaceState(null, '', '/reading/review?admin_test_id=grouped-label-fixture');
  const fixture = {
    preview: true, status: 'submitted', test_id: 'grouped-label-fixture', title: 'Grouped review',
    score: 0, max_score: 3, skill_breakdown: {},
    passages: [{ passage_order: 2, title: 'Source', body_markdown: 'Source text.' }],
    review: [
      ...[21, 22].map((q_num) => ({
        q_num, passage_order: 2, correct: false, user_answer: '', expected: 'B, D',
        question_type: 'mcq_single', group: 'grouped_mcq_single',
        prompt: 'Which TWO of the following statements are true of the researchers at London Zoo?',
        question_context: { instruction: 'Choose TWO letters, A-E.' },
      })),
      { q_num: 23, passage_order: 2, correct: false, user_answer: '', expected: 'A',
        question_type: 'mcq_single', prompt: 'Ordinary single-answer question' },
    ],
  };
  const original = JSON.stringify(fixture);
  getWith.mockResolvedValue(fixture);
  const view = render(<ReadingReviewWorkspace />);
  await screen.findByText(fixture.title);
  for (const q_num of [21, 22]) {
    const card = view.container.querySelector(`#reading-review-q-${q_num}`) as HTMLElement;
    expect(card.querySelector('.rr-card__tag')?.textContent).toBe('MCQ · nhiều đáp án');
    expect(card.querySelector('.rr-card__ans.is-correct code')?.textContent).toBe('B, D');
  }
  expect(view.container.querySelector('#reading-review-q-23 .rr-card__tag')?.textContent).toBe('MCQ · 1 đáp án');
  expect(JSON.stringify(fixture)).toBe(original);
  expect(post).not.toHaveBeenCalled();
});

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

it('filters blank apart from incorrect, splits the totals and keeps the persisted score (FR-013)', async () => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  const fixture = {
    attempt_id: 'label-fixture', status: 'submitted', test_id: 'review-filter-fixture', title: 'Review filters',
    score: 1, max_score: 3, band_estimate: 3, skill_breakdown: {},
    passages: [{ passage_order: 2, title: 'Source', body_markdown: 'Source text.' }],
    review: [
      { q_num: 18, passage_order: 2, correct: false, user_answer: '', expected: 'A', prompt: 'Blank response' },
      { q_num: 19, passage_order: 2, correct: false, user_answer: 'B', expected: 'C', prompt: 'Wrong response' },
      { q_num: 20, passage_order: 2, correct: true, user_answer: 'D', expected: 'D', prompt: 'Correct response' },
    ],
  };
  const original = JSON.stringify(fixture);
  getWith.mockResolvedValue(fixture);
  const view = render(<ReadingReviewWorkspace />);
  expect(await screen.findByText(/^1 câu sai · 1 câu bỏ trống · 1 câu đúng\./)).toBeTruthy();
  const filters = within(screen.getByRole('group', { name: 'Lọc kết quả câu hỏi' }));
  const pressed = () => filters.getAllByRole('button').filter((button) => button.getAttribute('aria-pressed') === 'true').map((button) => button.textContent);
  const shown = () => [...view.container.querySelectorAll('[id^="reading-review-q-"]')].map((card) => card.id.replace('reading-review-q-', ''));
  expect(filters.getAllByRole('button').map((button) => button.textContent)).toEqual(['Cần xem lại', 'Bỏ trống', 'Tất cả', 'Đúng']);
  expect(pressed()).toEqual(['Cần xem lại']);
  expect(shown()).toEqual(['18', '19']);

  fireEvent.click(filters.getByRole('button', { name: 'Bỏ trống' }));
  expect(shown()).toEqual(['18']);
  fireEvent.click(screen.getByRole('button', { name: 'Câu 18 — bỏ trống' }));
  expect(pressed()).toEqual(['Bỏ trống']); // A blank question stays in its own filter.
  fireEvent.click(screen.getByRole('button', { name: 'Câu 19 — sai' }));
  expect(pressed()).toEqual(['Tất cả']);
  expect(shown()).toEqual(['18', '19', '20']);

  fireEvent.click(filters.getByRole('button', { name: 'Đúng' }));
  expect(shown()).toEqual(['20']);
  fireEvent.click(filters.getByRole('button', { name: 'Cần xem lại' }));
  expect(shown()).toEqual(['18', '19']);
  fireEvent.click(screen.getByRole('button', { name: 'Câu 18 — bỏ trống' }));
  expect(pressed()).toEqual(['Cần xem lại']);

  expect(view.container.querySelector('.rr-topbar-summary__score')?.textContent).toBe('Kết quả1/3 câu');
  expect(JSON.stringify(fixture)).toBe(original);
  expect(post).not.toHaveBeenCalled();
  expect(getWith).toHaveBeenCalledTimes(1);
});

it('keeps an admin preview without filters or outcome totals', async () => {
  window.history.replaceState(null, '', '/reading/review?admin_test_id=preview-filter-fixture');
  getWith.mockResolvedValue({
    preview: true, status: 'submitted', test_id: 'preview-filter-fixture', title: 'Preview filters',
    score: null, max_score: 2, skill_breakdown: {},
    passages: [{ passage_order: 1, title: 'Source', body_markdown: 'Source text.' }],
    review: [
      { q_num: 1, passage_order: 1, correct: false, user_answer: '', expected: 'A', prompt: 'One' },
      { q_num: 2, passage_order: 1, correct: false, user_answer: '', expected: 'B', prompt: 'Two' },
    ],
  });
  render(<ReadingReviewWorkspace />);
  expect(await screen.findByText(/^2 câu trong đề · /)).toBeTruthy();
  expect(screen.queryByRole('group', { name: 'Lọc kết quả câu hỏi' })).toBeNull();
  expect(screen.queryByText(/câu bỏ trống/)).toBeNull();
});

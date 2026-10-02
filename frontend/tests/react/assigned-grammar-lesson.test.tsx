import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { AssignedGrammarLesson } from '@/app/(authed)/grammar-lessons/assigned/workspace';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('assignment_item=item-1') }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const base = {
  assignment_item_id: 'item-1', assignment_id: 'assignment-1', lesson_id: 'M30-B04',
  title: 'Articles', instructions: 'Đọc lý thuyết trước', due_at: null,
  status: 'not_started', can_submit: true, answered_count: 0, correct_count: 0,
  question_count: 1, attempt_id: null, focus: 'Dùng mạo từ chính xác',
  article: { category: 'foundations', slug: 'articles', title: 'Articles' },
  questions: [],
};
const question = { id: 'q1', prompt: 'Choose the article.', options: ['a', 'an'] };

it('starts an assigned lesson, persists an answer, and reloads the same correction', async () => {
  let saved = { ...base };
  const get = vi.fn(async () => saved);
  const post = vi.fn(async (url: string, body?: { selected_index?: number }) => {
    if (url.endsWith('/start')) {
      saved = { ...base, status: 'in_progress', attempt_id: 'attempt-1', questions: [question] };
    } else {
      expect(body?.selected_index).toBe(1);
      saved = { ...base, status: 'completed', can_submit: false, answered_count: 1,
        correct_count: 1, attempt_id: 'attempt-1', questions: [{ ...question,
          selected_index: 1, is_correct: true, correct_index: 1,
          explanation: 'Use an before a vowel sound.' }] };
    }
    return saved;
  });
  Object.defineProperty(window, 'api', { configurable: true, value: { get, post } });
  const view = render(<AssignedGrammarLesson />);
  expect(await screen.findByRole('heading', { name: 'M30-B04 · Articles' })).toBeTruthy();
  expect(screen.getByRole('link', { name: /Mở Articles/ }).getAttribute('href')).toBe('/grammar/foundations/articles');
  expect(post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu luyện tập' }));
  expect(await screen.findByText('Choose the article.')).toBeTruthy();
  expect(screen.queryByText('Use an before a vowel sound.')).toBeNull();
  fireEvent.click(screen.getByRole('radio', { name: 'B. an' }));
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra câu này' }));
  expect(await screen.findByText('Use an before a vowel sound.')).toBeTruthy();
  expect(screen.getByText(/Đã hoàn thành: 1\/1 câu đúng/)).toBeTruthy();
  view.unmount();
  render(<AssignedGrammarLesson />);
  await waitFor(() => expect(screen.getByText('Use an before a vowel sound.')).toBeTruthy());
  expect(get).toHaveBeenCalledTimes(2);
  expect(post).toHaveBeenCalledTimes(2);
});

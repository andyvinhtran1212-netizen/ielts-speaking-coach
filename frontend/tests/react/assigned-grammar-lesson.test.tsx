import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { AssignedGrammarLesson } from '@/app/(authed)/grammar-lessons/assigned/workspace';
import { GrammarLessonReport } from '@/app/(authed-admin-grammar)/admin/grammar-lessons/report';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('assignment_item=item-1&attempt=attempt-1') }));
const auth = vi.hoisted(() => ({
  status: 'signed-in' as 'initial-loading' | 'signed-in' | 'signed-out',
  user: { id: 'learner-one', email: null } as { id: string; email: string | null } | null,
}));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => auth }));

afterEach(() => {
  cleanup(); vi.restoreAllMocks();
  auth.status = 'signed-in'; auth.user = { id: 'learner-one', email: null };
});

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

it('shows reviewed lesson notes and permits practice without a Wiki substitute', async () => {
  const get = vi.fn(async () => ({ ...base, article: null,
    learning_objectives: ['Phân biệt âm và chữ'],
    lesson_notes: '## Âm và chữ\n\n**Âm cuối** khác với chữ cuối.\n\n<script>alert(1)</script>',
  }));
  const post = vi.fn(async () => ({ ...base, status: 'in_progress', article: null,
    lesson_notes: 'Đã học âm và chữ.', questions: [question],
  }));
  Object.defineProperty(window, 'api', { configurable: true, value: { get, post } });
  const { container } = render(<AssignedGrammarLesson />);
  expect(await screen.findByText('Phân biệt âm và chữ')).toBeTruthy();
  expect(await screen.findByRole('heading', { name: 'Âm và chữ' })).toBeTruthy();
  expect(container.querySelector('script')).toBeNull();
  expect(screen.queryByText('Tài liệu bài học hiện chưa sẵn sàng.')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu luyện tập' }));
  expect(await screen.findByText('Choose the article.')).toBeTruthy();
  expect(post).toHaveBeenCalledOnce();
});

it('waits for authenticated bootstrap and hides the lesson immediately on logout', async () => {
  auth.status = 'initial-loading'; auth.user = null;
  Object.defineProperty(window, 'api', { configurable: true, value: undefined });
  const view = render(<AssignedGrammarLesson />);
  expect(screen.getByText('Đang tải bài Grammar…')).toBeTruthy();
  const get = vi.fn(async () => base);
  Object.defineProperty(window, 'api', { configurable: true, value: { get } });
  auth.status = 'signed-in'; auth.user = { id: 'learner-one', email: null };
  view.rerender(<AssignedGrammarLesson />);
  expect(await screen.findByRole('heading', { name: 'M30-B04 · Articles' })).toBeTruthy();
  expect(get).toHaveBeenCalledOnce();
  auth.status = 'signed-out'; auth.user = null;
  view.rerender(<AssignedGrammarLesson />);
  expect(screen.getByRole('link', { name: 'Đăng nhập' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'M30-B04 · Articles' })).toBeNull();
});

it('rejects an older response after the authenticated learner changes', async () => {
  let resolveOld!: (value: typeof base) => void;
  const get = vi.fn()
    .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
    .mockResolvedValueOnce({ ...base, title: 'Current learner lesson' });
  Object.defineProperty(window, 'api', { configurable: true, value: { get } });
  const view = render(<AssignedGrammarLesson />);
  await waitFor(() => expect(get).toHaveBeenCalledOnce());
  auth.user = { id: 'learner-two', email: null };
  view.rerender(<AssignedGrammarLesson />);
  expect(await screen.findByRole('heading', { name: 'M30-B04 · Current learner lesson' })).toBeTruthy();
  await act(async () => { resolveOld(base); });
  expect(screen.queryByRole('heading', { name: 'M30-B04 · Articles' })).toBeNull();
  expect(screen.getByRole('heading', { name: 'M30-B04 · Current learner lesson' })).toBeTruthy();
});

const report = { attempt_id: 'attempt-1', assignment_item_id: 'item-1',
  assignment_title: 'Teacher report', lesson_id: 'M30-B04', status: 'completed',
  correct_count: 1, question_count: 1, completed_at: null, focus: 'Articles',
  article: null, questions: [{ ...question, selected_index: 1, is_correct: true,
    correct_index: 1, explanation: 'Use an before a vowel sound.' }] };

it('waits for teacher auth bootstrap and removes report data on logout', async () => {
  auth.status = 'initial-loading'; auth.user = null;
  Object.defineProperty(window, 'api', { configurable: true, value: undefined });
  const view = render(<GrammarLessonReport />);
  expect(screen.getByText('Đang tải báo cáo…')).toBeTruthy();
  const get = vi.fn(async () => report);
  Object.defineProperty(window, 'api', { configurable: true, value: { get } });
  auth.status = 'signed-in'; auth.user = { id: 'teacher-one', email: null };
  view.rerender(<GrammarLessonReport />);
  expect(await screen.findByRole('heading', { name: 'M30-B04 · Teacher report' })).toBeTruthy();
  expect(get).toHaveBeenCalledOnce();
  auth.status = 'signed-out'; auth.user = null;
  view.rerender(<GrammarLessonReport />);
  expect(screen.getByRole('link', { name: 'Đăng nhập' })).toBeTruthy();
  expect(screen.queryByText('Use an before a vowel sound.')).toBeNull();
});

it('shows a failed teacher read and retries the same report', async () => {
  const get = vi.fn().mockRejectedValueOnce(new Error('Không đọc được báo cáo')).mockResolvedValueOnce(report);
  Object.defineProperty(window, 'api', { configurable: true, value: { get } });
  render(<GrammarLessonReport />);
  expect((await screen.findByRole('alert')).textContent).toContain('Không đọc được báo cáo');
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  expect(await screen.findByRole('heading', { name: 'M30-B04 · Teacher report' })).toBeTruthy();
  expect(get.mock.calls.map((call) => call[0])).toEqual([
    '/admin/grammar-lessons/attempts/attempt-1', '/admin/grammar-lessons/attempts/attempt-1',
  ]);
});

it('discards an older teacher report response after account change', async () => {
  let resolveOld!: (value: typeof report) => void;
  const get = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
    .mockResolvedValueOnce({ ...report, assignment_title: 'Current teacher report' });
  Object.defineProperty(window, 'api', { configurable: true, value: { get } });
  const view = render(<GrammarLessonReport />);
  await waitFor(() => expect(get).toHaveBeenCalledOnce());
  auth.user = { id: 'teacher-two', email: null };
  view.rerender(<GrammarLessonReport />);
  expect(await screen.findByRole('heading', { name: 'M30-B04 · Current teacher report' })).toBeTruthy();
  await act(async () => { resolveOld(report); });
  expect(screen.queryByRole('heading', { name: 'M30-B04 · Teacher report' })).toBeNull();
});

it('shows writing requirements before submission, preserves a failed draft, and keeps writing ungraded', async () => {
  const writing = { id: 'B04-E1-01', type: 'writing', format_code: 'E1',
    prompt: 'Rewrite **the sentence**.\n<script>bad()</script>', options: [],
    output_requirements: 'Write two sentences and explain the choice.' };
  const opened = { ...base, content_version: 'v3', status: 'in_progress', attempt_id: 'attempt-1',
    question_count: 100, objective_count: 90, writing_count: 10, writing_answered_count: 0,
    answered_count: 99, correct_count: 89, questions: [writing] };
  const raw = 'My own sentence.\nMy reason.';
  const saved = { ...opened, status: 'completed', can_submit: false, answered_count: 100,
    writing_answered_count: 10, questions: [{ ...writing, answer_text: raw,
      writing_feedback: { model_answer: 'An example sentence.', accepted_variants: ['Another valid sentence.'],
        rubric: 'Keep the original meaning.', detailed_rubric: 'Explain your grammar choice.', writing_skill: 'Revision' } }] };
  const get = vi.fn(async () => opened);
  const post = vi.fn().mockRejectedValueOnce(new Error('Không lưu được bài viết')).mockImplementationOnce(async (_url, body) => {
    expect(body).toEqual({ question_id: writing.id, answer_text: raw });
    return saved;
  });
  Object.defineProperty(window, 'api', { configurable: true, value: { get, post } });
  const view = render(<AssignedGrammarLesson />);
  const input = await screen.findByRole('textbox', { name: 'Bài viết câu 1' });
  expect(screen.getByText(writing.output_requirements)).toBeTruthy();
  expect(view.container.querySelector('script')).toBeNull();
  expect(await screen.findByText('the sentence', { selector: 'strong' })).toBeTruthy();
  expect(screen.queryByText('An example sentence.')).toBeNull();
  fireEvent.change(input, { target: { value: raw } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu và đối chiếu' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Không lưu được bài viết');
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(raw);
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại' }));
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  expect((await screen.findByRole('textbox') as HTMLTextAreaElement).value).toBe(raw);
  fireEvent.click(screen.getByRole('button', { name: 'Lưu và đối chiếu' }));
  expect(await screen.findByText('An example sentence.')).toBeTruthy();
  expect(screen.getByText(/Đã hoàn thành: 89\/90 câu đúng/)).toBeTruthy();
  expect(screen.getByText('Đã lưu bài viết · Chưa chấm điểm')).toBeTruthy();
  expect(view.container.querySelector('.agl-feedback.is-incorrect')).toBeNull();
  expect(screen.queryByRole('textbox')).toBeNull();
});

it('teacher report separates objective accuracy from raw writing and reference feedback', async () => {
  Object.defineProperty(window, 'api', { configurable: true, value: { get: vi.fn(async () => ({
    ...report, question_count: 120, objective_count: 90, writing_count: 30, writing_answered_count: 30,
    questions: [{ id: 'B26-E1-01', type: 'writing', prompt: 'Write a sentence.', options: [],
      answer_text: 'Learner text with an error.', writing_feedback: { model_answer: 'Reference only.',
        accepted_variants: [], rubric: 'Meaning and grammar.', detailed_rubric: 'Review the form.', writing_skill: 'Accuracy' } }],
  })) } });
  render(<GrammarLessonReport />);
  expect(await screen.findByText('1/90 câu trắc nghiệm đúng')).toBeTruthy();
  expect(screen.getByText('Đã lưu 30/30 câu viết · Chưa chấm điểm')).toBeTruthy();
  expect(screen.getByText('Learner text with an error.')).toBeTruthy();
  expect(await screen.findByText('Reference only.')).toBeTruthy();
  expect(screen.queryByText('Cần sửa')).toBeNull();
});

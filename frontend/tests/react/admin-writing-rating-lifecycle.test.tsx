import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { AdminWritingGradeBehavior } from '@/app/(authed-admin-writing-grade)/admin/writing/grade/writing-grade-behavior';

const params = vi.hoisted(() => new URLSearchParams({ id: 'essay-1' }));
vi.mock('next/navigation', () => ({ useSearchParams: () => params }));
vi.mock('@/components/admin-access-gate', () => ({ useAdminProfile: () => ({ id: 'admin-1', email: 'admin@example.test' }) }));
afterEach(() => {
  cleanup();
  params.set('id', 'essay-1');
});

it('guides an authenticated admin with no essay id without making an essay request', async () => {
  params.delete('id');
  const get = vi.fn();
  const post = vi.fn();
  Object.defineProperty(window, 'api', { configurable: true, value: { get, post } });
  render(<StrictMode><AdminWritingGradeBehavior /></StrictMode>);

  expect((await screen.findByRole('alert')).textContent).toContain('Chọn một bài trong hàng chờ Writing');
  expect(screen.getByRole('link', { name: '← Quay lại Writing' }).getAttribute('href')).toBe('/admin/writing');
  expect(get).not.toHaveBeenCalled();
  expect(post).not.toHaveBeenCalled();
  expect(document.querySelector('#grade-rating-panel')).toBeNull();
});

it('keeps one rating panel and its unsaved state through repeated tabs under StrictMode', async () => {
  const runtime = { window: {} as { WritingRenderers?: unknown } };
  runInNewContext(readFileSync(resolve(process.cwd(), 'public/js/writing-renderers.js'), 'utf8'), runtime);
  Object.defineProperty(window, 'WritingRenderers', { configurable: true, value: runtime.window.WritingRenderers });
  const post = vi.fn();
  const get = vi.fn().mockResolvedValue({
    id: 'essay-1', status: 'graded', task_type: 'task2', grading_tier: 'standard', analysis_level: 3,
    essay_text: 'Some people believe education should be free.', selected_model: 'test-model', student: { full_name: 'Student' },
    feedback: { overall_band_score: 6.5, feedback_json: { counterargumentAnalysis: { isPresent: false, context: { insertionPoint: 'Sau đoạn 2', reasoning: 'Cần cân nhắc mặt đối lập.' }, feedback: 'Chưa có phản biện.', suggestion: 'Thêm một ý đối lập.' } } },
  });
  Object.defineProperty(window, 'api', { configurable: true, value: { get, post } });
  render(<StrictMode><AdminWritingGradeBehavior /></StrictMode>);

  await screen.findByRole('heading', { name: /Đánh giá chất lượng chấm/ });
  fireEvent.click(screen.getByRole('button', { name: '3 sao' }));
  const note = screen.getByPlaceholderText<HTMLTextAreaElement>(/Ghi chú ngắn/);
  fireEvent.change(note, { target: { value: 'Đang ghi nhận xét chưa lưu' } });
  const tabs = screen.getAllByRole('tab');
  for (let cycle = 0; cycle < 5; cycle += 1) {
    for (const tab of tabs) {
      fireEvent.click(tab);
      expect(document.querySelectorAll('#grade-rating-panel')).toHaveLength(1);
      expect(document.querySelectorAll('#gr-save')).toHaveLength(1);
      expect(screen.getByRole('button', { name: '3 sao' }).getAttribute('aria-pressed')).toBe('true');
      expect(note.value).toBe('Đang ghi nhận xét chưa lưu');
    }
  }
  expect(document.body.textContent).not.toContain('[object Object]');
  expect(document.querySelector('#content-counterargument')?.textContent).toContain('Sau đoạn 2');
  expect(post).not.toHaveBeenCalled();
});

it('G-U04 resets rating to the second essay identity while preserving unsaved tab state without writes', async () => {
  const runtime = { window: {} as { WritingRenderers?: unknown } };
  runInNewContext(readFileSync(resolve(process.cwd(), 'public/js/writing-renderers.js'), 'utf8'), runtime);
  Object.defineProperty(window, 'WritingRenderers', { configurable: true, value: runtime.window.WritingRenderers });
  const essays = {
    'essay-1': { id: 'essay-1', selected_model: 'model-essay-1', grade_rating: { rating: 2, note: 'Persisted first essay' } },
    'essay-2': { id: 'essay-2', selected_model: 'model-essay-2', grade_rating: { rating: 5, note: 'Persisted second essay' } },
  };
  const original = JSON.stringify(essays);
  const get = vi.fn(async (path: string) => ({
    ...structuredClone(essays[path.endsWith('essay-2') ? 'essay-2' : 'essay-1']),
    status: 'graded', task_type: 'task2', grading_tier: 'standard', analysis_level: 3,
    essay_text: 'Owned synthetic essay fixture.', student: { full_name: 'Fixture student' },
    feedback: { overall_band_score: 6.5, feedback_json: {} },
  }));
  const post = vi.fn(), patch = vi.fn(), remove = vi.fn();
  Object.defineProperty(window, 'api', { configurable: true, value: { get, post, patch, delete: remove } });
  const view = render(<StrictMode><AdminWritingGradeBehavior /></StrictMode>);
  await screen.findByText('model-essay-1');
  fireEvent.click(screen.getByRole('button', { name: '3 sao' }));
  fireEvent.change(screen.getByPlaceholderText(/Ghi chú ngắn/), { target: { value: 'Unsaved first essay' } });
  fireEvent.click(screen.getAllByRole('tab')[1]);
  expect(screen.getByRole('button', { name: '3 sao' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByPlaceholderText<HTMLTextAreaElement>(/Ghi chú ngắn/).value).toBe('Unsaved first essay');

  params.set('id', 'essay-2');
  view.rerender(<StrictMode><AdminWritingGradeBehavior /></StrictMode>);
  await screen.findByText('model-essay-2');
  expect(document.querySelectorAll('#grade-rating-panel')).toHaveLength(1);
  expect(screen.getByRole('button', { name: '5 sao' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button', { name: '3 sao' }).getAttribute('aria-pressed')).toBe('false');
  expect(screen.getByPlaceholderText<HTMLTextAreaElement>(/Ghi chú ngắn/).value).toBe('Persisted second essay');
  fireEvent.click(screen.getByRole('button', { name: '4 sao' }));
  fireEvent.change(screen.getByPlaceholderText(/Ghi chú ngắn/), { target: { value: 'Unsaved second essay' } });
  fireEvent.click(screen.getAllByRole('tab')[0]);
  expect(screen.getByRole('button', { name: '4 sao' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByPlaceholderText<HTMLTextAreaElement>(/Ghi chú ngắn/).value).toBe('Unsaved second essay');

  params.set('id', 'essay-1');
  view.rerender(<StrictMode><AdminWritingGradeBehavior /></StrictMode>);
  await screen.findByText('model-essay-1');
  expect(screen.getByRole('button', { name: '2 sao' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByPlaceholderText<HTMLTextAreaElement>(/Ghi chú ngắn/).value).toBe('Persisted first essay');
  expect(get).toHaveBeenCalledWith('/admin/writing/essays/essay-1');
  expect(get).toHaveBeenCalledWith('/admin/writing/essays/essay-2');
  expect(post).not.toHaveBeenCalled(); expect(patch).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
  expect(JSON.stringify(essays)).toBe(original);
});

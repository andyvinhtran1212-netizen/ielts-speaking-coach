import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { AdminWritingGradeBehavior } from '@/app/(authed-admin-writing-grade)/admin/writing/grade/writing-grade-behavior';

const params = vi.hoisted(() => new URLSearchParams({ id: 'essay-1' }));
vi.mock('next/navigation', () => ({ useSearchParams: () => params }));
vi.mock('@/components/admin-access-gate', () => ({ useAdminProfile: () => ({ id: 'admin-1', email: 'admin@example.test' }) }));

const MAX_VERSIONS = 'Đã đạt tối đa 3 version chấm cho bài này (còn 0). Không thể chấm lại — hãy so sánh/ghép các bản hiện có.';

function essay(overrides: Record<string, unknown> = {}) {
  return {
    id: 'essay-1', status: 'graded', task_type: 'task2', grading_tier: 'standard', analysis_level: 3,
    essay_text: 'Owned synthetic essay fixture.', selected_model: 'gemini-2.5-pro', student: { full_name: 'Fixture student' },
    regrade_count: 2, is_manually_edited: false,
    feedback: { overall_band_score: 6.5, model_used: 'claude-sonnet-5-5', feedback_json: { overallBandScoreSummary: 'Unchanged AI feedback.' } },
    ...overrides,
  };
}

// The same ApiError shape public/js/api.js throws for a non-2xx response.
function apiError(status: number, detail: string) {
  return Object.assign(new Error(detail), { status, detail });
}

beforeEach(() => {
  const runtime = { window: {} as { WritingRenderers?: unknown } };
  runInNewContext(readFileSync(resolve(process.cwd(), 'public/js/writing-renderers.js'), 'utf8'), runtime);
  Object.defineProperty(window, 'WritingRenderers', { configurable: true, value: runtime.window.WritingRenderers });
  Object.defineProperty(window, 'showToast', { configurable: true, value: vi.fn() });
});
afterEach(() => cleanup());

it('W-REGRADE-409 keeps the regrade dialog open and shows the backend detail', async () => {
  const get = vi.fn().mockResolvedValue(essay());
  const post = vi.fn().mockRejectedValue(apiError(409, MAX_VERSIONS));
  Object.defineProperty(window, 'api', { configurable: true, value: { get, post } });
  render(<StrictMode><AdminWritingGradeBehavior /></StrictMode>);

  fireEvent.click(await screen.findByRole('button', { name: '🔄 Chấm lại' }));
  const dialog = screen.getByRole('dialog', { name: 'Chấm lại bằng AI' });
  fireEvent.click(screen.getByRole('button', { name: 'Chấm lại' }));

  expect((await screen.findByRole('alert')).textContent).toBe(MAX_VERSIONS);
  expect(dialog.isConnected).toBe(true);
  expect(post).toHaveBeenCalledOnce();
  expect(post).toHaveBeenCalledWith('/admin/writing/essays/essay-1/regrade', { analysis_level: 3 });
  // No success claim, no reload of the essay as if a new grade were queued.
  expect(document.body.textContent).not.toContain('Đã queue regrade');
  expect(window.showToast).not.toHaveBeenCalledWith(expect.stringContaining('Đã queue regrade'), 'success', expect.anything());
  expect(get).toHaveBeenCalledTimes(1);
  // The admin can retry or dismiss the dialog after reading the reason.
  expect(screen.getByRole('button', { name: 'Chấm lại' }).hasAttribute('disabled')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('closes the regrade dialog only after the backend accepts the regrade', async () => {
  const get = vi.fn().mockResolvedValue(essay());
  let accept: (value: unknown) => void = () => {};
  const post = vi.fn(() => new Promise((resolveRequest) => { accept = resolveRequest; }));
  Object.defineProperty(window, 'api', { configurable: true, value: { get, post } });
  render(<StrictMode><AdminWritingGradeBehavior /></StrictMode>);

  fireEvent.click(await screen.findByRole('button', { name: '🔄 Chấm lại' }));
  fireEvent.click(screen.getByRole('button', { name: 'Chấm lại' }));
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Đang gửi…' }).hasAttribute('disabled')).toBe(true);

  await act(async () => { accept({ essay_id: 'essay-1', status: 'grading', regrade_count: 3, analysis_level: 3 }); });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  // The reload clears the inline notice; the toast carries the confirmation.
  expect(window.showToast).toHaveBeenCalledWith('Đã queue regrade #3 (L3).', 'success', { timeout: 4000 });
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
});

it('BL-22 shows "Đã sửa" only when the backend recorded an edit', async () => {
  const get = vi.fn().mockResolvedValue(essay());
  const patch = vi.fn().mockResolvedValue({ essay_id: 'essay-1', status: 'reviewed', is_manually_edited: false });
  Object.defineProperty(window, 'api', { configurable: true, value: { get, post: vi.fn(), patch } });
  render(<StrictMode><AdminWritingGradeBehavior /></StrictMode>);

  fireEvent.click(await screen.findByRole('button', { name: /Lưu & duyệt/ }));
  await waitFor(() => expect(document.querySelector('#status-pill')?.textContent).toBe('reviewed'));
  expect(patch).toHaveBeenCalledOnce();
  expect(document.querySelector('.badge-manual')).toBeNull();
  expect(document.body.textContent).not.toContain('✏ Đã sửa');
});

it('BL-22 shows "Đã sửa" right after a save the backend recorded as an edit', async () => {
  const get = vi.fn().mockResolvedValue(essay());
  const patch = vi.fn().mockResolvedValue({ essay_id: 'essay-1', status: 'reviewed', is_manually_edited: true });
  Object.defineProperty(window, 'api', { configurable: true, value: { get, post: vi.fn(), patch } });
  render(<StrictMode><AdminWritingGradeBehavior /></StrictMode>);

  fireEvent.click(await screen.findByRole('button', { name: /Lưu & duyệt/ }));
  await waitFor(() => expect(document.querySelector('.badge-manual')?.textContent).toBe('✏ Đã sửa'));
});

it('AI-LOG never presents the requested model as the one that graded', async () => {
  const get = vi.fn().mockResolvedValue(essay({ feedback: { overall_band_score: 6.5, feedback_json: {} } }));
  Object.defineProperty(window, 'api', { configurable: true, value: { get, post: vi.fn() } });
  render(<StrictMode><AdminWritingGradeBehavior /></StrictMode>);

  await screen.findByRole('heading', { name: /Đánh giá chất lượng chấm/ });
  expect(document.querySelector('#gr-model')?.textContent).toBe('—');
  expect(document.body.textContent).not.toContain('gemini-2.5-pro');
});

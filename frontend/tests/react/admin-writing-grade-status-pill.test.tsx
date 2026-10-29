import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { AdminWritingGradeBehavior } from '@/app/(authed-admin-writing-grade)/admin/writing/grade/writing-grade-behavior';

const params = vi.hoisted(() => new URLSearchParams({ essay_id: 'essay-1' }));
vi.mock('next/navigation', () => ({ useSearchParams: () => params }));
vi.mock('@/components/admin-access-gate', () => ({ useAdminProfile: () => ({ id: 'admin-1', email: 'admin@example.test' }) }));

const ESSAY = {
  id: 'essay-1', status: 'graded', task_type: 'task2', grading_tier: 'standard', analysis_level: 3,
  essay_text: 'Owned synthetic essay fixture.', student: { full_name: 'Fixture student' },
  feedback: { overall_band_score: 6.5, feedback_json: { overallBandScoreSummary: 'Unchanged AI feedback.' } },
};

function held() {
  let release: (value: unknown) => void = () => {};
  const promise = new Promise((resolveRequest) => { release = resolveRequest; });
  return { promise, release };
}

const pill = () => document.querySelector('#status-pill');
const deliverButton = () => screen.getByRole('button', { name: '✓ Trả bài cho học viên' });
const revokeButton = () => screen.queryByRole('button', { name: '↩ Thu hồi bài' });

beforeEach(() => {
  const runtime = { window: {} as { WritingRenderers?: unknown } };
  runInNewContext(readFileSync(resolve(process.cwd(), 'public/js/writing-renderers.js'), 'utf8'), runtime);
  Object.defineProperty(window, 'WritingRenderers', { configurable: true, value: runtime.window.WritingRenderers });
  Object.defineProperty(window, 'showToast', { configurable: true, value: vi.fn() });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

// W-GRADE-STALE-STATUS (PC-J26): the pill and the status-gated buttons follow
// each status the backend answers — reviewed after "Lưu & duyệt", delivered
// after "Trả bài", reviewed after "Thu hồi" — without a page reload, and never
// before the backend has answered.
it('W-GRADE-STALE-STATUS moves the pill graded → reviewed → delivered → reviewed as each write returns', async () => {
  const get = vi.fn().mockResolvedValue(ESSAY);
  const save = held();
  const deliver = held();
  const revoke = held();
  const patch = vi.fn(() => save.promise);
  const post = vi.fn((path: string) => (path.endsWith('/mark-delivered') ? deliver.promise : revoke.promise));
  Object.defineProperty(window, 'api', { configurable: true, value: { get, post, patch } });
  render(<StrictMode><AdminWritingGradeBehavior /></StrictMode>);

  fireEvent.click(await screen.findByRole('button', { name: /Lưu & duyệt/ }));
  expect(pill()?.textContent).toBe('graded');
  expect(pill()?.getAttribute('data-status')).toBe('graded');
  expect(deliverButton().hasAttribute('disabled')).toBe(true);
  await act(async () => { save.release({ essay_id: 'essay-1', status: 'reviewed', is_manually_edited: false }); });
  await waitFor(() => expect(pill()?.textContent).toBe('reviewed'));
  expect(pill()?.getAttribute('data-status')).toBe('reviewed');
  expect(deliverButton().hasAttribute('disabled')).toBe(false);
  expect(revokeButton()).toBeNull();

  fireEvent.click(deliverButton());
  expect(post).toHaveBeenLastCalledWith('/admin/writing/essays/essay-1/mark-delivered', { method: 'google_docs_paste', hide_subbands: false });
  expect(pill()?.textContent).toBe('reviewed');
  await act(async () => { deliver.release({ essay_id: 'essay-1', status: 'delivered', method: 'google_docs_paste', hide_subbands: false }); });
  await waitFor(() => expect(pill()?.textContent).toBe('delivered'));
  expect(deliverButton().hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('button', { name: /Lưu & duyệt/ }).hasAttribute('disabled')).toBe(true);
  expect(revokeButton()).not.toBeNull();

  fireEvent.click(revokeButton()!);
  expect(post).toHaveBeenLastCalledWith('/admin/writing/essays/essay-1/revoke-delivery', {});
  expect(pill()?.textContent).toBe('delivered');
  await act(async () => { revoke.release({ essay_id: 'essay-1', status: 'reviewed' }); });
  await waitFor(() => expect(pill()?.textContent).toBe('reviewed'));
  expect(revokeButton()).toBeNull();
  expect(deliverButton().hasAttribute('disabled')).toBe(false);

  // The transitions came from the write responses, not from a reload.
  expect(get).toHaveBeenCalledTimes(1);
});

it('W-GRADE-STALE-STATUS re-delivers a revoked essay and shows delivered again', async () => {
  const get = vi.fn().mockResolvedValue({ ...ESSAY, status: 'delivered' });
  const post = vi.fn(async (path: string) => (path.endsWith('/revoke-delivery')
    ? { essay_id: 'essay-1', status: 'reviewed' }
    : { essay_id: 'essay-1', status: 'delivered', method: 'google_docs_paste', hide_subbands: false }));
  Object.defineProperty(window, 'api', { configurable: true, value: { get, post, patch: vi.fn() } });
  render(<StrictMode><AdminWritingGradeBehavior /></StrictMode>);

  fireEvent.click(await screen.findByRole('button', { name: '↩ Thu hồi bài' }));
  await waitFor(() => expect(pill()?.textContent).toBe('reviewed'));
  fireEvent.click(deliverButton());
  await waitFor(() => expect(pill()?.textContent).toBe('delivered'));
  expect(revokeButton()).not.toBeNull();
  expect(get).toHaveBeenCalledTimes(1);
});

it('W-GRADE-STALE-STATUS keeps the backend status when a write fails', async () => {
  const get = vi.fn().mockResolvedValue({ ...ESSAY, status: 'reviewed' });
  const post = vi.fn().mockRejectedValue(Object.assign(new Error('Cannot mark delivered'), { status: 409 }));
  Object.defineProperty(window, 'api', { configurable: true, value: { get, post, patch: vi.fn() } });
  render(<StrictMode><AdminWritingGradeBehavior /></StrictMode>);

  fireEvent.click(await screen.findByRole('button', { name: '✓ Trả bài cho học viên' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Trả bài thất bại: Cannot mark delivered');
  expect(pill()?.textContent).toBe('reviewed');
  expect(revokeButton()).toBeNull();
});

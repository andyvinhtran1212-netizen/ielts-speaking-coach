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

it('PC-J531 labels learner history correctly in the native admin preview tabs', async () => {
  const get = vi.fn().mockResolvedValue({
    ...ESSAY,
    feedback: { overall_band_score: 6.5, feedback_json: {
      recurringPatterns: { summary: 'Lịch sử lỗi lặp lại.' },
      sentenceStructureAnalysis: {
        summary: 'Lịch sử cấu trúc câu.',
        current_essay_observation: 'Quan sát riêng bài này.',
      },
    } },
  });
  Object.defineProperty(window, 'api', { configurable: true, value: { get } });
  render(<StrictMode><AdminWritingGradeBehavior /></StrictMode>);

  fireEvent.click(await screen.findByRole('tab', { name: /Nhận xét lỗi/ }));
  const recurringLabel = screen.getByText('Nhận xét chung qua các bài gần đây của học viên (không riêng bài này):');
  expect(recurringLabel.tagName).toBe('STRONG');
  expect(screen.queryByText('Nhận xét chung qua các bài gần đây của bạn (không riêng bài này):')).toBeNull();

  fireEvent.click(screen.getByRole('tab', { name: /Phân tích nâng cao/ }));
  expect(screen.getByText('Nhận xét chung về cấu trúc câu qua các bài gần đây (không riêng bài này):').tagName).toBe('STRONG');
  expect(screen.getByText('Quan sát riêng bài này.')).toBeTruthy();
});

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
  get.mockResolvedValue({ ...ESSAY, status: 'reviewed', is_manually_edited: false });
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

  // Saving re-reads canonical detail; delivery/revocation retain their response contract.
  expect(get).toHaveBeenCalledTimes(2);
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

it('WRITINGBAND-0050 waits for canonical feedback before showing save success or enabling delivery', async () => {
  const refresh = held();
  const get = vi.fn().mockResolvedValueOnce(ESSAY).mockImplementation(() => refresh.promise);
  const patch = vi.fn().mockResolvedValue({ status: 'reviewed' });
  Object.defineProperty(window, 'api', { configurable: true, value: { get, patch } });
  render(<StrictMode><AdminWritingGradeBehavior /></StrictMode>);
  const save = await screen.findByRole('button', { name: /Lưu & duyệt/ });
  fireEvent.click(save);
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  expect(save.hasAttribute('disabled')).toBe(true);
  expect(deliverButton().hasAttribute('disabled')).toBe(true);
  expect(screen.queryByText('Đã lưu chỉnh sửa.')).toBeNull();
  fireEvent.click(save);
  expect(patch).toHaveBeenCalledTimes(1);
  await act(async () => refresh.release({ ...ESSAY, status: 'reviewed', is_manually_edited: true,
    feedback: { overall_band_score: 7, feedback_json: { overallBandScore: 7, overallBandScoreSummary: 'Canonical band 7 feedback.' } },
  }));
  expect(await screen.findByText('Đã lưu chỉnh sửa.')).toBeTruthy();
  expect(document.querySelector('#band-score')?.textContent).toBe('Band 7');
  expect(screen.getByText('Canonical band 7 feedback.')).toBeTruthy();
  expect(deliverButton().hasAttribute('disabled')).toBe(false);
  expect(screen.getByText('✏ Đã sửa')).toBeTruthy();
});

it('WRITINGBAND-0050 distinguishes a saved-but-unread result and recovers by reading, not rewriting', async () => {
  const get = vi.fn().mockResolvedValueOnce({ ...ESSAY, status: 'reviewed' }).mockRejectedValueOnce(new Error('refresh offline'));
  const patch = vi.fn().mockResolvedValue({ status: 'reviewed' });
  const post = vi.fn();
  Object.defineProperty(window, 'api', { configurable: true, value: { get, patch, post } });
  render(<StrictMode><AdminWritingGradeBehavior /></StrictMode>);
  fireEvent.click(await screen.findByRole('button', { name: /Lưu & duyệt/ }));
  expect((await screen.findByRole('alert')).textContent).toContain('Đã lưu, nhưng chưa tải lại được kết quả');
  expect(deliverButton().hasAttribute('disabled')).toBe(true);
  fireEvent.click(deliverButton());
  expect(post).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: /Lưu & duyệt/ }).hasAttribute('disabled')).toBe(true);
  get.mockResolvedValue({ ...ESSAY, status: 'reviewed', feedback: { overall_band_score: 7, feedback_json: { overallBandScore: 7 } } });
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại kết quả' }));
  await waitFor(() => expect(document.querySelector('#band-score')?.textContent).toBe('Band 7'));
  expect(patch).toHaveBeenCalledTimes(1);
  expect(deliverButton().hasAttribute('disabled')).toBe(false);
});

it('WRITINGBAND-0050 write failure preserves the local draft and permits retry', async () => {
  const get = vi.fn().mockResolvedValue(ESSAY);
  const patch = vi.fn().mockRejectedValue(new Error('write offline'));
  Object.defineProperty(window, 'api', { configurable: true, value: { get, patch } });
  render(<StrictMode><AdminWritingGradeBehavior /></StrictMode>);
  await screen.findByRole('button', { name: /Lưu & duyệt/ });
  fireEvent.click(document.querySelector('#section-overview .btn-edit')!);
  fireEvent.change(document.querySelector('#edit-overview textarea')!, { target: { value: 'Unsaved owned draft.' } });
  fireEvent.click(document.querySelector('#edit-overview .btn-primary')!);
  fireEvent.click(screen.getByRole('button', { name: /Lưu & duyệt/ }));
  expect((await screen.findByRole('alert')).textContent).toContain('Save failed: write offline');
  expect(screen.getByText('Unsaved owned draft.')).toBeTruthy();
  expect(screen.getByRole('button', { name: /Lưu & duyệt/ }).hasAttribute('disabled')).toBe(false);
  expect(get).toHaveBeenCalledTimes(1);
});

it('WRITINGBAND-0050 does not apply a late save to another essay', async () => {
  const save = held();
  const get = vi.fn(async (path: string) => path.endsWith('essay-2')
    ? { ...ESSAY, id: 'essay-2', student: { full_name: 'Second fixture student' } }
    : ESSAY);
  Object.defineProperty(window, 'api', { configurable: true, value: { get, patch: vi.fn(() => save.promise) } });
  const rendered = render(<StrictMode><AdminWritingGradeBehavior /></StrictMode>);
  fireEvent.click(await screen.findByRole('button', { name: /Lưu & duyệt/ }));
  params.set('essay_id', 'essay-2');
  rendered.rerender(<StrictMode><AdminWritingGradeBehavior /></StrictMode>);
  await screen.findByText('Second fixture student');
  await act(async () => save.release({ status: 'reviewed' }));
  expect(pill()?.textContent).toBe('graded');
  expect(screen.queryByText('Đã lưu chỉnh sửa.')).toBeNull();
  params.set('essay_id', 'essay-1');
});

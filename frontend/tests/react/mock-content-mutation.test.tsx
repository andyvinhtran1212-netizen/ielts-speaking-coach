import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExamContentLibrary } from '@/app/(authed-admin-mock-exams)/admin/mock-exams/exam-content-library';
import { getAdminExamContentPage } from '@/lib/admin-exam-content-api';

vi.mock('@/lib/admin-exam-content-api', () => ({ getAdminExamContentPage: vi.fn() }));
const page = (status = 'published') => ({ items: [{ id: 'paper-1', kind: 'reading', code: 'PAPER-1', title: 'Fixture paper', status, publish_ready: true, cohort_ids: ['class-1'], mock_exams: [], is_public: false }], total: 1, total_complete: true, levels: [], levels_complete: true, failed_level_kinds: [], failed_kinds: [] });
const cohorts = [{ id: 'class-1', name: 'Fixture class' }];
const get = vi.mocked(getAdminExamContentPage);
let patch: ReturnType<typeof vi.fn>;
let post: ReturnType<typeof vi.fn>;
function deferred() { let resolve!: (value: unknown) => void; let reject!: (error: unknown) => void; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => {
  get.mockReset().mockResolvedValue(page());
  patch = vi.fn(); post = vi.fn();
  Object.defineProperty(window, 'api', { configurable: true, value: { patch, post } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function openStatus() {
  await screen.findByText('PAPER-1');
  fireEvent.click(screen.getByRole('button', { name: 'Về draft', hidden: true }));
  return within(screen.getByRole('dialog')).getByRole('button', { name: 'Xác nhận' });
}

describe('mock content mutation errors survive canonical reload', () => {
  it.each([409, 503, 0])('keeps status failure %s after GET 200, manual refresh and dismiss', async (status) => {
    patch.mockRejectedValue(Object.assign(new Error(`Write rejected ${status}`), { status }));
    render(<ExamContentLibrary accountId="admin-1" cohorts={cohorts} />);
    fireEvent.click(await openStatus());
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect((await screen.findByRole('alert')).textContent).toContain(`Write rejected ${status}`);
    expect(screen.getByText('Đã publish')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại' }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(3));
    expect(screen.getByRole('alert').textContent).toContain(`Write rejected ${status}`);
    fireEvent.click(screen.getByRole('button', { name: 'Đóng lỗi thao tác' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each(['network', 'malformed'])('shows both write failure and %s reconciliation failure', async (failure) => {
    patch.mockRejectedValue(Object.assign(new Error('Mock dependency remains active'), { status: 409 }));
    get.mockResolvedValueOnce(page());
    if (failure === 'network') get.mockRejectedValueOnce(new Error('List unavailable'));
    else get.mockResolvedValueOnce({ invalid: true } as any);
    render(<ExamContentLibrary accountId="admin-1" cohorts={cohorts} />);
    fireEvent.click(await openStatus());
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
    expect(screen.getAllByRole('alert').map((node) => node.textContent).join(' ')).toContain('Mock dependency remains active');
    expect(screen.getAllByRole('alert').map((node) => node.textContent).join(' ')).toContain(failure === 'network' ? 'List unavailable' : 'sai contract');
    expect(screen.getByText('Đã publish')).toBeTruthy();
  });

  it('clears old failure only for intentional retry and confirms server draft without duplicate writes', async () => {
    const retry = deferred();
    patch.mockRejectedValueOnce(new Error('Try later')).mockReturnValueOnce(retry.promise);
    get.mockResolvedValueOnce(page()).mockResolvedValueOnce(page()).mockResolvedValueOnce(page('draft'));
    render(<ExamContentLibrary accountId="admin-1" cohorts={cohorts} />);
    fireEvent.click(await openStatus());
    await screen.findByText('Try later');
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Xác nhận' }).hasAttribute('disabled')).toBe(false));
    const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: 'Xác nhận' });
    fireEvent.click(confirm); fireEvent.click(confirm);
    expect(patch).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Try later')).toBeNull();
    await act(async () => retry.resolve({ status: 'draft' }));
    await screen.findByText('Bản nháp', { selector: 'span.mex-pill' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('preserves assignment error through list refresh', async () => {
    post.mockRejectedValue(new Error('Assignment rejected'));
    render(<ExamContentLibrary accountId="admin-1" cohorts={cohorts} />);
    await screen.findByText('PAPER-1');
    fireEvent.click(screen.getByRole('button', { name: 'Giao cho lớp', hidden: true }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Giao cho cả lớp' }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Assignment rejected')).toBeTruthy();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('does not repeat an acknowledged assignment when reconciliation fails', async () => {
    post.mockResolvedValue({ id: 'assignment-1' });
    get.mockResolvedValueOnce(page()).mockRejectedValueOnce(new Error('List unavailable')).mockResolvedValueOnce(page());
    render(<ExamContentLibrary accountId="admin-1" cohorts={cohorts} />);
    await screen.findByText('PAPER-1');
    fireEvent.click(screen.getByRole('button', { name: 'Giao cho lớp', hidden: true }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Giao cho cả lớp' }));
    await screen.findByText('List unavailable');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText(/Máy chủ đã xác nhận thao tác/).textContent).toContain('không gửi lại thao tác');
    const reopen = screen.getByRole('button', { name: 'Giao cho lớp', hidden: true });
    expect(reopen.hasAttribute('disabled')).toBe(true);
    fireEvent.click(reopen); expect(screen.queryByRole('dialog')).toBeNull();
    expect(post).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại' }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.queryByText(/Máy chủ đã xác nhận thao tác/)).toBeNull());
    expect(screen.getByRole('button', { name: 'Giao cho lớp', hidden: true }).hasAttribute('disabled')).toBe(false);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('shows acknowledged status write separately from failed list readback', async () => {
    patch.mockResolvedValue({ status: 'draft' });
    get.mockResolvedValueOnce(page()).mockRejectedValueOnce(new Error('List unavailable')).mockResolvedValueOnce(page('draft'));
    render(<ExamContentLibrary accountId="admin-1" cohorts={cohorts} />);
    fireEvent.click(await openStatus());
    await screen.findByText('List unavailable');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText(/Máy chủ đã xác nhận thao tác/)).toBeTruthy();
    expect(screen.getByText('Đã publish')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại' }));
    await screen.findByText('Bản nháp', { selector: 'span.mex-pill' });
    expect(screen.queryByText(/Máy chủ đã xác nhận thao tác/)).toBeNull();
    expect(patch).toHaveBeenCalledTimes(1);
  });

  it('ignores a write completion after owner change, without stealing the new list request', async () => {
    const old = deferred(); patch.mockReturnValue(old.promise);
    const view = render(<ExamContentLibrary accountId="admin-1" cohorts={cohorts} />);
    fireEvent.click(await openStatus());
    view.rerender(<ExamContentLibrary accountId="admin-2" cohorts={cohorts} />);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    await act(async () => old.reject(new Error('Old owner error')));
    expect(get).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Old owner error')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

// ADMINIA-0074 G09-T14 (FR-045, FR-046): shared re-practice grant and revoke forms.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PracticeGrantForm } from '@/components/admin/practice-grant-form';
import { RevokeAccessForm } from '@/components/admin/revoke-access-form';

const C1 = 'c1000000-0000-4000-8000-000000000001';
const C2 = 'c2000000-0000-4000-8000-000000000002';
const products = [
  { id: 'p1', course_id: C1, kind: 'repractice', short_title: 'Course 1', status: 'open', access_days: 14, review_mode: 'ai_instant', archived_at: null },
  { id: 'p2', course_id: C2, kind: 'repractice', short_title: 'Course 2', status: 'open', access_days: 30, review_mode: 'ai_instant', archived_at: null },
];
const users = [{ id: 'u-a', name: 'Lan' }, { id: 'u-b', name: 'Minh' }, { id: 'u-c', name: 'Hoa' }];
const api = { getWith: vi.fn(), post: vi.fn() };

beforeEach(() => {
  api.getWith.mockReset().mockResolvedValue({ items: products });
  api.post.mockReset().mockResolvedValue({ status: 'granted', entitlement: { id: 'e1' } });
  Object.assign(window, { api });
});
afterEach(() => { cleanup(); });

async function fillAndConfirm(reason = 'Luyện lại trước kỳ thi') {
  const dialog = await screen.findByRole('dialog', { name: 'Cấp quyền luyện lại' });
  await within(dialog).findByRole('combobox');
  fireEvent.change(within(dialog).getByRole('textbox', { name: /Lý do/ }), { target: { value: reason } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Tiếp tục' }));
  return screen.findByRole('dialog', { name: 'Xác nhận cấp quyền' });
}

describe('PracticeGrantForm', () => {
  it('offers no class course, asks again with the head count, then grants each learner once', async () => {
    const onGranted = vi.fn();
    render(<PracticeGrantForm open users={users} excludeCourseIds={[C1]} onClose={() => {}} onGranted={onGranted} />);
    const dialog = await screen.findByRole('dialog', { name: 'Cấp quyền luyện lại' });
    const select = await within(dialog).findByRole('combobox');
    expect(Array.from((select as HTMLSelectElement).options).map((o) => o.textContent)).toEqual(['Course 2']);
    const confirm = await fillAndConfirm();
    expect(within(confirm).getByText(/cho 3 người, 30 ngày/)).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cấp quyền' }));
    await screen.findByText('Đã cấp cho 3/3 người.');
    expect(api.post).toHaveBeenCalledTimes(3);
    expect(api.post.mock.calls.map(([path]) => path)).toEqual(Array(3).fill('/admin/entitlements'));
    expect(api.post.mock.calls.map(([, body]) => body.user_id)).toEqual(['u-a', 'u-b', 'u-c']);
    expect(api.post.mock.calls[0][1]).toMatchObject({ product_id: 'p2', review_mode: 'ai_instant', reason: 'Luyện lại trước kỳ thi' });
    expect(api.post.mock.calls[0][1]).not.toHaveProperty('days');
    expect(new Set(api.post.mock.calls.map(([, body]) => body.request_key)).size).toBe(3);
    expect(onGranted).toHaveBeenCalledWith(['u-a', 'u-b', 'u-c']);
    expect(screen.queryByRole('button', { name: 'Thử lại phần còn lại' })).toBeNull();
  });

  it('a failure part-way lists granted and not granted; the retry sends only the rest, with the same keys', async () => {
    api.post.mockReset()
      .mockResolvedValueOnce({ status: 'granted' })
      .mockRejectedValueOnce(new Error('Hết thời gian chờ máy chủ.'))
      .mockResolvedValueOnce({ status: 'granted' })
      .mockResolvedValue({ status: 'replay' });
    render(<PracticeGrantForm open users={users} excludeCourseIds={[C1]} onClose={() => {}} />);
    fireEvent.click(within(await fillAndConfirm()).getByRole('button', { name: 'Cấp quyền' }));
    await screen.findByText('Đã cấp cho 2/3 người.');
    expect(within(screen.getByRole('region', { name: 'Đã cấp' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Lan', 'Hoa']);
    expect(within(screen.getByRole('region', { name: 'Chưa cấp' })).getByText('Minh: Hết thời gian chờ máy chủ.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại phần còn lại' }));
    await screen.findByText('Đã cấp cho 3/3 người.');
    expect(api.post).toHaveBeenCalledTimes(4);
    expect(api.post.mock.calls[3][1].user_id).toBe('u-b');
    expect(api.post.mock.calls[3][1].request_key).toBe(api.post.mock.calls[1][1].request_key);
  });

  it('a learner who already holds the course is skipped and named', async () => {
    render(<PracticeGrantForm open users={users} excludeCourseIds={[C1]} heldCourseIds={{ 'u-c': [C2] }} onClose={() => {}} />);
    const confirm = await fillAndConfirm();
    expect(within(confirm).getByText(/cho 2 người.*Bỏ qua 1 người đã có quyền\./)).toBeTruthy();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cấp quyền' }));
    await screen.findByText('Đã cấp cho 2/2 người.');
    expect(api.post.mock.calls.map(([, body]) => body.user_id)).toEqual(['u-a', 'u-b']);
    expect(screen.getByText('Bỏ qua vì đã có quyền: Hoa')).toBeTruthy();
  });

  it('a short reason stays in the form; a failed product list says so', async () => {
    render(<PracticeGrantForm open users={[users[0]]} excludeCourseIds={[C1]} onClose={() => {}} />);
    const dialog = await screen.findByRole('dialog', { name: 'Cấp quyền luyện lại' });
    await within(dialog).findByRole('combobox');
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Lý do/ }), { target: { value: 'ngắn' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tiếp tục' }));
    expect(within(dialog).getByRole('alert').textContent).toBe('Lý do cần ít nhất 10 ký tự.');
    expect(api.post).not.toHaveBeenCalled();
    cleanup();
    api.getWith.mockReset().mockRejectedValue(new Error('Máy chủ chưa sẵn sàng.'));
    render(<PracticeGrantForm open users={[users[0]]} onClose={() => {}} />);
    expect((await screen.findByRole('alert')).textContent).toBe('Chưa tải được danh sách khoá: Máy chủ chưa sẵn sàng.');
  });
});

describe('RevokeAccessForm', () => {
  it('revokes only after the exact full name and a reason; the server message shows as it is', async () => {
    api.post.mockReset().mockRejectedValueOnce(new Error('Không tìm thấy quyền học.'))
      .mockResolvedValue({ status: 'revoked', entitlement: { id: 'e1' } });
    const onRevoked = vi.fn();
    const onClose = vi.fn();
    render(<RevokeAccessForm open entitlementId="e1" courseTitle="Course 2" learnerName="Lan Nguyễn" onClose={onClose} onRevoked={onRevoked} />);
    const dialog = screen.getByRole('dialog', { name: 'Thu hồi quyền học' });
    expect(within(dialog).getByText(/Lan Nguyễn sẽ mất quyền vào khoá “Course 2” ngay/)).toBeTruthy();
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Gõ đúng họ tên/ }), { target: { value: 'Lan' } });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Lý do/ }), { target: { value: 'Học viên xin dừng khoá' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Thu hồi quyền' }));
    expect(within(dialog).getByRole('alert').textContent).toBe('Họ tên gõ vào chưa khớp.');
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Gõ đúng họ tên/ }), { target: { value: 'Lan Nguyễn' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Thu hồi quyền' }));
    await waitFor(() => expect(within(dialog).getByRole('alert').textContent).toBe('Không tìm thấy quyền học.'));
    expect(onRevoked).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Thu hồi quyền' }));
    await waitFor(() => expect(onRevoked).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenLastCalledWith('/admin/entitlements/e1/revoke', { reason: 'Học viên xin dừng khoá' });
    expect(onClose).toHaveBeenCalled();
  });
});

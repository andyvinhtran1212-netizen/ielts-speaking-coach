// ADMINIA-0074 G09-T14 (FR-045, FR-046): shared re-practice grant and revoke forms.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PracticeGrantForm } from '@/components/admin/practice-grant-form';
import { RevokeAccessForm } from '@/components/admin/revoke-access-form';

const C1 = 'c1000000-0000-4000-8000-000000000001';
const C2 = 'c2000000-0000-4000-8000-000000000002';
const products = [
  { id: 'p1', course_id: C1, slug: 'c1-re', kind: 'repractice', short_title: 'Course 1', status: 'open', access_days: 14, review_mode: 'ai_instant', archived_at: null },
  { id: 'p2', course_id: C2, slug: 'c2-re', kind: 'repractice', short_title: 'Course 2', status: 'open', access_days: 30, review_mode: 'ai_instant', archived_at: null },
];
let access: Record<string, { entitlement_id: string | null; product_slug: string | null; course_code?: string | null; state: string }[]> = {};
const courses = [{ id: C1, code: 'C1' }, { id: C2, code: 'C2' }];
const routeGet = (list: unknown[] = products) => (path: string) => {
  const m = /^\/admin\/users\/([^/]+)\/access$/.exec(path);
  if (m) return Promise.resolve({ items: access[decodeURIComponent(m[1])] ?? [] });
  if (path === '/admin/courses') return Promise.resolve({ courses });
  return Promise.resolve({ items: list });
};
const users = [{ id: 'u-a', name: 'Lan' }, { id: 'u-b', name: 'Minh' }, { id: 'u-c', name: 'Hoa' }];
const api = { getWith: vi.fn(), post: vi.fn() };

beforeEach(() => {
  access = {};
  api.getWith.mockReset().mockImplementation(routeGet());
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

  it('each learner\'s access is read from G04 on open; one who already holds the course is skipped and named', async () => {
    access = { 'u-c': [{ entitlement_id: 'e9', product_slug: 'c2-re', state: 'active' }], 'u-a': [{ entitlement_id: 'e8', product_slug: 'c2-re', state: 'revoked' }] };
    render(<PracticeGrantForm open users={users} excludeCourseIds={[C1]} onClose={() => {}} />);
    const confirm = await fillAndConfirm();
    expect(within(confirm).getByText(/cho 2 người.*Bỏ qua 1 người đã có quyền\./)).toBeTruthy();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cấp quyền' }));
    await screen.findByText('Đã cấp cho 2/2 người.');
    expect(api.post.mock.calls.map(([, body]) => body.user_id)).toEqual(['u-a', 'u-b']);
    expect(screen.getByText('Bỏ qua vì đã có quyền: Hoa')).toBeTruthy();
    expect(api.getWith.mock.calls.map(([p]) => p).filter((p) => String(p).endsWith('/access')).sort())
      .toEqual(['/admin/users/u-a/access', '/admin/users/u-b/access', '/admin/users/u-c/access']);
  });

  it('reopening after a grant whose answer was lost reads access again and skips that learner', async () => {
    api.post.mockReset().mockImplementation(() => {
      access = { 'u-a': [{ entitlement_id: 'e1', product_slug: 'c2-re', state: 'active' }] };
      return Promise.reject(new Error('Hết thời gian chờ máy chủ.'));
    });
    const view = render(<PracticeGrantForm open users={[users[0]]} excludeCourseIds={[C1]} onClose={() => {}} />);
    fireEvent.click(within(await fillAndConfirm()).getByRole('button', { name: 'Cấp quyền' }));
    await screen.findByText('Đã cấp cho 0/1 người.');
    view.rerender(<PracticeGrantForm open={false} users={[users[0]]} excludeCourseIds={[C1]} onClose={() => {}} />);
    view.rerender(<PracticeGrantForm open users={[users[0]]} excludeCourseIds={[C1]} onClose={() => {}} />);
    expect(await screen.findByText('Không còn khoá luyện lại nào để cấp cho người đã chọn.')).toBeTruthy();
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('a learner holding the course through a legacy class code is skipped too (matched by course code)', async () => {
    access = { 'u-b': [{ entitlement_id: null, product_slug: null, course_code: 'C2', state: 'active' }] };
    render(<PracticeGrantForm open users={users} excludeCourseIds={[C1]} onClose={() => {}} />);
    const confirm = await fillAndConfirm();
    expect(within(confirm).getByText(/cho 2 người.*Bỏ qua 1 người đã có quyền\./)).toBeTruthy();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cấp quyền' }));
    await screen.findByText('Đã cấp cho 2/2 người.');
    expect(api.post.mock.calls.map(([, body]) => body.user_id)).toEqual(['u-a', 'u-c']);
  });

  it('a single legacy holder is offered no course; a failed course-code read blocks the form', async () => {
    access = { 'u-a': [{ entitlement_id: null, product_slug: null, course_code: 'C2', state: 'active' }] };
    const view = render(<PracticeGrantForm open users={[users[0]]} excludeCourseIds={[C1]} onClose={() => {}} />);
    expect(await screen.findByText('Không còn khoá luyện lại nào để cấp cho người đã chọn.')).toBeTruthy();
    view.unmount();
    api.getWith.mockImplementation((path: string) => (path === '/admin/courses'
      ? Promise.reject(new Error('Máy chủ chưa sẵn sàng.')) : routeGet()(path)));
    render(<PracticeGrantForm open users={[users[0]]} excludeCourseIds={[C1]} onClose={() => {}} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/Máy chủ chưa sẵn sàng/);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('no legacy holding, no course-code read', async () => {
    render(<PracticeGrantForm open users={users} excludeCourseIds={[C1]} onClose={() => {}} />);
    await screen.findByRole('combobox');
    expect(api.getWith.mock.calls.some(([p]) => p === '/admin/courses')).toBe(false);
  });

  it('a failed access read blocks the form with Tải lại instead of guessing', async () => {
    let fail = true;
    api.getWith.mockImplementation((path: string) => (path.endsWith('/access') && fail
      ? Promise.reject(new Error('Máy chủ chưa sẵn sàng.')) : routeGet()(path)));
    render(<PracticeGrantForm open users={users} onClose={() => {}} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/chưa đọc được quyền học hiện có của 3 người/);
    expect(screen.queryByRole('combobox')).toBeNull();
    fail = false;
    fireEvent.click(within(alert).getByRole('button', { name: 'Tải lại' }));
    await screen.findByRole('combobox');
  });

  it('choosing a course takes its own review mode until the admin picks one', async () => {
    api.getWith.mockReset().mockImplementation(routeGet([products[0], { ...products[1], review_mode: 'teacher_review' }]));
    render(<PracticeGrantForm open users={[users[0]]} onClose={() => {}} />);
    const dialog = await screen.findByRole('dialog', { name: 'Cấp quyền luyện lại' });
    const select = await within(dialog).findByRole('combobox');
    fireEvent.change(select, { target: { value: 'p2' } });
    expect((within(dialog).getByRole('radio', { name: /Qua giáo viên duyệt/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(dialog).getByRole('radio', { name: /AI trả ngay/ }));
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Lý do/ }), { target: { value: 'Luyện lại trước kỳ thi' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tiếp tục' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Xác nhận cấp quyền' })).getByRole('button', { name: 'Cấp quyền' }));
    await screen.findByText('Đã cấp cho 1/1 người.');
    expect(api.post.mock.calls[0][1]).toMatchObject({ product_id: 'p2', review_mode: 'ai_instant' });
  });

  it('a confirm is never sent for a list that changed after Tiếp tục; a started run keeps its recipients', async () => {
    const other = [{ id: 'u-x', name: 'Xuân' }, { id: 'u-y', name: 'Yến' }, { id: 'u-z', name: 'Zung' }];
    const view = render(<PracticeGrantForm open users={users} excludeCourseIds={[C1]} onClose={() => {}} />);
    await fillAndConfirm();
    // Same head count, other learners: the open confirm is dropped, nothing is sent.
    view.rerender(<PracticeGrantForm open users={other} excludeCourseIds={[C1]} onClose={() => {}} />);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Xác nhận cấp quyền' })).toBeNull());
    expect(api.post).not.toHaveBeenCalled();
    // The excluded course changes while the confirm is open: Cấp quyền sends nothing and asks again.
    const confirm = await fillAndConfirm();
    view.rerender(<PracticeGrantForm open users={other} excludeCourseIds={[C1, 'c9']} onClose={() => {}} />);
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cấp quyền' }));
    expect(api.post).not.toHaveBeenCalled();
    expect((await screen.findByRole('alert')).textContent).toMatch(/Danh sách người nhận đã thay đổi/);
    // A run that has started keeps its recipients when the caller's list changes.
    let release: (v: unknown) => void = () => {};
    api.post.mockReset().mockImplementationOnce(() => new Promise((r) => { release = r; })).mockResolvedValue({ status: 'granted' });
    fireEvent.click(within(await fillAndConfirm()).getByRole('button', { name: 'Cấp quyền' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    view.rerender(<PracticeGrantForm open users={users} excludeCourseIds={[C1, 'c9']} onClose={() => {}} />);
    release({ status: 'granted' });
    await screen.findByText('Đã cấp cho 3/3 người.');
    expect(api.post.mock.calls.map(([, body]) => body.user_id)).toEqual(['u-x', 'u-y', 'u-z']);
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
    expect((await screen.findByRole('alert')).textContent).toMatch(/^Chưa tải được danh sách khoá: Máy chủ chưa sẵn sàng\./);
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

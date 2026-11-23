// ADMINIA-0074 G09-T15 (FR-047, FR-054, FR-056): Sổ lượt AI /admin/credits.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ search: '', push: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/credits',
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ push: nav.push }),
}));
vi.mock('@/components/admin-access-gate', () => ({ useAdminProfile: () => ({ id: 'admin-1' }) }));

import { AdminCredits } from '@/app/(authed-admin)/(credits)/admin/credits/admin-credits';

const U = '40000000-0000-4000-8000-000000000001';
const E1 = '11111111-1111-4111-8111-111111111111';
const access = (balance = 42) => ({
  items: [
    { entitlement_id: E1, title: 'IELTS 6.5 Online', short_title: 'IELTS 6.5', kind: 'online', state: 'active',
      expires_at: '2027-02-01T16:59:59Z',
      credits: { balance, usable_from: null, usable_until: null, carry_balance: 12, carry_expires_at: '2027-01-15T10:00:00Z' } },
  ],
  credits: { total: balance, by_kind: { online: balance, class: 0 } },
});
const credits = (balance = 42, extra: Record<string, unknown>[] = []) => ({
  balance,
  next_cursor: null,
  items: [
    ...extra,
    { at: '2026-11-20T03:00:00Z', delta: 12, reason: 'carry_over', label_vi: 'Chuyển lượt chưa dùng từ kỳ trước khi đăng ký lại',
      balance_after: 42, course_code: 'C6', feature: null, note: null, entitlement_id: E1, actor: null },
    { at: '2026-11-18T03:00:00Z', delta: 30, reason: 'grant', label_vi: 'Cộng khi mở khoá',
      balance_after: 30, course_code: 'C6', feature: null, note: null, entitlement_id: E1, actor: null },
  ],
});
const api = { getWith: vi.fn(), post: vi.fn() };
let balance = 42;

beforeEach(() => {
  nav.search = `ref=u-${U}`;
  nav.push.mockReset();
  balance = 42;
  api.getWith.mockReset().mockImplementation((path: string) => {
    if (path.startsWith('/admin/learners')) {
      return Promise.resolve({ items: [{ ref: `u-${U}`, name: 'Lan Nguyễn', email: 'lan@example.test', student_code: null }],
        total: 1, page: 1, page_size: 25, sources_failed: [], undecided: [] });
    }
    if (path.endsWith('/access')) return Promise.resolve(access(balance));
    return Promise.resolve(credits(balance, balance !== 42 ? [{ at: '2026-11-23T03:00:00Z', delta: 5, reason: 'admin_adjust',
      label_vi: 'Điều chỉnh bởi admin', balance_after: 47, course_code: 'C6', feature: null, note: 'Bù lượt do lỗi chấm',
      entitlement_id: E1, actor: { id: 'admin-1', email: null, display_name: 'Cô Lan' } }] : []));
  });
  api.post.mockReset().mockImplementation(() => { balance = 47; return Promise.resolve({ status: 'adjusted', balance: 47 }); });
  Object.assign(window, { api });
});
afterEach(() => { cleanup(); });

const cardBalance = () => document.querySelector('.cr-card__balance')?.textContent;
const balanceIs = (text: string) => waitFor(() => expect(cardBalance()).toBe(text));

async function openAdjust() {
  render(<AdminCredits />);
  await balanceIs('42 lượt');
  fireEvent.click(screen.getByRole('button', { name: 'Điều chỉnh lượt' }));
  return screen.getByRole('dialog');
}

describe('AdminCredits', () => {
  it('shows the per-course balance, the carry line and the ledger from G04, with no row actions', async () => {
    render(<AdminCredits />);
    await balanceIs('42 lượt');
    expect(api.getWith).toHaveBeenCalledWith(`/admin/users/${U}/access`, undefined, undefined);
    expect(api.getWith).toHaveBeenCalledWith(`/admin/users/${U}/credits?limit=20`, undefined, undefined);
    expect(screen.getByText('trong đó 12 lượt chuyển, dùng tới 15/01/2027')).toBeTruthy();
    const table = screen.getByRole('table');
    expect(within(table).getByText('12 lượt, dùng tới 15/01/2027')).toBeTruthy();
    expect(within(table).queryAllByRole('button')).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/\d+\s*%/);
    expect(screen.getByRole('link', { name: 'Mở danh bạ đã lọc' }).getAttribute('href')).toBe('/admin/learners?attention=low_credits');
  });

  it('finds a learner through the directory and opens the ledger by ref', async () => {
    nav.search = '';
    render(<AdminCredits />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'lan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tìm' }));
    fireEvent.click(await screen.findByRole('button', { name: /Lan Nguyễn/ }));
    expect(api.getWith).toHaveBeenCalledWith('/admin/learners?q=lan&page=1', undefined, undefined);
    expect(nav.push).toHaveBeenCalledWith(`/admin/credits?ref=u-${encodeURIComponent(`u-${U}`).slice(2)}`);
  });

  it('a learner without an account has no ledger and no request is made', async () => {
    nav.search = 'ref=s-50000000-0000-4000-8000-000000000001';
    render(<AdminCredits />);
    expect(screen.getByText('Người này chưa có tài khoản đăng nhập nên chưa có sổ lượt.')).toBeTruthy();
    expect(api.getWith).not.toHaveBeenCalled();
  });

  it('adjusts after a confirm step with one request key, then reloads the balance from the server', async () => {
    const dialog = await openAdjust();
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Số lượt/ }), { target: { value: '5' } });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Lý do/ }), { target: { value: 'Bù lượt do lỗi chấm' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tiếp tục' }));
    const confirm = await screen.findByRole('dialog', { name: 'Xác nhận điều chỉnh' });
    expect(within(confirm).getByText(/Cộng 5 lượt vào khoá “IELTS 6\.5”/)).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Xác nhận' }));
    await balanceIs('47 lượt');
    expect(api.post).toHaveBeenCalledTimes(1);
    const [path, body] = api.post.mock.calls[0];
    expect(path).toBe('/admin/credits/adjust');
    expect(body).toMatchObject({ entitlement_id: E1, delta: 5, reason: 'Bù lượt do lỗi chấm' });
    expect(body.request_key).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.getByText('Đã ghi điều chỉnh vào sổ lượt.')).toBeTruthy();
    expect(screen.getByText('Cô Lan · Bù lượt do lỗi chấm')).toBeTruthy();
  });

  it('a short reason or a non-integer stays in the form', async () => {
    const dialog = await openAdjust();
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Số lượt/ }), { target: { value: '2.5' } });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Lý do/ }), { target: { value: 'Bù lượt do lỗi chấm' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tiếp tục' }));
    expect(within(dialog).getByRole('alert').textContent).toBe('Số lượt phải là số nguyên dương.');
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Số lượt/ }), { target: { value: '3' } });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Lý do/ }), { target: { value: 'ngắn' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tiếp tục' }));
    expect(within(dialog).getByRole('alert').textContent).toBe('Lý do cần ít nhất 10 ký tự.');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('a refused subtraction shows the server message as it is; a retry reuses the key', async () => {
    api.post.mockReset().mockRejectedValue(new Error('Không trừ được: số lượt còn lại ít hơn số muốn trừ.'));
    const dialog = await openAdjust();
    fireEvent.click(within(dialog).getByRole('radio', { name: /Trừ/ }));
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Số lượt/ }), { target: { value: '500' } });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Lý do/ }), { target: { value: 'Thu lại lượt cấp nhầm' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tiếp tục' }));
    const confirm = await screen.findByRole('dialog', { name: 'Xác nhận điều chỉnh' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Xác nhận' }));
    await waitFor(() => expect(within(confirm).getByRole('alert').textContent)
      .toBe('Không trừ được: số lượt còn lại ít hơn số muốn trừ.'));
    fireEvent.click(within(confirm).getByRole('button', { name: 'Xác nhận' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(api.post.mock.calls[0][1].delta).toBe(-500);
    expect(api.post.mock.calls[1][1].request_key).toBe(api.post.mock.calls[0][1].request_key);
    expect(cardBalance()).toBe('42 lượt');
  });
  it('a late "Tải thêm" answer for an earlier learner is dropped', async () => {
    const U2 = '40000000-0000-4000-8000-000000000002';
    let releaseMore: (value: unknown) => void = () => {};
    api.getWith.mockImplementation((path: string) => {
      if (path.endsWith('/access')) return Promise.resolve(access(balance));
      if (path.includes('cursor=')) return new Promise((resolve) => { releaseMore = resolve; });
      if (path.startsWith(`/admin/users/${U}/credits`)) return Promise.resolve({ ...credits(balance), next_cursor: '7' });
      return Promise.resolve({ balance: 3, next_cursor: null, items: [
        { at: '2026-11-22T03:00:00Z', delta: 3, reason: 'grant', label_vi: 'Cộng kèm mã lớp', balance_after: 3,
          course_code: 'C1', feature: null, note: null, entitlement_id: E1, actor: null }] });
    });
    const view = render(<AdminCredits />);
    fireEvent.click(await screen.findByRole('button', { name: 'Tải thêm' }));
    nav.search = `ref=u-${U2}`;
    view.rerender(<AdminCredits />);
    await screen.findByText('Cộng kèm mã lớp');
    releaseMore({ balance: 42, next_cursor: null, items: [
      { at: '2026-10-01T03:00:00Z', delta: 9, reason: 'grant_extra', label_vi: 'Cấp thêm bởi admin', balance_after: 9,
        course_code: 'C6', feature: null, note: 'của học viên trước', entitlement_id: E1, actor: null }] });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText('Cấp thêm bởi admin')).toBeNull();
    expect(screen.getByRole('table').querySelectorAll('tbody tr')).toHaveLength(1);
  });

  it('re-confirming the same adjustment after a timeout keeps the key; a changed one gets a new key', async () => {
    api.post.mockReset().mockRejectedValueOnce(new Error('Hết thời gian chờ máy chủ.'))
      .mockImplementation(() => { balance = 47; return Promise.resolve({ status: 'replay', balance: 47 }); });
    const dialog = await openAdjust();
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Số lượt/ }), { target: { value: '5' } });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Lý do/ }), { target: { value: 'Bù lượt do lỗi chấm' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tiếp tục' }));
    let confirm = await screen.findByRole('dialog', { name: 'Xác nhận điều chỉnh' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Xác nhận' }));
    await waitFor(() => expect(within(confirm).getByRole('alert').textContent).toBe('Hết thời gian chờ máy chủ.'));
    fireEvent.click(within(confirm).getByRole('button', { name: 'Quay lại' }));
    const again = screen.getByRole('dialog', { name: 'Điều chỉnh lượt' });
    fireEvent.click(within(again).getByRole('button', { name: 'Tiếp tục' }));
    confirm = await screen.findByRole('dialog', { name: 'Xác nhận điều chỉnh' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Xác nhận' }));
    await balanceIs('47 lượt');
    expect(api.post).toHaveBeenCalledTimes(2);
    expect(api.post.mock.calls[1][1].request_key).toBe(api.post.mock.calls[0][1].request_key);

    // After the server confirmed it, the same values are a new adjustment.
    fireEvent.click(screen.getByRole('button', { name: 'Điều chỉnh lượt' }));
    const next = screen.getByRole('dialog', { name: 'Điều chỉnh lượt' });
    fireEvent.change(within(next).getByRole('textbox', { name: /Số lượt/ }), { target: { value: '5' } });
    fireEvent.change(within(next).getByRole('textbox', { name: /Lý do/ }), { target: { value: 'Bù lượt do lỗi chấm' } });
    fireEvent.click(within(next).getByRole('button', { name: 'Tiếp tục' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Xác nhận điều chỉnh' })).getByRole('button', { name: 'Xác nhận' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(3));
    expect(api.post.mock.calls[2][1].request_key).not.toBe(api.post.mock.calls[0][1].request_key);
  });
});

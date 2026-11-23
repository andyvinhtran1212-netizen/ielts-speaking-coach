// ENROLL-0060 FR-037…FR-040, FR-055, FR-056 (sheet ThanhToan screens 2–6):
// /enroll/[orderCode].
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  value: { status: 'signed-in', user: { id: 'A', email: 'minhanh@x.test' } } as { status: string; user: { id: string; email: string } | null },
}));
vi.mock('client-only', () => ({}));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => auth.value }));

import { EnrollOrderPage, POLL_LIMIT_MS, POLL_MS } from '@/app/(authed-v2-enroll)/enroll/[orderCode]/enroll-order-page';

const CODE = 'AVER-ABC234';
const ORDER_PATH = `/api/enrollment-orders/${CODE}`;
const apiError = (status: number, detail: unknown) => Object.assign(new Error('HTTP'), { status, detail });

const order = (over: object = {}) => ({
  order_code: CODE, status: 'awaiting_transfer', product: { slug: 'writing-6', title: 'Khoá Writing for IELTS', short_title: 'Writing' },
  tuition_vnd: 10000, access_days: 90, ai_credits: 40, credit_valid_days: 90,
  pay_by: '2026-11-25T05:00:00Z', created_at: '2026-11-23T05:00:00Z',
  transfer_reported_at: null, late_transfer_reported_at: null, confirmed_at: null, info_kind: null,
  received_vnd: null, overpaid_vnd: null, admin_message: null, supplement_by: null,
  cancel_reason: null, cancel_note: null, cancelled_at: null, entitlement_expires_at: null, credits_granted: null,
  // Test-only account number (giả), never a real one.
  transfer: { bank_name: 'Ngân hàng thử', account_no: '0123 4567 89', account_name: 'AVER THU', amount_vnd: 10000, memo: CODE, vietqr_payload: null },
  ...over,
});

let current: Record<string, unknown> = order();
let readError: unknown = null;
let courses: unknown = { items: [] };
const replies: Record<string, unknown> = {};
const postErrors: Record<string, unknown> = {};
const reads: string[] = [];
const posts: Array<{ path: string; body: unknown }> = [];

const getWith = vi.fn(async (path: string) => {
  reads.push(path);
  if (path === ORDER_PATH) {
    if (readError) throw readError;
    return { order: current };
  }
  if (path === '/api/me/courses') return courses;
  throw new Error(`unexpected ${path}`);
});
const postWith = vi.fn(async (path: string, body: unknown) => {
  posts.push({ path, body });
  if (postErrors[path]) throw postErrors[path];
  return replies[path] ?? { order: current };
});
const replace = vi.fn();
const writeText = vi.fn(async () => {});
let visibility: DocumentVisibilityState = 'visible';

async function settle() {
  await act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
async function mount() {
  const view = render(<EnrollOrderPage code={CODE} />);
  await settle();
  return view;
}

const original = window.location;
beforeAll(() => {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { showModal: () => void; close: () => void };
  proto.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  proto.close = function (this: HTMLDialogElement) { this.removeAttribute('open'); };
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
});
beforeEach(() => {
  auth.value = { status: 'signed-in', user: { id: 'A', email: 'minhanh@x.test' } };
  current = order();
  readError = null;
  courses = { items: [] };
  for (const k of Object.keys(replies)) delete replies[k];
  for (const k of Object.keys(postErrors)) delete postErrors[k];
  reads.length = 0;
  posts.length = 0;
  visibility = 'visible';
  replace.mockClear();
  writeText.mockClear();
  (window as any).api = { getWith, postWith };
  Object.defineProperty(window, 'location', { configurable: true, value: { ...original, replace } });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (window as any).api;
  Object.defineProperty(window, 'location', { configurable: true, value: original });
});

describe('/enroll/[orderCode] screen 2 (awaiting_transfer)', () => {
  it('shows the hold time from pay_by, the email line, the manual block and no QR image', async () => {
    await mount();
    expect(screen.getByRole('heading', { level: 1, name: `Chuyển khoản cho đơn ${CODE}` })).toBeTruthy();
    expect(screen.getByText(/Thông tin chuyển khoản này cũng đã gửi tới minhanh@x\.test ngay khi tạo đơn/)).toBeTruthy();
    expect(screen.getByText(/Đơn đang được giữ tới 12:00, ngày 25\/11\/2026/)).toBeTruthy();
    expect(screen.getByText(/48 giờ kể từ lúc tạo/)).toBeTruthy();
    expect(screen.getByText(`Ghi đúng nội dung chuyển khoản: ${CODE}`)).toBeTruthy();
    expect(document.querySelector('img, svg[data-qr]')).toBeNull();
  });

  it('"Sao chép" writes the raw account number and amount, says so through role=status, and resets after 3 s', async () => {
    await mount();
    vi.useFakeTimers();
    const account = screen.getByText('Số tài khoản').closest('div')!;
    await act(async () => { fireEvent.click(within(account).getByRole('button', { name: 'Sao chép' })); });
    expect(writeText).toHaveBeenLastCalledWith('0123456789');
    expect(within(account).getByRole('button', { name: 'Đã sao chép' })).toBeTruthy();
    expect(within(account).getByRole('status').textContent).toBe('Đã sao chép số tài khoản.');
    const amount = screen.getByText('Số tiền').closest('div')!;
    await act(async () => { fireEvent.click(within(amount).getByRole('button', { name: 'Sao chép' })); });
    expect(writeText).toHaveBeenLastCalledWith('10000');
    await act(async () => { vi.advanceTimersByTime(3_000); });
    expect(within(account).getByRole('button', { name: 'Sao chép' })).toBeTruthy();
  });

  it('"Tôi đã chuyển khoản" posts once and shows the screen the server returns', async () => {
    replies[`${ORDER_PATH}/report-transfer`] = { order: order({ status: 'transfer_reported', transfer_reported_at: '2026-11-23T06:00:00Z' }), late: false };
    await mount();
    const button = screen.getByRole('button', { name: 'Tôi đã chuyển khoản' });
    await act(async () => { fireEvent.click(button); fireEvent.click(button); });
    await settle();
    expect(posts).toEqual([{ path: `${ORDER_PATH}/report-transfer`, body: {} }]);
    expect(screen.getByRole('heading', { level: 1, name: 'Đã ghi nhận, đang chờ xác nhận' })).toBeTruthy();
  });

  it('no transfer settings: a notice instead of the block, and the report button is off', async () => {
    current = order({ transfer: null });
    await mount();
    expect(screen.getByText('Chưa có thông tin chuyển khoản')).toBeTruthy();
    expect(screen.queryByText('Số tài khoản')).toBeNull();
    expect((screen.getByRole('button', { name: 'Tôi đã chuyển khoản' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('"Huỷ đơn này" asks once with the sheet text; "Giữ đơn" posts nothing, "Huỷ đơn" cancels', async () => {
    replies[`${ORDER_PATH}/cancel`] = { order: order({ status: 'cancelled', cancel_reason: 'learner', cancelled_at: '2026-11-23T08:00:00Z' }) };
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Huỷ đơn này' }));
    const dialog = screen.getByRole('alertdialog', { name: `Huỷ đơn ${CODE}?` });
    expect(dialog.textContent).toContain('Nếu bạn đã chuyển tiền, đừng huỷ mà báo đã chuyển.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Giữ đơn' }));
    expect(posts).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Huỷ đơn này' }));
    await act(async () => { fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Huỷ đơn' })); });
    await settle();
    expect(posts.map((p) => p.path)).toEqual([`${ORDER_PATH}/cancel`]);
    expect(screen.getByRole('heading', { level: 1, name: `Đơn ${CODE} đã huỷ` })).toBeTruthy();
    expect(screen.getByText('Bạn đã bấm “Huỷ đơn này” lúc 15:00, ngày 23/11/2026.')).toBeTruthy();
  });

  it('409 invalid_transition reads the order again and says it moved on', async () => {
    postErrors[`${ORDER_PATH}/report-transfer`] = apiError(409, { error_code: 'invalid_transition' });
    await mount();
    current = order({ status: 'confirmed', confirmed_at: '2026-11-23T07:00:00Z', credits_granted: 40 });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Tôi đã chuyển khoản' })); });
    await settle();
    expect(screen.getByText('Đơn đăng ký này vừa đổi trạng thái. Trang đã cập nhật.')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Khoá Writing for IELTS đã mở' })).toBeTruthy();
  });
});

describe('/enroll/[orderCode] screen 3 (transfer_reported, needs_info)', () => {
  it('waiting: what happens next, the free Library line, and no "Học trước" block', async () => {
    current = order({ status: 'transfer_reported', transfer_reported_at: '2026-11-23T06:00:00Z' });
    await mount();
    expect(screen.getByRole('heading', { level: 1, name: 'Đã ghi nhận, đang chờ xác nhận' })).toBeTruthy();
    expect(screen.getByText('Trong lúc chờ, Thư viện vẫn mở miễn phí.')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Học trước/);
    expect(screen.getByText(/Bạn báo đã chuyển khoản · 13:00, ngày 23\/11\/2026/)).toBeTruthy();
  });

  it('FR-040: asks again every 20 s while visible, pauses while hidden, and turns to screen 4 by itself', async () => {
    current = order({ status: 'transfer_reported' });
    vi.useFakeTimers({ shouldAdvanceTime: false });
    render(<EnrollOrderPage code={CODE} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const orderReads = () => reads.filter((p) => p === ORDER_PATH).length;
    expect(orderReads()).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS); });
    expect(orderReads()).toBe(2);
    visibility = 'hidden';
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS * 3); });
    expect(orderReads()).toBe(2);
    current = order({ status: 'confirmed', confirmed_at: '2026-11-23T07:00:00Z', entitlement_expires_at: '2027-02-21T16:59:59Z', credits_granted: 40 });
    visibility = 'visible';
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(0); });
    expect(orderReads()).toBe(3);
    expect(screen.getByRole('heading', { level: 1, name: 'Khoá Writing for IELTS đã mở' })).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS * 3); });
    expect(orderReads()).toBe(3);
  });

  it('FR-040: stops for good after 30 minutes and says the learner need not stay; "Kiểm tra lại" reads once more', async () => {
    current = order({ status: 'transfer_reported' });
    vi.useFakeTimers({ shouldAdvanceTime: false });
    render(<EnrollOrderPage code={CODE} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_LIMIT_MS + POLL_MS); });
    const count = reads.filter((p) => p === ORDER_PATH).length;
    expect(screen.getByText('Trang đã ngừng tự kiểm tra. Bạn không cần ở lại trang này.')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS * 5); });
    expect(reads.filter((p) => p === ORDER_PATH).length).toBe(count);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra lại' })); await vi.advanceTimersByTimeAsync(0); });
    expect(reads.filter((p) => p === ORDER_PATH).length).toBe(count + 1);
  });

  it('needs_info underpaid: the three numbers, the deadline, the admin message verbatim as text, and a checked supplement', async () => {
    current = order({
      status: 'needs_info', info_kind: 'underpaid', tuition_vnd: 1200000, received_vnd: 1000000,
      admin_message: 'Bạn chuyển thêm <b>200.000 đ</b> nhé.', supplement_by: '2026-11-26T05:00:00Z',
    });
    replies[`${ORDER_PATH}/supplement`] = { order: order({ status: 'transfer_reported' }) };
    await mount();
    expect(screen.getByRole('heading', { name: 'Thiếu tiền · chưa mở khoá' })).toBeTruthy();
    expect(screen.getByText(/Đã nhận 1\.000\.000 đ, đơn cần 1\.200\.000 đ, còn thiếu/)).toBeTruthy();
    expect(screen.getByText('200.000 đ')).toBeTruthy();
    expect(screen.getByText(/trước 12:00, ngày 26\/11\/2026/)).toBeTruthy();
    expect(screen.getByText('Bạn chuyển thêm <b>200.000 đ</b> nhé.')).toBeTruthy();
    expect(document.querySelector('b')).toBeNull();
    fireEvent.change(screen.getByLabelText('Bạn đã bổ sung gì?'), { target: { value: 'ok' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tôi đã bổ sung' }));
    expect(screen.getByText('Ghi chú cần ít nhất 3 ký tự.')).toBeTruthy();
    expect(posts).toEqual([]);
    fireEvent.change(screen.getByLabelText('Bạn đã bổ sung gì?'), { target: { value: '  Đã chuyển thêm 200.000 đ lúc 14:30  ' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Tôi đã bổ sung' })); });
    await settle();
    expect(posts).toEqual([{ path: `${ORDER_PATH}/supplement`, body: { note: 'Đã chuyển thêm 200.000 đ lúc 14:30' } }]);
    expect(screen.getByText('Đã gửi phần bổ sung. Admin sẽ đối chiếu lại đơn này.')).toBeTruthy();
  });

  it('needs_info not_found: says not to transfer again', async () => {
    current = order({ status: 'needs_info', info_kind: 'not_found' });
    await mount();
    expect(screen.getByRole('heading', { name: 'Chưa tìm thấy khoản chuyển khớp mã đơn' })).toBeTruthy();
    expect(screen.getByText(/Bạn không cần chuyển lại\./)).toBeTruthy();
  });
});

describe('/enroll/[orderCode] screen 4 (confirmed)', () => {
  const confirmed = (over: object = {}) => order({
    status: 'confirmed', confirmed_at: '2026-11-23T07:00:00Z', entitlement_expires_at: '2027-02-21T16:59:59Z', credits_granted: 40, transfer: null, ...over,
  });

  it('access date, credits, the activated line, and the carry line from /api/me/courses for this course', async () => {
    current = confirmed();
    courses = { items: [{ product_slug: 'writing-6', credits: { carry_balance: 7, carry_expires_at: '2026-12-30T16:59:59Z' } }] };
    await mount();
    expect(screen.getByText('hết ngày 21/02/2027')).toBeTruthy();
    expect(screen.getByText(/40 lượt · cộng vào số lượt bạn đang có; Writing và Speaking dùng chung/)).toBeTruthy();
    expect(screen.getByText('Chuyển từ kỳ trước: 7 lượt, dùng đến 30/12/2026')).toBeTruthy();
    expect(screen.getByText(/Đã kích hoạt\. Mở luôn phần luyện Reading, Listening, ngữ pháp và từ vựng/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Bắt đầu học' }).getAttribute('href')).toBe('/home');
    expect(screen.getByRole('link', { name: 'Xem đơn đăng ký của tôi' }).getAttribute('href')).toBe('/account/orders');
  });

  it('carry_balance=0: no carry line and no "50%"', async () => {
    current = confirmed();
    courses = { items: [{ product_slug: 'writing-6', credits: { carry_balance: 0, carry_expires_at: null } }] };
    await mount();
    expect(document.body.textContent).not.toMatch(/Chuyển từ kỳ trước/);
    expect(document.body.textContent).not.toMatch(/50%/);
  });

  it('overpaid: the "Thừa tiền · đã mở khoá" block with the real numbers', async () => {
    current = confirmed({ received_vnd: 1300000, tuition_vnd: 1200000, overpaid_vnd: 100000 });
    await mount();
    expect(screen.getByRole('heading', { name: 'Thừa tiền · đã mở khoá' })).toBeTruthy();
    expect(screen.getByText(/Đã nhận 1\.300\.000 đ, đơn cần 1\.200\.000 đ, thừa/)).toBeTruthy();
  });
});

describe('/enroll/[orderCode] screen 5 (expired, cancelled)', () => {
  it('expired: do not transfer again; "Tôi đã chuyển cho đơn này" records a late report; "Tạo đơn mới" waits for a live page', async () => {
    current = order({ status: 'expired' });
    replies[`${ORDER_PATH}/report-transfer`] = { order: order({ status: 'expired', late_transfer_reported_at: '2026-11-25T06:00:00Z' }), late: true };
    await mount();
    expect(screen.getByRole('heading', { level: 1, name: `Đơn ${CODE} đã hết thời gian giữ` })).toBeTruthy();
    expect(screen.getByText('Sau 48 giờ chưa có báo chuyển khoản nên đơn tự đóng.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Tạo đơn mới' })).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Tôi đã chuyển cho đơn này' })); });
    await settle();
    expect(posts.map((p) => p.path)).toEqual([`${ORDER_PATH}/report-transfer`]);
    expect(screen.getByText('Đã ghi nhận bạn báo đã chuyển lúc 13:00, ngày 25/11/2026. Admin sẽ đối chiếu theo mã đơn.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tôi đã chuyển cho đơn này' })).toBeNull();
  });

  it('cancelled by admin: says so with the admin note verbatim, never the learner sentence', async () => {
    current = order({ status: 'cancelled', cancel_reason: 'admin', cancel_note: 'Không thấy khoản chuyển sau hạn bổ sung.', cancelled_at: '2026-11-27T05:00:00Z' });
    await mount();
    expect(screen.getByText(/Admin đã huỷ đơn này lúc 12:00, ngày 27\/11\/2026/)).toBeTruthy();
    expect(screen.getByText('Không thấy khoản chuyển sau hạn bổ sung.')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Bạn đã bấm/);
  });
});

describe('/enroll/[orderCode] errors and accounts', () => {
  it('404 order_not_found goes to /account/orders with the not-found banner flag', async () => {
    readError = apiError(404, { error_code: 'order_not_found' });
    await mount();
    expect(replace).toHaveBeenCalledWith('/account/orders?khong-tim-thay');
  });

  it('another failure shows an error with "Thử lại", never a screen', async () => {
    readError = apiError(503, { error_code: 'orders_unavailable' });
    await mount();
    expect(screen.getByText('Chưa tải được đơn đăng ký')).toBeTruthy();
    readError = null;
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    await settle();
    expect(screen.getByRole('heading', { level: 1, name: `Chuyển khoản cho đơn ${CODE}` })).toBeTruthy();
  });

  it('a session switch drops the order in the same render; signed out → /login', async () => {
    const view = await mount();
    expect(screen.getByText(`Ghi đúng nội dung chuyển khoản: ${CODE}`)).toBeTruthy();
    getWith.mockImplementationOnce(async (path: string) => { reads.push(path); return new Promise(() => {}); });
    auth.value = { status: 'signed-in', user: { id: 'B', email: 'b@x.test' } };
    view.rerender(<EnrollOrderPage code={CODE} />);
    expect(screen.queryByText(`Ghi đúng nội dung chuyển khoản: ${CODE}`)).toBeNull();
    auth.value = { status: 'signed-out', user: null };
    view.rerender(<EnrollOrderPage code={CODE} />);
    await settle();
    expect(replace).toHaveBeenCalledWith('/login');
  });
});

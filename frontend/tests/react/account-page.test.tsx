// LEARNERCORE-0063 FR-060 / FR-087 / FR-089: /account (Tài khoản).
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('client-only', () => ({}));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => state.auth }));

const state = vi.hoisted(() => ({
  auth: { status: 'signed-in', user: { id: 'A', email: 'a@x.test' } } as { status: string; user: { id: string; email: string } | null },
  clsFails: false,
  courses: null as unknown,
  coursesStatus: 404,
  credits: [] as unknown[],
  cls: { has_class: false } as unknown,
}));
const urls: string[] = [];

const getWithImpl = async (path: string) => {
  urls.push(path);
  if (path === '/api/me/courses') {
    if (state.courses === null) throw Object.assign(new Error('HTTP'), { status: state.coursesStatus });
    return state.courses;
  }
  if (path.startsWith('/api/me/credits')) {
    const page = path.includes('cursor=') ? state.credits[1] : state.credits[0];
    if (!page) throw Object.assign(new Error('HTTP 404'), { status: 404 });
    return page;
  }
  if (path === '/api/account/deletion-request') {
    // ACCOUNTDATA-0100 routes not deployed (staging today): blocks hidden.
    throw Object.assign(new Error('HTTP 404'), { status: 404 });
  }
  if (path.startsWith('/api/class/me')) {
    if (state.clsFails) throw Object.assign(new Error('HTTP 503'), { status: 503 });
    return state.cls;
  }
  throw new Error(`unexpected ${path}`);
};
const getWith = vi.fn(getWithImpl);

import { AccountPage } from '@/app/(authed-v2-account)/account/account-page';

async function mount() {
  render(<AccountPage />);
  await act(async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0)); });
}

const course = (over: object) => ({
  course_code: 'W6', product_slug: 'writing-6', title: 'Writing 6.5', short_title: null, kind: 'online', source: 'enrollment_order',
  state: 'active', starts_at: '2026-11-01T00:00:00Z', expires_at: '2026-12-01T00:00:00Z', days_left: 8, review_mode: null,
  can_renew: true, renew_order_code: null,
  credits: { balance: 11, usable_from: null, usable_until: null, carry_balance: 0, carry_expires_at: null },
  ...over,
});
const coursesPayload = (over: object = {}) => ({
  items: [
    course({}),
    course({ course_code: 'C1', title: 'Lớp IELTS tối 2-4-6', kind: 'class', source: 'access_code', can_renew: true, days_left: 40 }),
  ],
  credits: { total: 17, by_kind: { online: 11, class: 6 } },
  content_visible_until: null,
  content_days_after_expiry: null,
  ...over,
});
const creditRow = (over: object) => ({
  at: '2026-11-20T03:00:00Z', delta: -1, reason: 'reserve', balance_after: 17, course_code: 'W6',
  feature: 'writing', label_vi: 'Chấm bài', note: null, ...over,
});

beforeEach(() => {
  getWith.mockImplementation(getWithImpl);
  state.auth = { status: 'signed-in', user: { id: 'A', email: 'a@x.test' } };
  state.clsFails = false;
  state.courses = null;
  state.coursesStatus = 404;
  state.credits = [];
  state.cls = { has_class: false };
  urls.length = 0;
  (window as any).api = { getWith, get: getWith };
});
afterEach(() => { cleanup(); delete (window as any).api; });

describe('/account', () => {
  it('credit history: one shared balance column, the server label verbatim, no skill column, "Xem thêm"', async () => {
    state.courses = coursesPayload();
    state.credits = [
      {
        balance: 17,
        items: [
          creditRow({ label_vi: 'Chấm bài' }),
          creditRow({ at: '2026-11-01T03:00:00Z', delta: 4, reason: 'grant', balance_after: 18, label_vi: 'Cộng khi mở khoá' }),
        ],
        next_cursor: 'c2',
      },
      { balance: 17, items: [creditRow({ at: '2026-10-01T03:00:00Z', delta: 3, reason: 'carry_over', balance_after: 14, label_vi: 'Chuyển lượt chưa dùng từ kỳ trước khi đăng ký lại' })], next_cursor: null },
    ];
    await mount();
    const table = screen.getByRole('table');
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Ngày', 'Nội dung', 'Thay đổi', 'Còn lại']);
    expect(within(table).getByText('Chấm bài')).toBeTruthy();
    expect(within(table).getByText('Cộng khi mở khoá')).toBeTruthy();
    expect(within(table).getByText('−1')).toBeTruthy();
    expect(within(table).getByText('18')).toBeTruthy();
    expect(table.textContent).not.toMatch(/Writing|Speaking/);
    expect(urls).toContain('/api/me/credits?limit=20');

    fireEvent.click(screen.getByRole('button', { name: 'Xem thêm' }));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(urls).toContain('/api/me/credits?limit=20&cursor=c2');
    expect(within(table).getByText('Chuyển lượt chưa dùng từ kỳ trước khi đăng ký lại')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Xem thêm' })).toBeNull();
    expect(document.body.textContent).not.toContain('50%');
  });

  it('one shared number for Writing and Speaking, split by source', async () => {
    state.courses = coursesPayload();
    state.credits = [{ balance: 17, items: [], next_cursor: null }];
    await mount();
    const block = screen.getByRole('region', { name: 'Lượt chấm AI còn lại' });
    expect(block.textContent).toContain('17 lượt');
    expect(block.textContent).toContain('Dùng chung cho Writing và Speaking.');
    expect(block.textContent).toContain('Từ khoá online11 lượt');
    expect(block.textContent).toContain('Từ khoá của lớp6 lượt');
    expect(screen.getByText('Chưa có lượt nào được cộng hay dùng.')).toBeTruthy();
  });

  it('a class course says "Mã do admin cấp" and never offers "Đăng ký lại", even with can_renew', async () => {
    state.courses = coursesPayload({ items: [course({ kind: 'class', title: 'Lớp IELTS tối 2-4-6', can_renew: true })] });
    state.credits = [{ balance: 6, items: [], next_cursor: null }];
    await mount();
    const classes = screen.getByRole('region', { name: 'Khoá của lớp' });
    expect(within(classes).getByText('Mã do admin cấp')).toBeTruthy();
    expect(screen.queryByText('Đăng ký lại')).toBeNull();
    expect(screen.getByText('Bạn chưa có khoá online nào.')).toBeTruthy();
  });

  it('kind=null rows (class membership, legacy class code) land in "Khoá của lớp", not dropped', async () => {
    state.courses = coursesPayload({ items: [
      course({ course_code: 'M1', title: 'Lớp sáng 3-5-7', kind: null, source: 'class_membership', can_renew: false, days_left: null }),
      course({ course_code: 'L1', title: 'Lớp mã cũ', kind: null, source: 'legacy_access_code', can_renew: false, days_left: 12 }),
    ] });
    state.credits = [{ balance: 0, items: [], next_cursor: null }];
    await mount();
    const classes = screen.getByRole('region', { name: 'Khoá của lớp' });
    expect(within(classes).getByText('Lớp sáng 3-5-7')).toBeTruthy();
    expect(within(classes).getByText('Lớp mã cũ')).toBeTruthy();
    expect(within(classes).queryByText('Bạn chưa ở lớp nào.')).toBeNull();
    expect(screen.getByText('Bạn chưa có khoá online nào.')).toBeTruthy();
  });

  it('carry_balance 7 prints the carried line, 0 prints nothing', async () => {
    state.courses = coursesPayload({
      items: [course({ credits: { balance: 11, carry_balance: 7, carry_expires_at: '2027-01-30T16:59:59Z' } })],
    });
    state.credits = [{ balance: 11, items: [], next_cursor: null }];
    await mount();
    expect(screen.getByText('Trong đó 7 lượt chuyển từ kỳ trước, dùng đến hết 30/01/2027.')).toBeTruthy();
    cleanup();
    state.courses = coursesPayload();
    await mount();
    expect(screen.queryByText(/lượt chuyển từ kỳ trước/)).toBeNull();
  });

  it('content_visible_until set → the cut-off line; null → no line', async () => {
    state.courses = coursesPayload({ content_visible_until: '2027-01-14T16:59:59Z', content_days_after_expiry: 45 });
    state.credits = [{ balance: 17, items: [], next_cursor: null }];
    await mount();
    expect(screen.getByText(/Bài đã nộp và nhận xét xem được đến hết 14\/01\/2027\./)).toBeTruthy();
    cleanup();
    state.courses = coursesPayload();
    await mount();
    expect(screen.queryByText(/xem được đến hết/)).toBeNull();
  });

  it('G04 not there: the class group from /api/class/me, the online sentence, and no credit number (never 0)', async () => {
    state.cls = { has_class: true, classes: [{ id: 'k1', name: 'Lớp IELTS tối 2-4-6', course: { code: 'I6', name: 'IELTS 6.5' } }] };
    await mount();
    expect(screen.getByText('Thông tin khoá online sẽ có khi bạn đăng ký.')).toBeTruthy();
    const classes = screen.getByRole('region', { name: 'Khoá của lớp' });
    expect(within(classes).getByText('Lớp IELTS tối 2-4-6')).toBeTruthy();
    expect(within(classes).getByText('IELTS 6.5')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Lượt chấm AI còn lại' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Lịch sử lượt' })).toBeNull();
    expect(document.body.textContent).not.toMatch(/\b0 lượt/);
    expect(urls.some((u) => u.startsWith('/api/me/credits'))).toBe(false);
  });

  it('G04-T18 not merged: no "Dữ liệu của tôi" block, no delete request, no PDF download', async () => {
    state.courses = coursesPayload();
    state.credits = [{ balance: 17, items: [], next_cursor: null }];
    await mount();
    expect(screen.queryByText('Dữ liệu của tôi')).toBeNull();
    expect(screen.queryByText(/Yêu cầu xoá tài khoản/)).toBeNull();
    expect(screen.queryByText(/Tải các phiếu/)).toBeNull();
  });

  it('a failing /api/me/courses (503) says so instead of pretending there is no course', async () => {
    state.coursesStatus = 503;
    await mount();
    expect(screen.getByText('Chưa tải được thông tin khoá. Tải lại trang để thử lại.')).toBeTruthy();
    expect(screen.queryByText('Thông tin khoá online sẽ có khi bạn đăng ký.')).toBeNull();
  });

  it('planned pages are never linked: no "Đăng ký lại" or action without a live target', async () => {
    state.courses = coursesPayload();
    state.credits = [{ balance: 17, items: [], next_cursor: null }];
    await mount();
    expect(screen.queryByRole('link', { name: 'Đăng ký lại' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Nhập mã kích hoạt của lớp' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Đơn đăng ký của tôi' })).toBeNull();
    expect(screen.getByText('Còn 8 ngày')).toBeTruthy();
  });

  it('G04 not there and the class read fails or is degraded: a warning, never "Bạn chưa ở lớp nào"', async () => {
    state.clsFails = true;
    await mount();
    let classes = screen.getByRole('region', { name: 'Khoá của lớp' });
    expect(within(classes).getByText('Chưa tải đủ thông tin lớp của bạn. Tải lại trang để thử lại.')).toBeTruthy();
    expect(within(classes).queryByText('Bạn chưa ở lớp nào.')).toBeNull();
    cleanup();
    state.clsFails = false;
    state.cls = { has_class: true, degraded: ['class'], classes: [{ id: 'k1', name: null }] };
    await mount();
    classes = screen.getByRole('region', { name: 'Khoá của lớp' });
    expect(within(classes).getByText('Chưa tải đủ thông tin lớp của bạn. Tải lại trang để thử lại.')).toBeTruthy();
    expect(within(classes).queryByText('Bạn chưa ở lớp nào.')).toBeNull();
    cleanup();
    state.cls = { has_class: false };
    await mount();
    classes = screen.getByRole('region', { name: 'Khoá của lớp' });
    expect(within(classes).getByText('Bạn chưa ở lớp nào.')).toBeTruthy();
    expect(within(classes).queryByText(/Chưa tải đủ/)).toBeNull();
  });

  it('a session change drops the previous account\'s courses and credits in the same render; signed out → /login', async () => {
    state.courses = coursesPayload();
    state.credits = [{ balance: 17, items: [creditRow({})], next_cursor: null }];
    const view = render(<AccountPage />);
    await act(async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.getByText('Writing 6.5')).toBeTruthy();
    expect(screen.getByRole('table')).toBeTruthy();
    const replace = vi.fn();
    Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, replace } });
    getWith.mockImplementation(async (path: string) => { urls.push(path); return new Promise(() => {}); });
    state.auth = { status: 'signed-in', user: { id: 'B', email: 'b@x.test' } };
    view.rerender(<AccountPage />);
    expect(screen.queryByText('Writing 6.5')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText(/17/)).toBeNull();
    state.auth = { status: 'signed-out', user: null };
    view.rerender(<AccountPage />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(replace).toHaveBeenCalledWith('/login');
    expect(screen.queryByText('Writing 6.5')).toBeNull();
  });
});

// ENROLL-0060 FR-041 (sheet ThanhToan screen 7): /account/orders.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ value: { status: 'signed-in', user: { id: 'A' } } as { status: string; user: { id: string } | null } }));
vi.mock('client-only', () => ({}));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => auth.value }));

import { OrdersPage } from '@/app/(authed-v2-orders)/account/orders/orders-page';

const urls: string[] = [];
let pages: Record<string, unknown> = {};
let failures: Record<string, number> = {};
const readFixture = async (path: string) => {
  urls.push(path);
  const key = new URL(path, 'https://x.test').searchParams.get('cursor') ?? 'first';
  if (failures[key]) { failures[key] -= 1; throw Object.assign(new Error('fail'), { status: 503 }); }
  return pages[key];
};
const getWith = vi.fn(readFixture);

const order = (over: object = {}) => ({
  order_code: 'AV-0001', status: 'awaiting_transfer', tuition_vnd: 1200000, created_at: '2026-11-22T18:30:00Z',
  product: { slug: 'writing-6', title: 'Writing 6.5 trong 8 tuần', short_title: 'Writing 6.5' }, ...over,
});

async function settle() {
  await act(async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0)); });
}
async function mount() {
  render(<OrdersPage />);
  await settle();
}

beforeEach(() => {
  auth.value = { status: 'signed-in', user: { id: 'A' } };
  getWith.mockImplementation(readFixture);
  urls.length = 0;
  pages = {};
  failures = {};
  (window as any).api = { getWith, get: getWith };
});
afterEach(() => { cleanup(); delete (window as any).api; });

describe('/account/orders', () => {
  it('a table, newest first: status labels from FR-037, money, date, and the first read asks for 20', async () => {
    pages.first = {
      items: [order(), order({ order_code: 'AV-0002', status: 'confirmed', tuition_vnd: 900000 }), order({ order_code: 'AV-0003', status: 'needs_info' })],
      next_cursor: null,
    };
    await mount();
    expect(urls).toEqual(['/api/enrollment-orders/me?limit=20']);
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('Chờ chuyển khoản')).toBeTruthy();
    expect(within(rows[0]).getByText('1.200.000 đ')).toBeTruthy();
    expect(within(rows[0]).getByText('23/11/2026')).toBeTruthy();
    expect(within(rows[0]).getByText('Writing 6.5')).toBeTruthy();
    expect(within(rows[1]).getByText('Đã mở khoá')).toBeTruthy();
    expect(within(rows[2]).getByText('Cần bổ sung')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Xem thêm' })).toBeNull();
  });

  it('exactly one next step link per row, by status (FR-041); "Vào học" goes to /home until /course is live', async () => {
    pages.first = {
      items: [
        order({ order_code: 'AV-0001', status: 'awaiting_transfer' }),
        order({ order_code: 'AV-0002', status: 'transfer_reported' }),
        order({ order_code: 'AV-0003', status: 'needs_info' }),
        order({ order_code: 'AV-0004', status: 'confirmed' }),
        order({ order_code: 'AV-0005', status: 'expired' }),
        order({ order_code: 'AV-0006', status: 'cancelled' }),
      ],
      next_cursor: null,
    };
    await mount();
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    const links = rows.map((row) => within(row).getAllByRole('link'));
    expect(links.map((l) => l.length)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(links.map((l) => l[0].textContent)).toEqual(['Tiếp tục thanh toán', 'Xem trạng thái', 'Xem hướng dẫn', 'Vào học', 'Xem chi tiết', 'Xem chi tiết']);
    expect(links[0][0].getAttribute('href')).toBe('/enroll/AV-0001');
    expect(links[3][0].getAttribute('href')).toBe('/home');
  });

  it('?khong-tim-thay (from /enroll) shows "Không tìm thấy đơn đăng ký này."', async () => {
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, search: '?khong-tim-thay' } });
    try {
      pages.first = { items: [], next_cursor: null };
      await mount();
      expect(screen.getByText('Không tìm thấy đơn đăng ký này.')).toBeTruthy();
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });

  it('empty: the message, no table, and no link to a page that is not live', async () => {
    pages.first = { items: [], next_cursor: null };
    await mount();
    expect(screen.getByRole('heading', { name: 'Bạn chưa đăng ký khoá nào.' })).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Xem các khoá online' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Nhập mã kích hoạt của lớp' })).toBeNull();
  });

  it('"Xem thêm" reads the next page with the cursor and appends; a failed page says so and keeps the rows', async () => {
    pages.first = { items: [order()], next_cursor: 'c 2' };
    pages['c 2'] = { items: [order({ order_code: 'AV-0009', status: 'expired' })], next_cursor: null };
    failures['c 2'] = 1;
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Xem thêm' }));
    await settle();
    expect(screen.getByRole('alert').textContent).toBe('Chưa tải thêm được. Thử lại.');
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Xem thêm' }));
    await settle();
    expect(urls.at(-1)).toBe('/api/enrollment-orders/me?limit=20&cursor=c%202');
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(3);
    expect(screen.getByText('Hết hạn')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Xem thêm' })).toBeNull();
  });

  it('a failed read or a foreign shape is an error with "Thử lại", never an empty list', async () => {
    failures.first = 1;
    pages.first = { items: [order()], next_cursor: null };
    await mount();
    expect(screen.getByText('Chưa tải được đơn đăng ký')).toBeTruthy();
    expect(screen.queryByText('Bạn chưa đăng ký khoá nào.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    await settle();
    expect(screen.getByRole('table')).toBeTruthy();

    cleanup();
    pages.first = { orders: [] };
    await mount();
    expect(screen.getByText('Chưa tải được đơn đăng ký')).toBeTruthy();
  });

  it('orders belong to one account: a switch drops A\'s rows in the same render and shows B\'s own read; signed out → /login', async () => {
    pages.first = { items: [order({ order_code: 'A-ORDER' })], next_cursor: null };
    const view = render(<OrdersPage />);
    await settle();
    expect(screen.getByText('A-ORDER')).toBeTruthy();

    // B's read is held, so nothing of A may show while it is pending.
    let releaseB: (value: unknown) => void = () => {};
    getWith.mockImplementation(async (path: string) => { urls.push(path); return new Promise((r) => { releaseB = r; }); });
    auth.value = { status: 'signed-in', user: { id: 'B' } };
    view.rerender(<OrdersPage />);
    expect(screen.queryByText('A-ORDER')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    await settle();
    await act(async () => { releaseB({ items: [order({ order_code: 'B-ORDER' })], next_cursor: null }); });
    await settle();
    expect(screen.getByText('B-ORDER')).toBeTruthy();
    expect(screen.queryByText('A-ORDER')).toBeNull();

    const original = window.location;
    const replace = vi.fn();
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, replace } });
    try {
      auth.value = { status: 'signed-out', user: null };
      view.rerender(<OrdersPage />);
      await settle();
      expect(replace).toHaveBeenCalledWith('/login');
      expect(screen.queryByText('B-ORDER')).toBeNull();
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });

  it('A\'s "Xem thêm" still pending when the session turns to B: its reply is dropped and B reads its own first page', async () => {
    pages.first = { items: [order({ order_code: 'A-ORDER' })], next_cursor: 'a2' };
    const view = render(<OrdersPage />);
    await settle();
    let releaseA: (value: unknown) => void = () => {};
    getWith.mockImplementation(async (path: string) => {
      urls.push(path);
      if (path.includes('cursor=a2')) return new Promise((r) => { releaseA = r; });
      return { items: [order({ order_code: 'B-ORDER' })], next_cursor: null };
    });
    fireEvent.click(screen.getByRole('button', { name: 'Xem thêm' }));
    await settle();
    auth.value = { status: 'signed-in', user: { id: 'B' } };
    view.rerender(<OrdersPage />);
    expect(screen.queryByText('A-ORDER')).toBeNull();
    await settle();
    await act(async () => { releaseA({ items: [order({ order_code: 'A-PAGE-2' })], next_cursor: null }); });
    await settle();
    expect(screen.getByText('B-ORDER')).toBeTruthy();
    expect(screen.queryByText('A-PAGE-2')).toBeNull();
    expect(screen.queryByText('A-ORDER')).toBeNull();
    expect(urls.filter((u) => u === '/api/enrollment-orders/me?limit=20')).toHaveLength(2);
  });
});

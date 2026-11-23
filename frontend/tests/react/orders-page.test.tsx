// ENROLL-0060 FR-041 (sheet ThanhToan screen 7): /account/orders.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OrdersPage } from '@/app/(authed-v2-orders)/account/orders/orders-page';

const urls: string[] = [];
let pages: Record<string, unknown> = {};
let failures: Record<string, number> = {};
const getWith = vi.fn(async (path: string) => {
  urls.push(path);
  const key = new URL(path, 'https://x.test').searchParams.get('cursor') ?? 'first';
  if (failures[key]) { failures[key] -= 1; throw Object.assign(new Error('fail'), { status: 503 }); }
  return pages[key];
});

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

  it('one next step per row, linked only to a live page: /enroll is planned, "Vào học" goes to /home', async () => {
    pages.first = { items: [order(), order({ order_code: 'AV-0002', status: 'confirmed' })], next_cursor: null };
    await mount();
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(within(rows[0]).queryByRole('link')).toBeNull();
    const links = within(rows[1]).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe('Vào học');
    expect(links[0].getAttribute('href')).toBe('/home');
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
});

// ENROLL-0060 FR-041 / FR-037: the "Đơn đăng ký của tôi" model.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatVnd, normalizeOrderPage, orderDateText, orderNextStep, orderStatusLabel } from '../lib/orders-model.mjs';

const row = (over = {}) => ({
  order_code: 'AV-0001', status: 'awaiting_transfer', tuition_vnd: 1200000, created_at: '2026-11-22T18:30:00Z',
  product: { slug: 'writing-6', title: 'Writing 6.5 trong 8 tuần', short_title: 'Writing 6.5' }, ...over,
});

test('a page keeps known rows, drops foreign ones, and reads next_cursor', () => {
  const page = normalizeOrderPage({ items: [row(), row({ order_code: '' }), row({ status: 'refunded' }), null], next_cursor: 'c2' });
  assert.deepEqual(page, {
    items: [{ code: 'AV-0001', status: 'awaiting_transfer', title: 'Writing 6.5 trong 8 tuần', shortTitle: 'Writing 6.5', tuition: 1200000, createdAt: '2026-11-22T18:30:00Z' }],
    nextCursor: 'c2',
  });
  assert.equal(normalizeOrderPage({ items: [], next_cursor: null }).nextCursor, null);
  assert.equal(normalizeOrderPage({ orders: [] }), null);
  assert.equal(normalizeOrderPage(null), null);
  assert.equal(normalizeOrderPage({ items: [row({ product: null })] }).items[0].title, 'AV-0001');
});

test('FR-037 labels, and exactly one next step per status', () => {
  const labels = ['awaiting_transfer', 'transfer_reported', 'needs_info', 'confirmed', 'expired', 'cancelled'].map(orderStatusLabel);
  assert.deepEqual(labels, ['Chờ chuyển khoản', 'Chờ xác nhận', 'Cần bổ sung', 'Đã mở khoá', 'Hết hạn', 'Đã huỷ']);
  assert.equal(orderStatusLabel('toString'), null);
  const all = (href) => href;
  const steps = ['awaiting_transfer', 'transfer_reported', 'needs_info', 'confirmed', 'expired', 'cancelled']
    .map((status) => orderNextStep({ code: 'AV 1', status }, all));
  assert.deepEqual(steps.map((s) => s.label), ['Tiếp tục thanh toán', 'Xem trạng thái', 'Xem hướng dẫn', 'Vào học', 'Xem chi tiết', 'Xem chi tiết']);
  assert.equal(steps[0].href, '/enroll/AV%201');
  assert.equal(steps[3].href, '/course');
});

test('a planned target gives no href; "Vào học" falls back to /home', () => {
  const onlyHome = (href) => (href === '/home' ? '/home' : null);
  assert.deepEqual(orderNextStep({ code: 'X', status: 'needs_info' }, onlyHome), { label: 'Xem hướng dẫn', href: null });
  assert.deepEqual(orderNextStep({ code: 'X', status: 'confirmed' }, onlyHome), { label: 'Vào học', href: '/home' });
  assert.equal(orderNextStep({ code: 'X', status: 'odd' }, onlyHome), null);
});

test('money and date text', () => {
  assert.equal(formatVnd(1200000), '1.200.000 đ');
  assert.equal(formatVnd(-1), null);
  assert.equal(formatVnd(1.5), null);
  assert.equal(orderDateText('2026-11-22T18:30:00Z'), '23/11/2026');
  assert.equal(orderDateText('nope'), null);
  assert.equal(orderDateText(null), null);
});

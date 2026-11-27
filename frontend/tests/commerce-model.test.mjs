// PUBLICSITE-0059 T02 — behaviour of the commerce data layer helpers, on the
// fake fixtures in tests/fixtures/commerce (never read by production code).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  COURSE_BUNDLE_MIN_OPEN, ORDER_STATUS_LABELS, catalogCounts, courseRowLabel, courseRowState,
  formatVnd, nextActionForOrder, orderBlocks, orderScreen,
} from '../lib/commerce-model.mjs';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/commerce/${name}`, import.meta.url), 'utf8'));

test('courseRowState covers every status × viewer.state pair', () => {
  const expected = {
    open: { guest: 'open', can_enroll: 'open', open_order: 'open', enrolled: 'learning', expired: 'expired' },
    coming_soon: { guest: 'upcoming', can_enroll: 'upcoming', open_order: 'upcoming', enrolled: 'learning', expired: 'expired' },
    closed: { guest: 'upcoming', can_enroll: 'upcoming', open_order: 'upcoming', enrolled: 'learning', expired: 'expired' },
  };
  for (const [status, byViewer] of Object.entries(expected)) {
    for (const [state, row] of Object.entries(byViewer)) {
      const days_left = state === 'enrolled' ? 30 : null;
      assert.equal(courseRowState({ status, viewer: { state, days_left } }), row, `${status} × ${state}`);
    }
  }
  assert.equal(courseRowState({ status: 'open', viewer: null }), 'open');
});

test('FR-008: enrolled with days_left ≤ 0 is "Hết hạn"; labels match the spec', () => {
  assert.equal(courseRowState({ status: 'open', viewer: { state: 'enrolled', days_left: 0 } }), 'expired');
  assert.equal(courseRowLabel({ status: 'open', viewer: { state: 'enrolled', days_left: 0 } }), 'Hết hạn');
  assert.equal(courseRowLabel({ status: 'open', viewer: { state: 'enrolled', days_left: 12 } }), 'Bạn đang học · còn 12 ngày');
  assert.equal(courseRowLabel({ status: 'open', viewer: { state: 'guest' } }), 'Đang mở đăng ký');
  assert.equal(courseRowLabel({ status: 'coming_soon', viewer: { state: 'guest' } }), 'Sắp mở');
  // Andy 23/11: a closed course is "Tạm đóng đăng ký", not "Sắp mở".
  assert.equal(courseRowLabel({ status: 'closed', viewer: { state: 'guest' } }), 'Tạm đóng đăng ký');
  assert.equal(courseRowLabel({ status: 'closed', viewer: { state: 'enrolled', days_left: 3 } }), 'Bạn đang học · còn 3 ngày');
  assert.equal(courseRowLabel({ status: 'closed', viewer: { state: 'expired' } }), 'Hết hạn');
});

test('orderScreen maps every G04 order status (ENROLL-0060 FR-037)', () => {
  const screens = Object.fromEntries(fixture('orders-all-statuses.json').items.map((o) => [o.status, orderScreen(o)]));
  assert.deepEqual(screens, { awaiting_transfer: 2, transfer_reported: 3, needs_info: 3, confirmed: 4, expired: 5, cancelled: 5 });
  assert.equal(orderScreen({ status: 'awaiting_confirmation' }), null);
  assert.deepEqual(Object.keys(ORDER_STATUS_LABELS).sort(), Object.keys(screens).sort());
});

test('orderBlocks: needs_info × info_kind, overpaid confirmed order, cancel reason', () => {
  const orders = fixture('orders-all-statuses.json').items;
  const needs = orders.filter((o) => o.status === 'needs_info').map((o) => orderBlocks(o).needsInfo);
  assert.deepEqual(needs.map((b) => b.kind), ['underpaid', 'not_found', 'other']);
  assert.equal(needs[0].receivedVnd, 1000000);
  assert.equal(needs[0].tuitionVnd, 1200000);
  assert.equal(needs[1].receivedVnd, null);
  assert.equal(needs[0].adminMessage, 'Lời nhắn giả của admin.');
  const [overpaid, plain] = orders.filter((o) => o.status === 'confirmed').map(orderBlocks);
  assert.equal(overpaid.overpaidVnd, 50000);
  assert.equal(plain.overpaidVnd, null);
  assert.equal(overpaid.needsInfo, null);
  const [byLearner, byAdmin] = orders.filter((o) => o.status === 'cancelled').map((o) => orderBlocks(o).cancel);
  assert.deepEqual(byLearner, { by: 'learner', note: null });
  assert.deepEqual(byAdmin, { by: 'admin', note: 'Lý do giả admin ghi.' });
  assert.deepEqual(orderBlocks({ status: 'needs_info', info_kind: 'weird' }).needsInfo.kind, null);
});

test('nextActionForOrder gives one step per status', () => {
  const actions = fixture('orders-all-statuses.json').items.map((o) => [o.status, nextActionForOrder(o)]);
  assert.deepEqual(actions.find(([s]) => s === 'awaiting_transfer')[1], { label: 'Chuyển khoản', href: '/enroll/AVGIA01' });
  assert.deepEqual(actions.find(([s]) => s === 'expired')[1], { label: 'Tạo đơn mới', href: '/courses/khoa-a/enroll' });
  assert.ok(actions.every(([, a]) => a && a.label && a.href));
  assert.equal(nextActionForOrder({ status: 'unknown' }), null);
});

test('formatVnd(null) === null; amounts use the Vietnamese grouping', () => {
  assert.equal(formatVnd(null), null);
  assert.equal(formatVnd(undefined), null);
  assert.equal(formatVnd(Number.NaN), null);
  assert.equal(formatVnd(1200000), '1.200.000 đ');
  assert.equal(formatVnd(0), '0 đ');
});

test('catalogCounts on the one-open catalogue; bundle threshold', () => {
  assert.deepEqual(catalogCounts(fixture('catalog-one-open.json').items), { open: 1, upcoming: 5, closed: 0 });
  assert.deepEqual(catalogCounts(fixture('catalog-two-open.json').items), { open: 2, upcoming: 4, closed: 0 });
  assert.deepEqual(catalogCounts(null), { open: 0, upcoming: 0, closed: 0 });
  assert.deepEqual(catalogCounts([{ status: 'open' }, { status: 'closed' }, { status: 'coming_soon' }]), { open: 1, upcoming: 1, closed: 1 });
  assert.equal(COURSE_BUNDLE_MIN_OPEN, 2);
});

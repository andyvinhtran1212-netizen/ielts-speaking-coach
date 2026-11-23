// PUBLICSITE-0059 T02 — behaviour of the commerce data layer helpers, on the
// fake fixtures in tests/fixtures/commerce (never read by production code).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  COURSE_BUNDLE_MIN_OPEN, ORDER_STATUS_LABELS, carryOverSentence, catalogCounts, courseRowLabel, courseRowState,
  enrollErrorView, enrollHref, formatViDate, formatVnd, internalHref, nextActionForOrder, orderHref, orderBlocks, orderScreen,
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
  assert.deepEqual(catalogCounts(fixture('catalog-one-open.json').items), { open: 1, upcoming: 5 });
  assert.deepEqual(catalogCounts(fixture('catalog-two-open.json').items), { open: 2, upcoming: 4 });
  assert.deepEqual(catalogCounts(null), { open: 0, upcoming: 0 });
  assert.equal(COURSE_BUNDLE_MIN_OPEN, 2);
});

test('carryOverSentence builds the FR-024 sentence from the two G04 numbers only', () => {
  const full = carryOverSentence({ credit_carry_percent: 100, credit_carry_valid_days: 60 });
  assert.match(full, /toàn bộ lượt chưa dùng/);
  assert.match(full, /60 ngày/);
  assert.match(full, /hết hiệu lực khi khoá hết hạn/);

  const noDays = carryOverSentence({ credit_carry_percent: 100, credit_carry_valid_days: null });
  assert.match(noDays, /toàn bộ lượt chưa dùng/);
  assert.doesNotMatch(noDays, /ngày/);

  for (const percent of [null, 0, undefined]) {
    const bare = carryOverSentence({ credit_carry_percent: percent, credit_carry_valid_days: 60 });
    assert.match(bare, /hết hiệu lực khi khoá hết hạn/);
    assert.doesNotMatch(bare, /chuyển|60|toàn bộ/);
  }
  assert.equal(carryOverSentence(null), carryOverSentence({ credit_carry_percent: null }));

  const half = carryOverSentence({ credit_carry_percent: 50, credit_carry_valid_days: 30 });
  assert.match(half, /50% số lượt chưa dùng/);
  assert.match(half, /30 ngày/);
  assert.doesNotMatch(half, /toàn bộ/);
});

test('enrollHref: a guest goes through login and comes back to the enrol step', () => {
  assert.equal(enrollHref('khoa-a', true), '/courses/khoa-a/enroll');
  assert.equal(enrollHref('khoa-a', false), '/login?next=%2Fcourses%2Fkhoa-a%2Fenroll');
});

test('formatViDate reads a G04 date in Vietnam time and drops anything unreadable', () => {
  assert.equal(formatViDate('2027-01-15'), '15/01/2027');
  assert.equal(formatViDate('2027-01-14T18:30:00Z'), '15/01/2027');
  assert.equal(formatViDate(null), null);
  assert.equal(formatViDate('không phải ngày'), null);
});

test('internalHref keeps only a path on this site (CR #2637)', () => {
  for (const ok of ['/course/lesson/gia-1-1', '/library?x=1#y', '/']) assert.equal(internalHref(ok), ok);
  for (const bad of ['javascript:alert(1)', 'JavaScript:x', 'https://evil.example/x', '//evil.example', '/\\evil.example',
    '/a\\b', '/a\nb', ' /x', '', null, undefined, 42]) {
    assert.equal(internalHref(bad), null, String(bad));
  }
});

test('orderHref is the one link to an order page (G05-T12a contract)', () => {
  assert.equal(orderHref('AVER-K7QM2X'), '/enroll/AVER-K7QM2X');
  assert.equal(orderHref('AVER K7/QM'), '/enroll/AVER%20K7%2FQM');
  assert.deepEqual(nextActionForOrder({ order_code: 'AVER-K7QM2X', status: 'awaiting_transfer' }), { label: 'Chuyển khoản', href: '/enroll/AVER-K7QM2X' });
});

test('enrollErrorView words the G04 create-order refusals and keeps retrying open for the rest', () => {
  const err = (status, error_code) => ({ status, detail: error_code ? { error_code, message: 'x' } : null });
  assert.deepEqual(enrollErrorView(err(503, 'orders_paused')), { code: 'orders_paused', message: 'Đăng ký khoá đang tạm dừng. Bạn quay lại sau nhé.', final: false, newKey: false });
  for (const code of ['course_not_open', 'already_enrolled', 'account_suspended']) assert.equal(enrollErrorView(err(409, code)).final, true, code);
  assert.equal(enrollErrorView(err(409, 'request_key_conflict')).newKey, true);
  for (const e of [err(503, 'orders_unavailable'), err(500, null), new TypeError('network'), null]) {
    const view = enrollErrorView(e);
    assert.equal(view.final, false);
    assert.match(view.message, /Thông tin bạn đã điền vẫn còn/);
  }
  assert.equal(enrollErrorView(err(409, 'constructor')).code, 'constructor', 'no prototype key is a known code');
  assert.equal(enrollErrorView(err(409, 'constructor')).final, false);
});

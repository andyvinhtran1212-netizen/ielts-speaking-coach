// ENROLL-0060 FR-037…FR-040, FR-055: the /enroll/[orderCode] model.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  carryFor, carryText, holdHours, normalizeOrder, pollsStatus, rawAccountNo, rawAmount, screenFor, shortfall, vnd, whenText,
} from '../lib/enroll-order-model.mjs';

const order = (over = {}) => ({
  order: {
    order_code: 'AVER-ABC234', status: 'awaiting_transfer', product: { slug: 'writing-6', title: 'Khoá Writing for IELTS' },
    tuition_vnd: 10000, pay_by: '2026-11-25T05:00:00Z', created_at: '2026-11-23T05:00:00Z',
    transfer: { bank_name: 'Ngân hàng giả', account_no: '0123 4567 89', account_name: 'AVER GIA', amount_vnd: 10000, memo: 'AVER-ABC234', vietqr_payload: null },
    ...over,
  },
});

test('normalizeOrder keeps the Order fields and rejects other shapes', () => {
  const o = normalizeOrder(order());
  assert.equal(o.code, 'AVER-ABC234');
  assert.equal(o.title, 'Khoá Writing for IELTS');
  assert.deepEqual(o.transfer, { bankName: 'Ngân hàng giả', accountNo: '0123 4567 89', accountName: 'AVER GIA', amount: 10000, memo: 'AVER-ABC234', payload: null });
  assert.equal(normalizeOrder(order({ status: 'paid' })), null);
  assert.equal(normalizeOrder({ order_code: 'AVER-ABC234' }), null);
  assert.equal(normalizeOrder(order({ transfer: { account_no: '', amount_vnd: 1, memo: 'x' } })).transfer, null);
  assert.equal(normalizeOrder(order({ info_kind: 'weird' })).infoKind, null);
  assert.equal(normalizeOrder(order({ cancel_reason: 'robot' })).cancelReason, null);
});

test('FR-037: one screen per status; only screen 3 asks again', () => {
  const screens = ['awaiting_transfer', 'transfer_reported', 'needs_info', 'confirmed', 'expired', 'cancelled']
    .map((status) => normalizeOrder(order({ status })));
  assert.deepEqual(screens.map(screenFor), ['transfer', 'waiting', 'waiting', 'unlocked', 'closed', 'closed']);
  assert.deepEqual(screens.map(pollsStatus), [false, true, true, false, false, false]);
  assert.equal(screenFor(null), null);
});

test('FR-038: copy values are raw', () => {
  assert.equal(rawAccountNo('0123 4567 89'), '0123456789');
  assert.equal(rawAmount(10000), '10000');
  assert.equal(rawAmount('10.000 đ'), '10000');
  assert.equal(vnd(1200000), '1.200.000 đ');
});

test('screen 6 numbers, hold hours and Vietnam time', () => {
  const under = normalizeOrder(order({ status: 'needs_info', info_kind: 'underpaid', tuition_vnd: 1200000, received_vnd: 1000000 }));
  assert.deepEqual(shortfall(under), { received: 1000000, tuition: 1200000, missing: 200000 });
  assert.equal(shortfall(normalizeOrder(order({ status: 'needs_info', info_kind: 'not_found' }))), null);
  assert.equal(holdHours(normalizeOrder(order())), 48);
  assert.equal(whenText('2026-11-23T07:30:00Z'), '14:30, ngày 23/11/2026');
  assert.equal(whenText(null), null);
});

test('FR-055: carried credits come from /api/me/courses for the same course, never computed', () => {
  const courses = { items: [
    { product_slug: 'speaking-6', credits: { carry_balance: 3, carry_expires_at: '2026-12-30T16:59:59Z' } },
    { product_slug: 'writing-6', credits: { carry_balance: 7, carry_expires_at: '2026-12-30T16:59:59Z' } },
  ] };
  assert.equal(carryText(carryFor(courses, 'writing-6')), 'Chuyển từ kỳ trước: 7 lượt, dùng đến 30/12/2026');
  assert.equal(carryFor({ items: [{ product_slug: 'writing-6', credits: { carry_balance: 0 } }] }, 'writing-6'), null);
  assert.equal(carryFor(courses, 'reading-6'), null);
  assert.equal(carryFor(null, 'writing-6'), null);
  assert.equal(carryText(null), null);
});

test('FR-044: no forbidden words in the new files', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = path.join(here, '../app/(authed-v2-enroll)/enroll/[orderCode]');
  const files = [...readdirSync(dir).map((f) => path.join(dir, f)), path.join(here, '../lib/enroll-order-model.mjs')];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /(^|[^\p{L}])(mua|bán|giá|đơn hàng|thầy|giảng viên)(?![\p{L}])/iu, file);
  }
});

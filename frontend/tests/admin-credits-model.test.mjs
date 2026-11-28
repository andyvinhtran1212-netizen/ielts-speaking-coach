import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  OTHER_LABEL,
  adjustDraft,
  adjustableCourses,
  balanceCards,
  dateVi,
  historyRows,
  userIdFromRef,
  validateAdjust,
} from '../lib/admin-credits-model.mjs';

const E1 = '11111111-1111-4111-8111-111111111111';
const E2 = '22222222-2222-4222-8222-222222222222';

const access = {
  items: [
    { entitlement_id: E1, title: 'IELTS 6.5 Online', short_title: 'IELTS 6.5', kind: 'online', state: 'active',
      expires_at: '2027-02-01T16:59:59Z',
      credits: { balance: 42, usable_from: null, usable_until: null, carry_balance: 12, carry_expires_at: '2027-01-15T10:00:00Z' } },
    { entitlement_id: E2, title: 'Course 1', kind: 'class', state: 'expired', expires_at: '2026-10-01T00:00:00Z',
      credits: { balance: 0, carry_balance: 0, carry_expires_at: null } },
    { entitlement_id: null, title: 'Lớp mã cũ', kind: 'class', state: 'active', expires_at: null, credits: null },
  ],
  credits: { total: 42, by_kind: { online: 42, class: 0 } },
};

test('learner ref u-<uuid> gives the user id; s- refs and junk give null', () => {
  assert.equal(userIdFromRef(`u-${E1.toUpperCase()}`), E1);
  assert.equal(userIdFromRef(`s-${E1}`), null);
  assert.equal(userIdFromRef('u-nope'), null);
  assert.equal(userIdFromRef(''), null);
});

test('dates read in Vietnam time', () => {
  assert.equal(dateVi('2027-01-31T17:30:00Z'), '01/02/2027');
  assert.equal(dateVi(null), '');
  assert.equal(dateVi('garbage'), '');
});

test('balance cards come per course from the server, carry text only when G04 returns it', () => {
  const [online, ended, legacy] = balanceCards(access);
  assert.equal(online.balance, 42);
  assert.equal(online.carryText, 'trong đó 12 lượt chuyển, dùng tới 15/01/2027');
  assert.equal(ended.carryText, '');
  assert.equal(ended.stateText, 'Đã hết hạn');
  assert.equal(legacy.balance, null, 'no pool is not zero');
});

test('only an entitlement in force with a pool can be adjusted', () => {
  assert.deepEqual(adjustableCourses(access).map((c) => c.entitlementId), [E1]);
  assert.equal(adjustDraft(adjustableCourses(access)).entitlementId, E1);
  assert.equal(adjustDraft([]).entitlementId, '');
});

test('history rows: server label, unknown reason falls back, carry_over adds the carry expiry', () => {
  const history = { balance: 42, next_cursor: null, items: [
    { at: '2026-11-20T03:00:00Z', delta: 12, reason: 'carry_over', label_vi: 'Chuyển lượt chưa dùng từ kỳ trước khi đăng ký lại',
      balance_after: 42, entitlement_id: E1, actor: null, note: null },
    { at: '2026-11-19T03:00:00Z', delta: -5, reason: 'admin_adjust', label_vi: 'Điều chỉnh bởi admin', balance_after: 30,
      entitlement_id: E1, actor: { id: 'a', email: 'ops@example.test', display_name: 'Cô Lan' }, note: 'Trừ do chấm trùng bài' },
    { at: '2026-11-18T03:00:00Z', delta: 1, reason: 'something_new', label_vi: '', balance_after: 35, entitlement_id: E2, actor: null, note: null },
    { at: '2026-11-17T03:00:00Z', delta: 3, reason: 'carry_over', label_vi: 'Chuyển lượt', balance_after: 34, entitlement_id: E2, actor: null, note: null },
  ] };
  const rows = historyRows(history, access);
  assert.equal(rows[0].label, 'Chuyển lượt chưa dùng từ kỳ trước khi đăng ký lại');
  assert.equal(rows[0].detail, '12 lượt, dùng tới 15/01/2027');
  assert.equal(rows[0].delta, '+12');
  assert.equal(rows[0].course, 'IELTS 6.5');
  assert.equal(rows[1].delta, '-5');
  assert.equal(rows[1].actor, 'Cô Lan');
  assert.equal(rows[1].note, 'Trừ do chấm trùng bài');
  assert.equal(rows[2].label, OTHER_LABEL);
  assert.equal(rows[3].detail, '', 'no carry expiry from G04 → nothing guessed');
});

test('adjust validation: course in force, positive integer, reason of 10+ characters', () => {
  const courses = adjustableCourses(access);
  const base = { entitlementId: E1, direction: 'add', amount: '5', reason: 'Bù lượt do lỗi chấm' };
  assert.equal(validateAdjust({ ...base, entitlementId: E2 }, courses).ok, false);
  for (const amount of ['', '0', '-3', '2.5', 'abc', '100001']) {
    assert.equal(validateAdjust({ ...base, amount }, courses).ok, false, amount);
  }
  assert.equal(validateAdjust({ ...base, reason: 'quá ngắn' }, courses).ok, false);
  const add = validateAdjust(base, courses);
  assert.deepEqual(add.body, { entitlement_id: E1, delta: 5, reason: 'Bù lượt do lỗi chấm' });
  assert.match(add.confirmText, /^Cộng 5 lượt vào khoá “IELTS 6\.5”/);
  const sub = validateAdjust({ ...base, direction: 'subtract' }, courses);
  assert.equal(sub.body.delta, -5);
  assert.match(sub.confirmText, /^Trừ 5 lượt khỏi khoá/);
});

test('the page hardcodes no percentage and no skill picker', () => {
  for (const path of ['../lib/admin-credits-model.mjs', '../app/(authed-admin)/(credits)/admin/credits/admin-credits.tsx']) {
    const text = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /\d+\s*%/, path);
    assert.doesNotMatch(text, /Kỹ năng|Writing hay Speaking/, path);
  }
});

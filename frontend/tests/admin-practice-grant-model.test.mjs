import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  grantBody,
  grantDraft,
  heldFromAccess,
  practiceProducts,
  runSummary,
  validateGrant,
  validateRevoke,
} from '../lib/admin-practice-grant-model.mjs';

const C1 = 'c1000000-0000-4000-8000-000000000001';
const C2 = 'c2000000-0000-4000-8000-000000000002';
const C3 = 'c3000000-0000-4000-8000-000000000003';
const products = [
  { id: 'p1', course_id: C1, kind: 'repractice', short_title: 'Course 1', status: 'open', access_days: 14, review_mode: 'ai_instant', archived_at: null },
  { id: 'p2', course_id: C2, kind: 'repractice', title: 'Course 2 luyện lại', status: 'open', access_days: 30, review_mode: 'teacher_review', archived_at: null },
  { id: 'p3', course_id: C3, kind: 'repractice', title: 'Course 3', status: 'draft', access_days: 14, archived_at: null },
  { id: 'p4', course_id: C3, kind: 'repractice', title: 'Course 3 cũ', status: 'open', access_days: 14, archived_at: '2026-10-01T00:00:00Z' },
  { id: 'p5', course_id: C2, kind: 'online', title: 'Course 2 online', status: 'open', access_days: 90, archived_at: null },
];
const A = { id: 'u-a', name: 'Lan Nguyễn' };
const B = { id: 'u-b', name: 'Minh Trần' };

test('only live repractice products are offered, minus the class course and, for one learner, what they hold', () => {
  assert.deepEqual(practiceProducts(products).map((p) => p.id), ['p1', 'p2']);
  assert.deepEqual(practiceProducts(products, { excludeCourseIds: [C1.toUpperCase()] }).map((p) => p.id), ['p2']);
  assert.deepEqual(practiceProducts(products, { users: [A], heldCourseIds: { 'u-a': [C2] } }).map((p) => p.id), ['p1']);
  // With several learners nobody's holdings hide a course; they are skipped at confirm.
  assert.deepEqual(practiceProducts(products, { users: [A, B], heldCourseIds: { 'u-a': [C2] } }).map((p) => p.id), ['p1', 'p2']);
});

test('held courses come from access items in force, matched by product slug', () => {
  const prods = [{ id: 'p1', course_id: C1, slug: 'a' }, { id: 'p2', course_id: C2, slug: 'b' }];
  assert.deepEqual(heldFromAccess([
    { product_slug: 'a', state: 'active' }, { product_slug: 'b', state: 'revoked' },
    { product_slug: null, state: 'active' }, { product_slug: 'zz', state: 'active' }], prods), [C1]);
  assert.deepEqual(heldFromAccess(null, prods), []);
});

test('a single course is preselected with its own review mode', () => {
  const only = practiceProducts(products, { excludeCourseIds: [C1] });
  assert.deepEqual(grantDraft(only), { productId: 'p2', days: '', reviewMode: 'teacher_review', reason: '' });
  assert.equal(grantDraft(practiceProducts(products)).productId, '');
});

test('grant validation: course, learners, days, mode, reason; confirm names the count and skips holders', () => {
  const opts = practiceProducts(products);
  const base = { productId: 'p2', days: '', reviewMode: 'ai_instant', reason: 'Học lại trước kỳ thi' };
  assert.equal(validateGrant({ ...base, productId: '' }, opts, [A]).ok, false);
  assert.equal(validateGrant(base, opts, []).ok, false);
  for (const days of ['0', '-1', '2.5', 'abc', '3651']) assert.equal(validateGrant({ ...base, days }, opts, [A]).ok, false, days);
  assert.equal(validateGrant({ ...base, reviewMode: 'x' }, opts, [A]).ok, false);
  assert.equal(validateGrant({ ...base, reason: 'ngắn' }, opts, [A]).ok, false);
  assert.equal(validateGrant(base, opts, [A], { 'u-a': [C2] }).ok, false, 'everyone already holds it');

  const check = validateGrant(base, opts, [A, B], { 'u-a': [C2] });
  assert.equal(check.ok, true);
  assert.deepEqual(check.targets.map((u) => u.id), ['u-b']);
  assert.deepEqual(check.already.map((u) => u.id), ['u-a']);
  assert.deepEqual(check.body, { product_id: 'p2', days: null, review_mode: 'ai_instant', reason: 'Học lại trước kỳ thi' });
  assert.match(check.confirmText, /^Cấp quyền luyện lại khoá “Course 2 luyện lại” cho 1 người, 30 ngày, chấm ai trả ngay\./);
  assert.match(check.confirmText, /Bỏ qua 1 người đã có quyền\.$/);
  assert.match(validateGrant({ ...base, days: '7' }, opts, [A, B]).confirmText, /cho 2 người, 7 ngày/);
});

test('grant body per learner keeps the key and leaves days out when it follows the product', () => {
  const body = { product_id: 'p2', days: null, review_mode: 'teacher_review', reason: 'Học lại trước kỳ thi' };
  assert.deepEqual(grantBody(body, 'u-a', 'k1'),
    { user_id: 'u-a', product_id: 'p2', review_mode: 'teacher_review', reason: 'Học lại trước kỳ thi', request_key: 'k1' });
  assert.equal(grantBody({ ...body, days: 7 }, 'u-a', 'k1').days, 7);
});

test('run summary splits granted, failed and not yet sent', () => {
  const s = runSummary([A, B, { id: 'u-c', name: 'C' }], { 'u-a': { ok: true }, 'u-b': { ok: false, error: 'Lỗi mạng' } });
  assert.deepEqual(s.granted.map((u) => u.id), ['u-a']);
  assert.deepEqual(s.failed, [{ ...B, error: 'Lỗi mạng' }]);
  assert.deepEqual(s.pending.map((u) => u.id), ['u-c']);
  assert.equal(s.done, false);
  assert.equal(s.text, 'Đã cấp cho 1/3 người.');
});

test('revoke needs the exact full name (spacing and Unicode form aside) and a reason', () => {
  const reason = 'Học viên xin dừng khoá';
  assert.equal(validateRevoke({ typedName: 'Lan', reason }, 'Lan Nguyễn').ok, false);
  assert.equal(validateRevoke({ typedName: 'lan nguyễn', reason }, 'Lan Nguyễn').ok, false);
  assert.equal(validateRevoke({ typedName: '  Lan   Nguyễn ', reason }, 'Lan Nguyễn').ok, true);
  assert.equal(validateRevoke({ typedName: 'Lan Nguyễn', reason: 'ngắn' }, 'Lan Nguyễn').ok, false);
  assert.equal(validateRevoke({ typedName: '', reason }, '').ok, false, 'no name to match → no revoke here');
});

test('no activation code is created to grant access', () => {
  for (const path of ['../lib/admin-practice-grant-model.mjs', '../lib/admin-practice-grant-api.ts',
    '../components/admin/practice-grant-form.tsx', '../components/admin/revoke-access-form.tsx']) {
    const text = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /access-codes|activation-codes/, path);
  }
});

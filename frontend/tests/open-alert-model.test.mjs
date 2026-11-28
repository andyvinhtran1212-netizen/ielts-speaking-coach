// ENROLL-0060 FR-060 (G05-T22) — behaviour of the open-alert model helpers.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { OPEN_ALERT_COPY, isUnsubscribeHash, normalizeEmail, openAlertErrorMessage, openAlertPath, parseUnsubscribeHash } from '../lib/open-alert-model.mjs';

test('normalizeEmail trims a valid address and rejects malformed ones', () => {
  assert.equal(normalizeEmail('  hoc.vien@example.test '), 'hoc.vien@example.test');
  for (const bad of ['', 'no-at', 'a@b', 'a b@example.test', '@example.test', null, 42, `${'x'.repeat(65)}@example.test`]) {
    assert.equal(normalizeEmail(bad), '', String(bad));
  }
});

test('parseUnsubscribeHash reads only #bo-nhan=<token>', () => {
  assert.equal(parseUnsubscribeHash('#bo-nhan=abc'), 'abc');
  assert.equal(parseUnsubscribeHash('#bo-nhan=' + 'f'.repeat(64)), 'f'.repeat(64));
  for (const other of ['', '#', '#bo-nhan=', '#gioi-thieu', '#bo-nhan=a%2Fb', '#bo-nhan=%E0%A4%A', '#bo-nhan=' + 'a'.repeat(129), undefined]) {
    assert.equal(parseUnsubscribeHash(other), null, String(other));
  }
});

test('openAlertPath encodes the slug', () => {
  assert.equal(openAlertPath('ielts-7'), '/api/courses/ielts-7/open-alerts');
});

test('openAlertErrorMessage maps server and network failures', () => {
  assert.deepEqual(openAlertErrorMessage(new TypeError('Failed to fetch')), { message: OPEN_ALERT_COPY.network, field: false });
  assert.deepEqual(openAlertErrorMessage({ status: 422, detail: { error_code: 'email_invalid', message: 'Email chưa đúng.' } }),
    { message: 'Email chưa đúng.', field: true });
  assert.deepEqual(openAlertErrorMessage({ status: 429, detail: { error_code: 'open_alert_rate_limited', message: 'Bạn đã gửi nhiều lần quá. Bạn thử lại sau nhé.' } }),
    { message: 'Bạn đã gửi nhiều lần quá. Bạn thử lại sau nhé.', field: false });
  assert.deepEqual(openAlertErrorMessage({ status: 503, detail: { message: 'x' } }), { message: OPEN_ALERT_COPY.unavailable, field: false });
  assert.deepEqual(openAlertErrorMessage({ status: 409, detail: null }), { message: OPEN_ALERT_COPY.unavailable, field: false });
});

test('the shared email table gives the same verdict as the API (backend/tests/test_course_open_alerts.py)', () => {
  const cases = JSON.parse(readFileSync(new URL('./fixtures/open-alert/email-cases.json', import.meta.url), 'utf8'));
  for (const email of cases.valid) assert.equal(normalizeEmail(email), email.trim(), email);
  for (const email of cases.invalid) assert.equal(normalizeEmail(email), '', email);
});

test('isUnsubscribeHash spots a mail link even when its token is broken', () => {
  assert.equal(isUnsubscribeHash('#bo-nhan=abc'), true);
  assert.equal(isUnsubscribeHash('#bo-nhan='), true);
  assert.equal(isUnsubscribeHash('#bo-nhan=a%2Fb'), true);
  assert.equal(isUnsubscribeHash('#gioi-thieu'), false);
  assert.equal(isUnsubscribeHash(undefined), false);
});

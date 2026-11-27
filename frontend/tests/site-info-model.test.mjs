// PUBLICSITE-0059 FR-026 (G05-T23): the frontend reading of /api/public/site-info.
import assert from 'node:assert/strict';
import test from 'node:test';

import { contactRows, emptySiteInfo, normalizeSiteInfo, siteText } from '../lib/site-info-model.mjs';

test('a failed or missing answer is every field null and every flag false', () => {
  const empty = {
    contact: { email: null, phone: null, zalo: null, reply_hours: null },
    enroll: { office_hours: null, confirm_sla: null, escalate_after: null },
    login_code_enabled: false,
    enroll_prelearn_chapter1: false,
  };
  assert.deepEqual(emptySiteInfo(), empty);
  for (const raw of [null, undefined, 'oops', [], { contact: 'x', enroll: 3 }]) {
    assert.deepEqual(normalizeSiteInfo(raw), empty);
  }
});

test('texts are trimmed; blank, non-string and placeholder values are null', () => {
  assert.equal(siteText('  hotro@example.com '), 'hotro@example.com');
  assert.equal(siteText('   '), null);
  assert.equal(siteText(42), null);
  assert.equal(siteText('0900 XXX XXX'), null);
});

test('flags are on only for a literal true', () => {
  const info = normalizeSiteInfo({ login_code_enabled: 'true', enroll_prelearn_chapter1: true });
  assert.equal(info.login_code_enabled, false);
  assert.equal(info.enroll_prelearn_chapter1, true);
});

test('the enrol texts pass through', () => {
  const info = normalizeSiteInfo({ enroll: { office_hours: '8:00–21:00', confirm_sla: 'trong 2 giờ', escalate_after: '' } });
  assert.deepEqual(info.enroll, { office_hours: '8:00–21:00', confirm_sla: 'trong 2 giờ', escalate_after: null });
});

test('contact rows keep the fixed order and skip empty lines', () => {
  const rows = contactRows({ reply_hours: '8:00–21:00', zalo: 'Aver', email: 'a@example.com' });
  assert.deepEqual(rows.map((r) => r.key), ['email', 'zalo', 'reply_hours']);
  assert.equal(rows[1].href, null);
  assert.deepEqual(contactRows(undefined), []);
});

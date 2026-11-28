import assert from 'node:assert/strict';
import test from 'node:test';

import {
  downloadPath, emailMatches, errorCode, isStaffRole, normalizeDeletion, normalizeExport, retryAtText, sizeText,
} from '../lib/account-data-model.mjs';

// ACCOUNTDATA-0100: the account page's view of the #2600 routes.

test('deletion status: the three server states, anything else is not trusted', () => {
  assert.deepEqual(normalizeDeletion({ status: 'pending', requested_at: 'a', erase_after: 'b' }),
    { status: 'pending', requestedAt: 'a', eraseAfter: 'b' });
  assert.deepEqual(normalizeDeletion({ status: 'none', requested_at: null, erase_after: null }),
    { status: 'none', requestedAt: null, eraseAfter: null });
  assert.equal(normalizeDeletion({ status: 'cancelled' }), null);
  assert.equal(normalizeDeletion(null), null);
});

test('export status: known states only, size must be a whole non-negative number', () => {
  assert.equal(normalizeExport({ status: 'ready', export_id: 'e', size_bytes: 5 }).sizeBytes, 5);
  assert.equal(normalizeExport({ status: 'ready', export_id: 'e', size_bytes: -1 }).sizeBytes, null);
  assert.equal(normalizeExport({ status: 'exploded' }), null);
  assert.deepEqual(normalizeExport({ status: 'none' }).status, 'none');
});

test('email confirmation: trimmed, any case, never against an empty login email', () => {
  assert.equal(emailMatches('  A@B.test ', 'a@b.TEST'), true);
  assert.equal(emailMatches('a@b.tes', 'a@b.test'), false);
  assert.equal(emailMatches('', ''), false);
  assert.equal(emailMatches('x', null), false);
});

test('roles, error codes, retry time, size text, download path', () => {
  assert.equal(isStaffRole('admin'), true);
  assert.equal(isStaffRole('instructor'), true);
  assert.equal(isStaffRole('user'), false);
  assert.equal(errorCode({ detail: { error_code: 'x' } }), 'x');
  assert.equal(errorCode({ detail: 'x' }), null);
  assert.match(retryAtText({ detail: { retry_after: 60 } }, Date.parse('2026-11-23T05:00:00Z')), /^12:01, 23\/11\/2026$/);
  assert.equal(retryAtText({ detail: {} }), null);
  assert.equal(sizeText(12_900_000), '12,3 MB');
  assert.equal(sizeText(2048), '2 KB');
  assert.equal(sizeText(null), null);
  assert.equal(downloadPath('e/1'), '/api/account/data-export/e%2F1/download');
});

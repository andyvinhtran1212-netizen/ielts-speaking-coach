// LEARNERCORE-0063 FR-064: pure helpers of the new Hồ sơ tree.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { OUTCOME_TEXT, formatVnDateTime, loginEventRows, signInMethodLine } from '../lib/profile-v2-model.mjs';

describe('profile v2 model', () => {
  test('hidden when disabled, empty or another shape', () => {
    assert.equal(loginEventRows({ enabled: false, items: [{ outcome: 'signed_in' }] }), null);
    assert.equal(loginEventRows({ enabled: true, items: [] }), null);
    assert.equal(loginEventRows({ detail: 'Not Found' }), null);
    assert.equal(loginEventRows(null), null);
  });

  test('every outcome has the GOI-07 FR-07-064 sentence; an unknown one prints nothing', () => {
    assert.deepEqual(Object.keys(OUTCOME_TEXT).sort(), ['claim_refused_timed', 'claimed', 'displaced', 'pending', 'signed_in', 'signed_out_all']);
    const [row] = loginEventRows({ enabled: true, items: [{ at: '2026-11-23T02:05:00Z', device_kind: 'phone', method: 'unknown', outcome: 'mystery', is_current: true }] });
    assert.deepEqual(row, { device: 'Điện thoại', at: '09:05, 23/11/2026', method: null, outcome: null, current: true });
  });

  test('device label first, then kind, then "Thiết bị khác"; at most three rows', () => {
    const rows = loginEventRows({ enabled: true, items: [
      { device_label: 'Safari trên iPhone', device_kind: 'phone' }, { device_kind: 'toaster' }, { device_kind: 'tablet' }, { device_kind: 'desktop' },
    ] });
    assert.deepEqual(rows.map((r) => r.device), ['Safari trên iPhone', 'Thiết bị khác', 'Máy tính bảng']);
  });

  test('sign-in method from providers; unreadable → null', () => {
    assert.equal(signInMethodLine({ app_metadata: { providers: ['email', 'google'] } }), 'Google hoặc mã qua email');
    assert.equal(signInMethodLine({ app_metadata: { provider: 'email' } }), 'Mã qua email');
    assert.equal(signInMethodLine({}), null);
    assert.equal(formatVnDateTime('nope'), null);
  });
});

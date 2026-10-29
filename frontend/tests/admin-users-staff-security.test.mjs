import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  activeChangeBanner,
  actorText,
  alertBadge,
  canManageStaff,
  eventLabel,
  formatVietnamTime,
  normalizeSecurityHistory,
  revokeRetryBanner,
  roleChangeBanner,
  sourceLabel,
  transitionText,
  UNKNOWN_ACTOR,
  validateReason,
} from '../app/(authed-admin-users)/admin/users/admin-staff-security-model.mjs';

// ADMINAAL2-0032 T011 — the admin users staff-security model. Rendered
// behaviour lives in tests/react/admin-users-staff-security.test.tsx.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'app', '(authed-admin-users)', 'admin', 'users');
const PANEL = readFileSync(join(DIR, 'admin-users-panel.tsx'), 'utf8');
const HISTORY = readFileSync(join(DIR, 'admin-security-history.tsx'), 'utf8');

describe('suspend / reactivate copy follows the backend answer', () => {
  test('only other admin and instructor rows can be suspended', () => {
    assert.equal(canManageStaff({ id: 'b', role: 'instructor' }, 'a'), true);
    assert.equal(canManageStaff({ id: 'b', role: 'admin' }, 'a'), true);
    assert.equal(canManageStaff({ id: 'a', role: 'admin' }, 'a'), false);
    assert.equal(canManageStaff({ id: 'b', role: 'student' }, 'a'), false);
    assert.equal(canManageStaff(null, 'a'), false);
  });

  test('a reason is 3–500 characters after trimming', () => {
    assert.equal(validateReason('abc'), null);
    assert.equal(validateReason('x'.repeat(500)), null);
    for (const bad of ['', '  ab  ', 'x'.repeat(501), null]) assert.match(validateReason(bad), /3–500/);
  });

  test('suspension: success, and a failed revocation offers the revoke retry', () => {
    assert.deepEqual(activeChangeBanner(false, { ok: true, is_active: false, sessions_revoked: true }),
      { kind: 'success', text: 'Đã tạm khóa và thu hồi phiên đăng nhập.', retry: null });
    const failed = activeChangeBanner(false, { ok: true, is_active: false, sessions_revoked: false, revoke_error: 'ban_failed' });
    assert.equal(failed.kind, 'warning');
    assert.equal(failed.retry, 'revoke');
    assert.match(failed.text, /chưa thu hồi được phiên — bấm Thu hồi phiên lại/);
  });

  test('reactivation that could not restore sign-in never claims the account was unlocked', () => {
    for (const ack of [
      { ok: false, is_active: false, changed: false, sign_in_restored: false },
      { ok: true, is_active: true, sign_in_restored: false },
      { ok: true, is_active: false, sign_in_restored: null },
    ]) {
      const banner = activeChangeBanner(true, ack);
      assert.equal(banner.kind, 'warning');
      assert.equal(banner.retry, 'reactivate');
      assert.doesNotMatch(banner.text, /^Đã mở khóa/);
    }
    assert.deepEqual(activeChangeBanner(true, { ok: true, is_active: true, sign_in_restored: true }),
      { kind: 'success', text: 'Đã mở khóa.', retry: null });
    assert.equal(activeChangeBanner(true, { ok: true, is_active: true, sign_in_restored: null }).kind, 'success');
  });

  test('a malformed answer is an error, not a success', () => {
    for (const ack of [null, {}, { is_active: 'false' }, []]) assert.equal(activeChangeBanner(false, ack).kind, 'error');
  });

  test('revoke retry and role change report the revocation outcome', () => {
    assert.equal(revokeRetryBanner({ ok: true, sessions_revoked: true }).kind, 'success');
    assert.equal(revokeRetryBanner({ ok: false, sessions_revoked: false }).retry, 'revoke');
    assert.equal(revokeRetryBanner(null).retry, 'revoke');
    assert.equal(roleChangeBanner('student', { ok: true, sessions_revoked: false }).retry, 'revoke');
    assert.deepEqual(roleChangeBanner('admin', { ok: true, sessions_revoked: null }),
      { kind: 'success', text: 'Đã cập nhật vai trò thành admin.', retry: null });
  });
});

describe('"Lịch sử quyền" rows', () => {
  const payload = (rows) => ({ rows, lookup_failed: false });
  const row = (id, occurred_at, extra = {}) => ({ id, occurred_at, event: 'role_changed', source: 'admin_api', ...extra });

  test('sorts newest first and keeps only display fields', () => {
    const rows = normalizeSecurityHistory(payload([
      row('old', '2026-10-01T00:00:00Z'),
      row('new', '2026-10-29T00:00:00Z', { actor_email: 'a@x.vn', reason: '  ', alert_status: 'sent', before: { role: 'student' } }),
    ]));
    assert.deepEqual(rows.map((r) => r.id), ['new', 'old']);
    assert.equal(rows[0].reason, null);
    assert.equal(rows[0].alertStatus, 'sent');
    assert.deepEqual(rows[0].before, { role: 'student' });
  });

  test('any malformed payload or row fails closed (shown as lookup failure, never empty)', () => {
    assert.deepEqual(normalizeSecurityHistory(payload([])), []);
    for (const bad of [null, [], { rows: [] }, { rows: null, lookup_failed: false }, { rows: [], lookup_failed: true },
      payload([{ id: 'x' }]), payload([row('x', 'not a date')]), payload([row(1, '2026-10-01T00:00:00Z')])]) {
      assert.equal(normalizeSecurityHistory(bad), null);
    }
  });

  test('times are Vietnam time whatever the browser zone', () => {
    assert.match(formatVietnamTime('2026-10-28T17:30:00Z'), /29\/10\/2026/);
    assert.match(formatVietnamTime('2026-10-28T17:30:00Z'), /00:30/);
    assert.equal(formatVietnamTime('nope'), '—');
  });

  test('labels: events, sources, badges with text, unknown actor', () => {
    assert.equal(eventLabel('active_changed'), 'Tạm khóa / mở khóa');
    assert.equal(eventLabel('future_event'), 'future_event');
    assert.equal(sourceLabel('out_of_band'), 'Ngoài ứng dụng');
    assert.deepEqual(alertBadge('failed'), { text: '⚠ gửi lỗi', tone: 'failed' });
    assert.equal(alertBadge('sent').text, 'đã gửi');
    assert.equal(alertBadge('pending').text, 'đang chờ');
    assert.equal(alertBadge(null), null);
    assert.equal(actorText({ actorEmail: null, actorUserId: null }), UNKNOWN_ACTOR);
    assert.equal(UNKNOWN_ACTOR, 'không rõ (ngoài ứng dụng)');
    assert.equal(actorText({ actorEmail: null, actorUserId: 'u-1' }), 'u-1');
  });

  test('before → after shows role and status; suspension is named', () => {
    assert.equal(transitionText({ role: 'instructor', is_active: true }, { role: 'instructor', is_active: false, suspended_at: '2026-10-29T00:00:00Z' }),
      'instructor · Active → instructor · Bị tạm khóa');
    assert.equal(transitionText(null, null), '—');
  });
});

describe('panel wiring', () => {
  test('calls the T006 routes through the typed transport and refetches the canonical list', () => {
    assert.match(PANEL, /patchBrowserJsonAt\(\s*'\/admin\/users\/\{user_id\}\/active'/);
    assert.match(PANEL, /postBrowserJsonAt\(\s*'\/admin\/users\/\{user_id\}\/revoke-sessions'/);
    assert.match(PANEL, /patchBrowserJsonAt\(\s*'\/admin\/users\/\{user_id\}\/role'/);
    assert.match(PANEL, /const finishStaffChange = async[\s\S]{0,160}await loadUsers\(true\)/);
    assert.doesNotMatch(PANEL, /setUsers\(\(/, 'no optimistic row edits');
    assert.match(HISTORY, /'\/admin\/users\/\{user_id\}\/security-audit'/);
    assert.match(HISTORY, /⚠ không tải được lịch sử/);
  });
});

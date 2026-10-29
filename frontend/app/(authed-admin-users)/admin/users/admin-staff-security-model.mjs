// ADMINAAL2-0032 T011 — pure helpers for the admin users staff-security UI
// (suspend/reactivate, revoke retry, "Lịch sử quyền"). The backend is the
// source of truth: these only validate wire shapes and choose the copy.

export const REASON_MIN = 3;
export const REASON_MAX = 500;

/**
 * @typedef {{ kind: 'success' | 'warning' | 'error', text: string, retry: 'revoke' | 'reactivate' | null }} StaffOutcome
 */

const record = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null;

/** Suspension applies to admin and instructor rows other than the caller's own. */
export function canManageStaff(user, profileId) {
  return Boolean(user && (user.role === 'admin' || user.role === 'instructor') && user.id !== profileId);
}

/** @returns {string | null} an error message, or null when the reason is valid. */
export function validateReason(value) {
  const length = typeof value === 'string' ? value.trim().length : 0;
  if (length < REASON_MIN || length > REASON_MAX) return `Lý do phải dài ${REASON_MIN}–${REASON_MAX} ký tự.`;
  return null;
}

/**
 * The banner for a `PATCH /admin/users/{id}/active` answer (FR-006, FR-008).
 * A reactivation whose unban failed changed nothing (`ok:false`): the account
 * is still suspended, so the copy must not claim it was unlocked.
 * `retry` names the follow-up the banner offers: `revoke` → POST
 * `…/revoke-sessions`, `reactivate` → repeat the PATCH.
 * @param {boolean} requested
 * @param {unknown} response
 * @returns {StaffOutcome}
 */
export function activeChangeBanner(requested, response) {
  const ack = record(response);
  if (!ack || typeof ack.is_active !== 'boolean') {
    return { kind: 'error', text: 'Backend trả kết quả tạm khóa/mở khóa không đúng định dạng. Hãy tải lại để xem trạng thái chuẩn.', retry: null };
  }
  if (requested === false) {
    if (ack.sessions_revoked === false) {
      return { kind: 'warning', text: 'Đã tạm khóa nhưng chưa thu hồi được phiên — bấm Thu hồi phiên lại.', retry: 'revoke' };
    }
    return { kind: 'success', text: 'Đã tạm khóa và thu hồi phiên đăng nhập.', retry: null };
  }
  if (ack.ok === false || ack.sign_in_restored === false || ack.is_active !== true) {
    return {
      kind: 'warning',
      text: 'Chưa mở khóa được: chưa khôi phục được đăng nhập nên tài khoản vẫn đang bị tạm khóa — bấm Thử lại.',
      retry: 'reactivate',
    };
  }
  return { kind: 'success', text: 'Đã mở khóa.', retry: null };
}

/**
 * The banner for `POST /admin/users/{id}/revoke-sessions` (FR-008 retry).
 * @param {unknown} response
 * @returns {StaffOutcome}
 */
export function revokeRetryBanner(response) {
  const ack = record(response);
  if (ack && ack.sessions_revoked === true) return { kind: 'success', text: 'Đã thu hồi phiên đăng nhập.', retry: null };
  return { kind: 'warning', text: 'Vẫn chưa thu hồi được phiên — bấm Thu hồi phiên lại.', retry: 'revoke' };
}

/**
 * A role change that removed privilege but could not revoke (FR-007/FR-008).
 * @param {string} nextRole
 * @param {unknown} response
 * @returns {StaffOutcome}
 */
export function roleChangeBanner(nextRole, response) {
  const ack = record(response);
  if (ack && ack.sessions_revoked === false) {
    return { kind: 'warning', text: `Đã đổi vai trò thành ${nextRole} nhưng chưa thu hồi được phiên — bấm Thu hồi phiên lại.`, retry: 'revoke' };
  }
  return { kind: 'success', text: `Đã cập nhật vai trò thành ${nextRole}.`, retry: null };
}

const EVENT_LABELS = Object.freeze({
  role_changed: 'Đổi vai trò',
  active_changed: 'Tạm khóa / mở khóa',
  staff_row_inserted: 'Tạo tài khoản nhân sự',
  sessions_revoked: 'Thu hồi phiên',
  sessions_revoke_failed: 'Thu hồi phiên thất bại',
  mfa_factor_enrolled: 'Thêm yếu tố 2 bước',
  mfa_factor_verified: 'Xác minh yếu tố 2 bước',
  mfa_factor_deleted: 'Gỡ yếu tố 2 bước',
  bootstrap_recovery: 'Khôi phục admin (owner)',
});

const SOURCE_LABELS = Object.freeze({
  admin_api: 'Trang admin',
  service: 'Hệ thống',
  out_of_band: 'Ngoài ứng dụng',
  auth: 'Supabase Auth',
});

const ALERT_LABELS = Object.freeze({
  sent: { text: 'đã gửi', tone: 'sent' },
  pending: { text: 'đang chờ', tone: 'pending' },
  failed: { text: '⚠ gửi lỗi', tone: 'failed' },
});

export const UNKNOWN_ACTOR = 'không rõ (ngoài ứng dụng)';

/** The actor's email; a known actor whose email is unreadable keeps its id. */
export function actorText(row) {
  return row?.actorEmail || row?.actorUserId || UNKNOWN_ACTOR;
}

export function eventLabel(event) {
  return EVENT_LABELS[event] || event;
}

export function sourceLabel(source) {
  return SOURCE_LABELS[source] || source;
}

/** @returns {{text: string, tone: string} | null} null when the event sends no owner alert. */
export function alertBadge(status) {
  return ALERT_LABELS[status] || null;
}

/** Vietnam time (FR-011/FR-015), independent of the browser's time zone. */
export function formatVietnamTime(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(parsed);
}

function stateText(value) {
  const state = record(value);
  if (!state) return '—';
  const parts = [];
  if (typeof state.role === 'string') parts.push(state.role);
  if (typeof state.is_active === 'boolean') {
    parts.push(state.suspended_at ? 'Bị tạm khóa' : state.is_active ? 'Active' : 'Inactive');
  }
  return parts.length ? parts.join(' · ') : '—';
}

/** "before → after" for a privilege row; mfa and revocation rows carry no state. */
export function transitionText(before, after) {
  if (!record(before) && !record(after)) return '—';
  return `${stateText(before)} → ${stateText(after)}`;
}

/**
 * Validate `GET /admin/users/{id}/security-audit`. Returns the rows newest
 * first, or null for any shape the UI cannot show truthfully (the caller then
 * shows the lookup-failed state, never an empty history).
 */
export function normalizeSecurityHistory(payload) {
  const body = record(payload);
  if (!body || body.lookup_failed !== false || !Array.isArray(body.rows)) return null;
  const rows = [];
  for (const raw of body.rows) {
    const row = record(raw);
    if (!row || typeof row.id !== 'string' || typeof row.event !== 'string'
      || typeof row.source !== 'string' || typeof row.occurred_at !== 'string'
      || Number.isNaN(new Date(row.occurred_at).getTime())) return null;
    rows.push({
      id: row.id,
      occurredAt: row.occurred_at,
      event: row.event,
      source: row.source,
      actorEmail: typeof row.actor_email === 'string' && row.actor_email ? row.actor_email : null,
      actorUserId: typeof row.actor_user_id === 'string' && row.actor_user_id ? row.actor_user_id : null,
      before: record(row.before),
      after: record(row.after),
      reason: typeof row.reason === 'string' && row.reason.trim() ? row.reason : null,
      alertStatus: typeof row.alert_status === 'string' ? row.alert_status : null,
    });
  }
  return rows.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
}

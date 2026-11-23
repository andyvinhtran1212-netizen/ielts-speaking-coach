const ROLES = new Set(['admin', 'instructor', 'student']);
const CODE_TYPES = new Set(['mass', 'direct', 'staff']);

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function text(value) {
  return typeof value === 'string' ? value : '';
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function optionalFinite(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizePermissions(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
    : [];
}

function normalizeQuota(value) {
  const row = object(value);
  if (!Object.keys(row).length) return null;
  const limit = optionalFinite(row.limit);
  const used = Math.max(0, finite(row.used));
  return {
    used,
    limit,
    remaining: limit == null ? null : Math.max(0, optionalFinite(row.remaining) ?? limit - used),
    limit_type: text(row.limit_type) || (limit == null ? 'unlimited' : 'per_user_via_code'),
  };
}

function normalizeAssignedUser(value) {
  const row = object(value);
  const userId = text(row.user_id);
  if (!userId) return null;
  return {
    user_id: userId,
    name: text(row.name),
    email: text(row.email),
    is_fallback_used_by: Boolean(row.is_fallback_used_by),
    removable: Boolean(row.removable),
    quota: normalizeQuota(row.quota),
  };
}

function normalizeSummaryCode(value) {
  const row = object(value);
  const id = text(row.id);
  if (!id) return null;
  return {
    id,
    code: text(row.code),
    code_type: CODE_TYPES.has(row.code_type) ? row.code_type : text(row.code_type),
    permissions: normalizePermissions(row.permissions),
    is_active: row.is_active !== false,
    created_at: text(row.created_at) || null,
  };
}

export function normalizeUser(value) {
  const row = object(value);
  const id = text(row.id);
  if (!id) return null;
  const summary = object(row.code_summary);
  const codes = (Array.isArray(summary.codes) ? summary.codes : [])
    .map(normalizeSummaryCode)
    .filter(Boolean);
  const role = text(row.role).toLowerCase();
  const cohortNames = Array.isArray(row.cohort_names)
    ? row.cohort_names.map(text).filter(Boolean) : [];
  return {
    id,
    email: text(row.email),
    display_name: text(row.display_name),
    created_at: text(row.created_at) || null,
    is_active: row.is_active !== false,
    role: ROLES.has(role) ? role : 'student',
    sessions_today: Math.max(0, finite(row.sessions_today)),
    cohort_name: text(row.cohort_name) || null,
    cohort_names: cohortNames,
    cohort_lookup_failed: Boolean(row.cohort_lookup_failed),
    code_summary: {
      codes,
      code_count: Math.max(codes.length, finite(summary.code_count)),
      code_type: CODE_TYPES.has(summary.code_type) ? summary.code_type : text(summary.code_type) || null,
      permissions: normalizePermissions(summary.permissions),
      has_active_code: Boolean(summary.has_active_code),
    },
  };
}

export function normalizeUsersPayload(value) {
  return (Array.isArray(value) ? value : []).map(normalizeUser).filter(Boolean);
}

export function normalizeAccessCode(value) {
  const row = object(value);
  const id = text(row.id);
  if (!id) return null;
  const assignedUsers = (Array.isArray(row.assigned_users) ? row.assigned_users : [])
    .map(normalizeAssignedUser)
    .filter(Boolean);
  return {
    id,
    code: text(row.code),
    is_used: Boolean(row.is_used),
    is_revoked: Boolean(row.is_revoked),
    is_active: row.is_active !== false,
    used_by: text(row.used_by) || null,
    used_at: text(row.used_at) || null,
    created_at: text(row.created_at) || null,
    permissions: normalizePermissions(row.permissions),
    session_limit: optionalFinite(row.session_limit),
    expires_at: text(row.expires_at) || null,
    code_type: CODE_TYPES.has(row.code_type) ? row.code_type : 'mass',
    cohort_id: text(row.cohort_id) || null,
    cohort_name: text(row.cohort_name) || null,
    notes: text(row.notes) || null,
    assigned_user_count: Math.max(assignedUsers.length, finite(row.assigned_user_count)),
    assigned_users: assignedUsers,
    association_lookup_failed: Boolean(row.association_lookup_failed),
    // G04 credits granted with the code; the list API does not return it yet,
    // so it stays null and the ledger shows "chưa có" (ADMINIA-0074 FR-048).
    grant_credits: optionalFinite(row.grant_credits),
  };
}

export function normalizeCodesPayload(value) {
  return (Array.isArray(value) ? value : []).map(normalizeAccessCode).filter(Boolean);
}

export function activeAssignmentCount(value) {
  const users = Array.isArray(object(value).assigned_users) ? object(value).assigned_users : [];
  return users.filter((item) => {
    const user = object(item);
    return user.removable === true && user.is_fallback_used_by !== true;
  }).length;
}

export function normalizeCohortsPayload(value) {
  const rows = Array.isArray(value) ? value : Array.isArray(object(value).cohorts) ? object(value).cohorts : [];
  return rows.map((item) => {
    const row = object(item);
    const id = text(row.id);
    if (!id) return null;
    return { id, name: text(row.name) || 'Lớp chưa đặt tên' };
  }).filter(Boolean);
}

function userSortValue(user, field) {
  if (field === 'display_name') return user.display_name.toLocaleLowerCase('vi');
  if (field === 'role') return user.role;
  if (field === 'cohort_name') return (user.cohort_names.join(' ') || user.cohort_name || '').toLocaleLowerCase('vi');
  if (field === 'code_type') return user.code_summary.code_type || '';
  if (field === 'code_status') return user.code_summary.has_active_code ? 0 : 1;
  return user.created_at || '';
}

export function selectUsers(users, filters, sort) {
  const search = text(filters?.search).trim().toLocaleLowerCase('vi');
  const role = text(filters?.role);
  const direction = sort?.order === 'asc' ? 1 : -1;
  const field = text(sort?.field) || 'created_at';
  return [...users].filter((user) => {
    if (role && user.role !== role) return false;
    if (!search) return true;
    return `${user.email} ${user.display_name}`.toLocaleLowerCase('vi').includes(search);
  }).sort((left, right) => {
    const a = userSortValue(left, field);
    const b = userSortValue(right, field);
    return a < b ? -direction : a > b ? direction : 0;
  });
}

export function codeStatusRank(code) {
  if (code?.is_revoked) return 2;
  if (code?.is_active === false) return 1;
  return 0;
}

export function quotaLabel(quota) {
  if (!quota) return '';
  if (quota.limit == null || quota.limit_type === 'unlimited') return `${quota.used} / ∞`;
  return `${quota.used}/${quota.limit} · còn ${quota.remaining ?? Math.max(0, quota.limit - quota.used)}`;
}

export function selectCodes(codes, filters, sort) {
  const search = text(filters?.search).trim().toLocaleLowerCase('vi');
  const type = text(filters?.type);
  const status = text(filters?.status);
  const cohort = text(filters?.cohort);
  const direction = sort?.order === 'asc' ? 1 : -1;
  const field = text(sort?.field) || 'created_at';
  return [...codes].filter((code) => {
    if (type && code.code_type !== type) return false;
    if (!status && code.is_revoked) return false;
    if (status === 'active' && (code.is_revoked || !code.is_active)) return false;
    if (status === 'revoked' && !code.is_revoked) return false;
    if (cohort && code.cohort_id !== cohort) return false;
    if (!search) return true;
    return code.code.toLocaleLowerCase('vi').includes(search)
      || code.assigned_users.some((user) => user.email.toLocaleLowerCase('vi').includes(search));
  }).sort((left, right) => {
    if (field === 'status') return (codeStatusRank(left) - codeStatusRank(right)) * direction;
    const a = left[field] ? new Date(left[field]).getTime() : null;
    const b = right[field] ? new Date(right[field]).getTime() : null;
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    return (a - b) * direction;
  });
}

/**
 * @param {{
 *   codeType: string,
 *   cohortId: string | null,
 *   permissions: string[],
 *   sessionLimitRaw: string,
 *   countRaw?: string | number | null,
 * }} draft
 */
export function validateCodeDraft({ codeType, cohortId, permissions, sessionLimitRaw, countRaw = null }) {
  if (!CODE_TYPES.has(codeType)) return { ok: false, error: 'Loại mã không hợp lệ.' };
  if (codeType === 'direct' && !cohortId) return { ok: false, error: 'Mã trực tiếp bắt buộc phải chọn lớp.' };
  if (codeType !== 'direct' && cohortId) return { ok: false, error: 'Chỉ mã Trực tiếp mới được gán lớp.' };
  if (!Array.isArray(permissions) || !permissions.length) return { ok: false, error: 'Phải chọn ít nhất một quyền.' };
  const sessionLimit = sessionLimitRaw === '' ? null : Number(sessionLimitRaw);
  if (sessionLimit != null && (!Number.isInteger(sessionLimit) || sessionLimit < 1)) {
    return { ok: false, error: 'Giới hạn lượt phải là số nguyên ≥ 1 hoặc để trống.' };
  }
  const count = countRaw == null ? undefined : Number(countRaw);
  if (count != null && (!Number.isInteger(count) || count < 1 || count > 100)) {
    return { ok: false, error: 'Số lượng mã phải từ 1 đến 100.' };
  }
  return { ok: true, sessionLimit, count };
}

// ADMINIA-0074 FR-048: ledger states of an activation code. `expiringDays` is
// the `code_expiring_days` threshold (backend/services/ops_thresholds.py).
export const DEFAULT_CODE_EXPIRING_DAYS = 14;
const DAY_MS = 86_400_000;

export function codeLedgerState(code, { now = Date.now(), expiringDays = DEFAULT_CODE_EXPIRING_DAYS } = {}) {
  if (code?.is_revoked) return { state: 'revoked', label: 'Đã thu hồi', expiringSoon: false };
  if (code?.is_used || code?.used_by || finite(code?.assigned_user_count) > 0) {
    return { state: 'used', label: 'Đã dùng', expiringSoon: false };
  }
  const deadline = code?.expires_at ? Date.parse(code.expires_at) : Number.NaN;
  if (Number.isFinite(deadline) && deadline <= now) return { state: 'expired', label: 'Hết hạn nhập', expiringSoon: false };
  const expiringSoon = Number.isFinite(deadline) && expiringDays != null && deadline - now <= expiringDays * DAY_MS;
  return { state: 'unused', label: 'Chưa dùng', expiringSoon };
}

export function grantCreditsLabel(code) {
  return code?.grant_credits == null ? 'chưa có' : `${Number(code.grant_credits).toLocaleString('vi-VN')} lượt`;
}

export function expiringDaysFromThresholds(payload) {
  const items = Array.isArray(object(payload).items) ? object(payload).items : [];
  const item = object(items.find((entry) => object(entry).key === 'code_expiring_days'));
  const value = optionalFinite(item.value);
  return value != null && value >= 1 ? Math.floor(value) : DEFAULT_CODE_EXPIRING_DAYS;
}

// ── ADMINIA-0074 FR-055: code detail page and danger-zone revoke ─────────────
// The detail endpoint returns `assignments[{display_name, email, ...}]`, not
// the list's `assigned_users[{name, email, ...}]` (AGENTS.md › Admin
// conventions); it is transformed explicitly here, never assigned as-is.

export const REVOKE_REASON_MIN = 10;
export const REVOKE_REASON_MAX = 500;

export function normalizeCodeDetail(value) {
  const row = object(value);
  const assignments = Array.isArray(row.assignments) ? row.assignments : [];
  const assignedUsers = assignments.map((item) => {
    const entry = object(item);
    const userId = text(entry.user_id);
    if (!userId) return null;
    const fallback = Boolean(entry.is_fallback_used_by);
    return {
      user_id: userId,
      name: text(entry.display_name),
      email: text(entry.email),
      assigned_at: text(entry.assigned_at) || null,
      is_active: entry.is_active === true,
      is_fallback_used_by: fallback,
      removable: !fallback && entry.is_active === true,
      quota: null,
    };
  }).filter(Boolean);
  const base = normalizeAccessCode({ ...row, assigned_users: [], assigned_user_count: 0 });
  if (!base) return null;
  // `access_holders` is the server's own list of who loses access on revoke
  // (active assignments + a legacy redeemer with no row); null when the
  // assignment lookup failed. The page never recounts it from `assignments`.
  const holders = Array.isArray(row.access_holders)
    ? row.access_holders.map((item) => {
      const entry = object(item);
      const userId = text(entry.user_id);
      return userId ? { user_id: userId, name: text(entry.display_name), email: text(entry.email) } : null;
    }).filter(Boolean)
    : null;
  return {
    ...base,
    assigned_users: assignedUsers,
    assigned_user_count: assignedUsers.filter((user) => user.is_active || user.is_fallback_used_by).length,
    access_holders: holders,
  };
}

const AUDIT_ACTIONS = Object.freeze({
  create: 'Tạo mã',
  edit: 'Sửa quyền',
  revoke: 'Thu hồi mã',
  remove_user: 'Gỡ người dùng',
  reassign: 'Gán lại',
  refill: 'Cấp mã mới',
  hard_delete: 'Xoá hẳn',
});

export function auditActionLabel(action) {
  return AUDIT_ACTIONS[action] || text(action) || 'Thao tác';
}

export function normalizeCodeAudit(value) {
  return (Array.isArray(value) ? value : []).map((item) => {
    const row = object(item);
    const id = text(row.id) || (row.id != null ? String(row.id) : '');
    if (!id) return null;
    const after = object(row.after);
    return {
      id,
      action: text(row.action),
      actor_user_id: text(row.actor_user_id) || null,
      target_user_id: text(row.target_user_id) || null,
      created_at: text(row.created_at) || null,
      reason: text(after.reason) || null,
      affected_user_count: Array.isArray(after.affected_user_ids) ? after.affected_user_ids.length : null,
      source: text(after.source) || null,
    };
  }).filter(Boolean);
}

/** First problem with a danger-zone revoke draft, or null when it can be sent. */
export function revokeUsedDraftError({ code, confirmCode, reason }) {
  if (text(confirmCode).trim().toUpperCase() !== text(code).trim().toUpperCase() || !text(code).trim()) {
    return 'Gõ lại đúng mã cần thu hồi.';
  }
  const trimmed = text(reason).trim();
  if (trimmed.length < REVOKE_REASON_MIN) return `Lý do cần ít nhất ${REVOKE_REASON_MIN} ký tự.`;
  if (trimmed.length > REVOKE_REASON_MAX) return `Lý do tối đa ${REVOKE_REASON_MAX} ký tự.`;
  return null;
}

/** The message shown after `POST /admin/access-codes/{id}/revoke-used`. */
export function revokeUsedResultMessage(result) {
  const row = object(result);
  const code = text(row.code);
  if (row.already_revoked) {
    return row.audit_recorded === false
      ? { kind: 'error', text: `Mã ${code} đã được thu hồi từ trước, nhưng không thấy lý do thu hồi trong nhật ký mã.` }
      : { kind: 'success', text: `Mã ${code} đã được thu hồi từ trước.` };
  }
  const count = Math.max(0, finite(row.affected_user_count));
  const base = `Đã thu hồi mã ${code}. ${count} học viên mất quyền từ mã này.`;
  if (row.audit_recorded === false) {
    return { kind: 'error', text: `${base} Chưa ghi được lý do vào nhật ký mã; hãy báo kỹ thuật để ghi bù.` };
  }
  return { kind: 'success', text: base };
}

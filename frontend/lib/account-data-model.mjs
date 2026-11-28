// ACCOUNTDATA-0100 ui-states.md: the account page's "Dữ liệu của tôi" block,
// the "Yêu cầu xoá tài khoản và dữ liệu" danger zone and the pending-deletion
// notice. The shapes follow the routes of #2600 (plan section 4); the page
// reads them again after every action and never keeps its own copy of truth.

import { formatVnDate } from './account-model.mjs';

// "HH:mm, dd/mm/yyyy" in Vietnam time, as the Hồ sơ tree prints times.
const VN_TIME = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function formatVnDateTime(iso) {
  if (typeof iso !== 'string' || !iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const part = Object.fromEntries(VN_TIME.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return `${part.hour}:${part.minute}, ${part.day}/${part.month}/${part.year}`;
}

const DELETION_STATUSES = new Set(['none', 'pending', 'erasing']);
const EXPORT_STATUSES = new Set(['none', 'queued', 'building', 'ready', 'expired', 'failed', 'cancelled', 'purged']);
const STAFF_ROLES = new Set(['admin', 'instructor']);

const str = (v) => (typeof v === 'string' && v ? v : null);

/** `GET /api/account/deletion-request` → view, or null for another shape. */
export function normalizeDeletion(raw) {
  if (!raw || typeof raw !== 'object' || !DELETION_STATUSES.has(raw.status)) return null;
  return { status: raw.status, requestedAt: str(raw.requested_at), eraseAfter: str(raw.erase_after) };
}

/** `GET`/`POST /api/account/data-export` → view, or null for another shape. */
export function normalizeExport(raw) {
  if (!raw || typeof raw !== 'object' || !EXPORT_STATUSES.has(raw.status)) return null;
  return {
    status: raw.status,
    exportId: str(raw.export_id),
    requestedAt: str(raw.requested_at),
    readyAt: str(raw.ready_at),
    expiresAt: str(raw.expires_at),
    sizeBytes: Number.isInteger(raw.size_bytes) && raw.size_bytes >= 0 ? raw.size_bytes : null,
  };
}

/** FR-001: trimmed, case-insensitive; an empty login email never matches. */
export function emailMatches(typed, loginEmail) {
  const login = typeof loginEmail === 'string' ? loginEmail.trim().toLowerCase() : '';
  if (!login) return false;
  return typeof typed === 'string' && typed.trim().toLowerCase() === login;
}

export function isStaffRole(role) {
  return STAFF_ROLES.has(role);
}

/** The `error_code` of an api.js error (`detail.error_code`), or null. */
export function errorCode(error) {
  const detail = error && typeof error === 'object' ? error.detail : null;
  return detail && typeof detail === 'object' && typeof detail.error_code === 'string' ? detail.error_code : null;
}

export function errorStatus(error) {
  const status = error && typeof error === 'object' ? error.status : null;
  return typeof status === 'number' ? status : null;
}

/** 429 `retry_after` seconds → "HH:mm, dd/mm/yyyy", or null. */
export function retryAtText(error, now = Date.now()) {
  const detail = error && typeof error === 'object' ? error.detail : null;
  const seconds = detail && typeof detail === 'object' ? detail.retry_after : null;
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return formatVnDateTime(new Date(now + seconds * 1000).toISOString());
}

/** "12,3 MB" / "850 KB"; null when unknown. */
export function sizeText(bytes) {
  if (!Number.isInteger(bytes) || bytes < 0) return null;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export const eraseDateText = (iso) => formatVnDate(iso);
export const exportTimeText = (iso) => formatVnDateTime(iso);

export function downloadPath(exportId) {
  return `/api/account/data-export/${encodeURIComponent(exportId)}/download`;
}

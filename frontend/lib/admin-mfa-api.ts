import 'client-only';

import { getBrowserJson } from '@/lib/browser-api';
import type { ApiGetJson } from '@/lib/openapi-contract';
import { normalizeAdminMfaStatus } from '@/lib/admin-mfa-model.mjs';

export type AdminMfaStatusWire = ApiGetJson<'/admin/mfa/status'>;

// PC-J237: the backend no longer answers this read with 429, but a backend
// deployed before that change still can (Vercel and Railway deploy apart).
// One fixed retry; the browser cannot read Retry-After cross-origin.
export const ADMIN_MFA_STATUS_RETRY_MS = 2_000;
export const ADMIN_MFA_STATUS_RATE_LIMITED =
  'Hệ thống đang giới hạn tần suất kiểm tra bảo mật. Vui lòng thử lại sau 1 phút.';

function isRateLimited(caught: unknown) {
  return (caught as { status?: number } | null)?.status === 429;
}

function abortReason(signal: AbortSignal) {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortReason(signal));
    const onAbort = () => { clearTimeout(timer); reject(abortReason(signal as AbortSignal)); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function readStatus(signal?: AbortSignal) {
  try {
    return await getBrowserJson('/admin/mfa/status', undefined, signal);
  } catch (caught) {
    if (!isRateLimited(caught)) throw caught;
  }
  await wait(ADMIN_MFA_STATUS_RETRY_MS, signal);
  try {
    return await getBrowserJson('/admin/mfa/status', undefined, signal);
  } catch (caught) {
    if (!isRateLimited(caught)) throw caught;
    throw Object.assign(new Error(ADMIN_MFA_STATUS_RATE_LIMITED), {
      status: 429,
      detail: (caught as { detail?: unknown }).detail ?? null,
    });
  }
}

/**
 * The caller's own assurance (ADMINAAL2-0032 FR-004). Never cached: every
 * gate and page load reads it again, so a factor change or a flag flip is
 * seen on the next navigation. A malformed payload throws, so callers fail
 * closed instead of treating it as AAL2. A 429 is retried once and then
 * thrown with its own message; it is never treated as any assurance.
 */
export async function getAdminMfaStatus(signal?: AbortSignal): Promise<AdminMfaStatusWire> {
  const normalized = normalizeAdminMfaStatus(await readStatus(signal));
  if (!normalized) throw new Error('Backend trả trạng thái xác thực 2 bước không đúng định dạng.');
  return normalized as AdminMfaStatusWire;
}

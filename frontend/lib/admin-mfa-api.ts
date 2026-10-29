import 'client-only';

import { getBrowserJson } from '@/lib/browser-api';
import type { ApiGetJson } from '@/lib/openapi-contract';
import { normalizeAdminMfaStatus } from '@/lib/admin-mfa-model.mjs';

export type AdminMfaStatusWire = ApiGetJson<'/admin/mfa/status'>;

/**
 * The caller's own assurance (ADMINAAL2-0032 FR-004). Never cached: every
 * gate and page load reads it again, so a factor change or a flag flip is
 * seen on the next navigation. A malformed payload throws, so callers fail
 * closed instead of treating it as AAL2.
 */
export async function getAdminMfaStatus(signal?: AbortSignal): Promise<AdminMfaStatusWire> {
  const normalized = normalizeAdminMfaStatus(
    await getBrowserJson('/admin/mfa/status', undefined, signal),
  );
  if (!normalized) throw new Error('Backend trả trạng thái xác thực 2 bước không đúng định dạng.');
  return normalized as AdminMfaStatusWire;
}

import 'client-only';

import { getBrowserJson } from '@/lib/browser-api';
import type { ApiGetJson } from '@/lib/openapi-contract';

export type AdminUsersWire = ApiGetJson<'/admin/users'>;
export type AdminAccessCodesWire = ApiGetJson<'/admin/access-codes'>;

export function getAdminUsers() {
  return getBrowserJson('/admin/users');
}

export function getAdminAccessCodes() {
  return getBrowserJson('/admin/access-codes');
}

export type AdminThresholdsWire = ApiGetJson<'/admin/settings/thresholds'>;

// ADMINIA-0074 FR-048: the ledger reads `code_expiring_days` from the shared
// operational thresholds; callers fall back to the default when it fails.
export function getAdminThresholds() {
  return getBrowserJson('/admin/settings/thresholds');
}

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

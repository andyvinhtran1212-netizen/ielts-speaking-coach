import 'client-only';

import { getBrowserJson } from '@/lib/browser-api';
import type { ApiGetJson } from '@/lib/openapi-contract';
import {
  normalizeAuthActiveStatus,
  normalizeAuthMe,
  normalizeAuthProfile,
  normalizeAuthRoleIdentity,
} from '@/lib/auth-wire-model.mjs';

export type AuthMeWire = ApiGetJson<'/auth/me'>;
export type AuthProfileWire = ApiGetJson<'/auth/profile'>;
export type AuthActiveStatusWire = ApiGetJson<'/auth/check-active'>;
export type AuthRoleIdentity = Pick<AuthMeWire, 'id' | 'email' | 'role'>;

/** Minimal authorization projection used by admin/instructor role gates. */
export async function getAuthorizationIdentity(signal?: AbortSignal): Promise<AuthRoleIdentity> {
  const normalized = normalizeAuthRoleIdentity(
    await getBrowserJson('/auth/me', undefined, signal),
  );
  if (!normalized) throw new Error('Backend trả danh tính phân quyền không đúng định dạng.');
  return normalized as AuthRoleIdentity;
}

/** Always reads canonical, private identity through the bearer-aware browser transport. */
export async function getCurrentUser(signal?: AbortSignal): Promise<AuthMeWire> {
  const normalized = normalizeAuthMe(await getBrowserJson('/auth/me', undefined, signal));
  if (!normalized) throw new Error('Backend trả dữ liệu /auth/me không đúng định dạng.');
  return normalized as AuthMeWire;
}

export async function getCurrentProfile(signal?: AbortSignal): Promise<AuthProfileWire> {
  const normalized = normalizeAuthProfile(await getBrowserJson('/auth/profile', undefined, signal));
  if (!normalized) throw new Error('Backend trả dữ liệu /auth/profile không đúng định dạng.');
  return normalized as AuthProfileWire;
}

export async function getCurrentActiveStatus(signal?: AbortSignal): Promise<AuthActiveStatusWire> {
  const normalized = normalizeAuthActiveStatus(
    await getBrowserJson('/auth/check-active', undefined, signal),
  );
  if (!normalized) throw new Error('Backend trả dữ liệu /auth/check-active không đúng định dạng.');
  return normalized as AuthActiveStatusWire;
}

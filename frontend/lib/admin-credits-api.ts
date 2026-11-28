// The credit ledger uses the G04 contracts through the shared admin transport.
import { getBrowserJson, getBrowserJsonAt, postBrowserJsonAt } from '@/lib/browser-api';
import type { ApiGetJson } from '@/lib/openapi-contract';
import type { paths } from '@/types/api';

export type UserAccessWire = ApiGetJson<'/admin/users/{user_id}/access'>;
export type UserCreditsWire = ApiGetJson<'/admin/users/{user_id}/credits'>;
export type LedgerRowWire = UserCreditsWire['items'][number];

type AdjustBody = paths['/admin/credits/adjust']['post']['requestBody']['content']['application/json'];

/** The learner directory (G09-T03), used only to find a person by name or email. */
export type LearnerMatchWire = ApiGetJson<'/admin/learners'>['items'][number];

export function findLearners(q: string) {
  return getBrowserJson('/admin/learners', new URLSearchParams({ q, page: '1' }));
}

export function getUserAccess(userId: string, signal?: AbortSignal) {
  return getBrowserJsonAt(
    '/admin/users/{user_id}/access', `/admin/users/${encodeURIComponent(userId)}/access`, signal,
  );
}

export function getUserCredits(userId: string, limit: number, cursor?: string | null, signal?: AbortSignal) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor) query.set('cursor', cursor);
  return getBrowserJsonAt(
    '/admin/users/{user_id}/credits', `/admin/users/${encodeURIComponent(userId)}/credits?${query}`, signal,
  );
}

export function postCreditAdjust(body: AdjustBody) {
  return postBrowserJsonAt('/admin/credits/adjust', '/admin/credits/adjust', body);
}

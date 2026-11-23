// G04 admin credit reads and the adjust write (COURSEACCESS-0055 T005, #2571
// stack) for the credit ledger page (ADMINIA-0074 G09-T15). Those routes are
// not in api.d.ts on this branch and declare no response model (their
// generated type would be `unknown` anyway), so they go through window.api
// with the shapes routers/admin_commerce.py (user_access, user_credits,
// adjust_credits) returns. Until the G04 stack is on the same environment the
// reads fail and the page says so; the page sits behind ADMIN_FRAME_V2.
import { getBrowserJson } from '@/lib/browser-api';
import type { ApiGetJson } from '@/lib/openapi-contract';

export type CreditsBlockWire = {
  balance: number;
  usable_from: string | null;
  usable_until: string | null;
  carry_balance: number;
  carry_expires_at: string | null;
};

export type AccessItemWire = {
  entitlement_id: string | null;
  course_code: string | null;
  product_slug: string | null;
  title: string | null;
  short_title: string | null;
  kind: string;
  source: string | null;
  state: 'active' | 'expired' | 'revoked' | string;
  starts_at: string | null;
  expires_at: string | null;
  credits: CreditsBlockWire | null;
};

export type UserAccessWire = {
  items: AccessItemWire[];
  credits: { total: number; by_kind: { online: number; class: number } };
};

export type LedgerRowWire = {
  at: string | null;
  delta: number;
  reason: string | null;
  balance_after: number;
  course_code: string | null;
  feature: string | null;
  label_vi: string | null;
  note: string | null;
  entitlement_id: string | null;
  actor: { id: string; email: string | null; display_name: string | null } | null;
};

export type UserCreditsWire = { balance: number; items: LedgerRowWire[]; next_cursor: string | null };

export type AdjustBody = { entitlement_id: string; delta: number; reason: string; request_key: string };
export type AdjustWire = { status: 'adjusted' | 'replay'; balance: number | null };

/** The learner directory (G09-T03), used only to find a person by name or email. */
export type LearnerMatchWire = ApiGetJson<'/admin/learners'>['items'][number];

export function findLearners(q: string) {
  return getBrowserJson('/admin/learners', new URLSearchParams({ q, page: '1' }));
}

export function getUserAccess(userId: string, signal?: AbortSignal) {
  return window.api.getWith<UserAccessWire>(`/admin/users/${encodeURIComponent(userId)}/access`,
    undefined, signal ? { signal } : undefined);
}

export function getUserCredits(userId: string, limit: number, cursor?: string | null, signal?: AbortSignal) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor) query.set('cursor', cursor);
  return window.api.getWith<UserCreditsWire>(`/admin/users/${encodeURIComponent(userId)}/credits?${query}`,
    undefined, signal ? { signal } : undefined);
}

export function postCreditAdjust(body: AdjustBody) {
  return window.api.post<AdjustWire>('/admin/credits/adjust', body);
}

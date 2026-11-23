// G04 course access of one learner, read for the profile's re-practice grant
// and revoke (ADMINIA-0074 FR-045, FR-046; G09-T14b). `GET
// /admin/users/{id}/access` (COURSEACCESS-0055, #2571 stack) is not in
// api.d.ts on this base and declares no response model, so it goes through
// window.api with the shape routers/admin_commerce.py returns.
import type { CourseProductWire } from '@/lib/admin-practice-grant-model.mjs';

export type AccessItemWire = {
  entitlement_id: string | null;
  product_slug: string | null;
  course_code: string | null;
  title: string | null;
  short_title: string | null;
  kind: string;
  state: string;
  expires_at: string | null;
};

export function getUserAccess(userId: string) {
  return window.api.getWith<{ items: AccessItemWire[] }>(`/admin/users/${encodeURIComponent(userId)}/access`);
}

export type RevocableEntitlement = { entitlementId: string; title: string };

/** Course accesses in force that come from an entitlement (a legacy code has none and is not revoked here). */
export function revocableEntitlements(items: AccessItemWire[] | null | undefined): RevocableEntitlement[] {
  return (items ?? [])
    .filter((i) => i.entitlement_id && i.state === 'active')
    .map((i) => ({ entitlementId: String(i.entitlement_id), title: i.short_title || i.title || i.course_code || 'Khoá không tên' }));
}

/** Course ids the learner holds in force, matched through the product slug G04 returns on both reads. */
export function heldCourseIds(items: AccessItemWire[] | null | undefined, products: CourseProductWire[] | null | undefined): string[] {
  const bySlug = new Map((products ?? []).filter((p) => p.slug).map((p) => [String(p.slug), String(p.course_id)]));
  const out = new Set<string>();
  for (const item of items ?? []) {
    if (item.state !== 'active' || !item.product_slug) continue;
    const course = bySlug.get(item.product_slug);
    if (course) out.add(course);
  }
  return [...out];
}

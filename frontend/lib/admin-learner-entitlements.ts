// G04 course access of one learner, read for the profile's revoke rows
// (ADMINIA-0074 FR-046; G09-T14b); the grant form reads access itself. `GET
// /admin/users/{id}/access` (COURSEACCESS-0055, #2571 stack) is not in
// api.d.ts on this base and declares no response model, so it goes through
// window.api with the shape routers/admin_commerce.py returns.
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

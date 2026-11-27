// G04 grant/revoke writes and the product list (COURSEACCESS-0055 T005, #2571)
// for the shared re-practice grant and revoke forms (ADMINIA-0074 G09-T14).
// These routes are not in api.d.ts on this branch and declare no response
// model, so they go through window.api with the shapes routers/admin_commerce.py
// returns (list_products, user_access, grant_entitlement, revoke_entitlement).
import type { CourseProductWire } from '@/lib/admin-practice-grant-model.mjs';

export type EntitlementWire = {
  id: string;
  user_id: string;
  product_id: string | null;
  course_id: string | null;
  source: string;
  status: string;
  expires_at: string | null;
  review_mode: string | null;
  revoked_at: string | null;
};

export function getCourseProducts() {
  return window.api.getWith<{ items: CourseProductWire[] }>('/admin/course-products');
}

/** G04 course access of one learner; only `state`, `product_slug` and `course_code` are read here. */
export function getUserAccess(userId: string) {
  return window.api.getWith<{ items: { entitlement_id: string | null; product_slug: string | null; course_code?: string | null; state: string }[] }>(
    `/admin/users/${encodeURIComponent(userId)}/access`);
}

/** Course ids and codes (`GET /admin/courses`), read only to match a legacy class-code holding to its course. */
export function getCourseCodes() {
  return window.api.getWith<{ courses: { id: string; code: string | null }[] }>('/admin/courses');
}

export function postGrant(body: Record<string, unknown>) {
  return window.api.post<{ status: 'granted' | 'replay'; entitlement: EntitlementWire }>('/admin/entitlements', body);
}

export function postRevoke(entitlementId: string, reason: string) {
  return window.api.post<{ status: 'revoked' | 'already_revoked'; entitlement: EntitlementWire }>(
    `/admin/entitlements/${encodeURIComponent(entitlementId)}/revoke`, { reason });
}

export function newRequestKey() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
      (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));
}

export declare const REASON_MIN: number;
export declare const REASON_MAX: number;
export declare const DAYS_MAX: number;
export type ReviewMode = 'ai_instant' | 'teacher_review';
export declare const REVIEW_MODES: { value: ReviewMode; label: string }[];

export type CourseProductWire = {
  id: string;
  course_id: string;
  slug?: string | null;
  kind: string;
  title?: string | null;
  short_title?: string | null;
  status?: string | null;
  access_days?: number | null;
  review_mode?: string | null;
  archived_at?: string | null;
};
export type PracticeProduct = { id: string; courseId: string; title: string; days: number | null; reviewMode: ReviewMode };
export type GrantUser = { id: string; name: string };
export type HeldCourseIds = Record<string, string[]>;
export type GrantDraft = { productId: string; days: string; reviewMode: ReviewMode; reason: string };
export type GrantRequest = { product_id: string; days: number | null; review_mode: ReviewMode; reason: string };
export type GrantCheck =
  | { ok: false; error: string }
  | { ok: true; product: PracticeProduct; targets: GrantUser[]; already: GrantUser[]; body: GrantRequest; confirmText: string };
export type GrantResult = { ok: true } | { ok: false; error: string };
export type RunSummary = {
  granted: GrantUser[];
  failed: (GrantUser & { error: string })[];
  pending: GrantUser[];
  done: boolean;
  text: string;
};
export type RevokeDraft = { typedName: string; reason: string };
export type RevokeCheck = { ok: false; error: string } | { ok: true; body: { reason: string } };

export declare function productTitle(product: CourseProductWire | null | undefined): string;
export declare function practiceProducts(
  products: CourseProductWire[] | null | undefined,
  options?: { excludeCourseIds?: string[]; users?: GrantUser[]; heldCourseIds?: HeldCourseIds },
): PracticeProduct[];
export declare function grantDraft(products: PracticeProduct[]): GrantDraft;
export declare function validateGrant(draft: GrantDraft, products: PracticeProduct[], users: GrantUser[], heldCourseIds?: HeldCourseIds): GrantCheck;
export declare function grantBody(body: GrantRequest, userId: string, key: string): Record<string, unknown>;
export declare function runSummary(targets: GrantUser[], results: Record<string, GrantResult>): RunSummary;
export declare function validateRevoke(draft: RevokeDraft, learnerName: string | null | undefined): RevokeCheck;

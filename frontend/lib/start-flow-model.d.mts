export const START_BANDS: readonly string[];
export function startRedirect(me: { onboarding_completed?: unknown; learner_v2_enabled?: unknown } | null, next: unknown): string | null;
export function hasActiveOnlineCourse(payload: unknown): boolean;
export function hasClass(payload: unknown): boolean;
export function startingPoint(facts: { online: boolean; inClass: boolean }): 'class' | 'online' | 'none';
export function goalPayload(goal: { band: string; examDate: string }): { target_band?: number; exam_date?: string };

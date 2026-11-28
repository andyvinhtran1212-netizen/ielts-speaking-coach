// Learner directory API (G09-T03) for the directory page (G09-T10).
import { deleteBrowserJsonAt, getBrowserJson, getBrowserJsonAt, patchBrowserJsonAt, postBrowserJsonAt } from '@/lib/browser-api';
import type { ApiGetJson } from '@/lib/openapi-contract';

export type LearnerDirectoryWire = ApiGetJson<'/admin/learners'>;
export type LearnerRowWire = LearnerDirectoryWire['items'][number];
export type LearnerSummaryOutWire = ApiGetJson<'/admin/learners/{ref}/summary'>;
/** The seven-field block itself (FR-034), without the read status. */
export type LearnerSummaryWire = Omit<LearnerSummaryOutWire, 'sources_failed'>;

export function getLearnerDirectory(query: URLSearchParams) {
  return getBrowserJson('/admin/learners', query);
}

export function getLearnerSummary(ref: string, signal?: AbortSignal) {
  return getBrowserJsonAt('/admin/learners/{ref}/summary',
    `/admin/learners/${encodeURIComponent(ref)}/summary`, signal);
}

// Learner profile (G09-T04 API; G09-T11a page).
export type LearnerDetailWire = ApiGetJson<'/admin/learners/{ref}'>;
export type LearnerOverviewWire = ApiGetJson<'/admin/learners/{ref}/overview'>;
export type LearnerGoalWire = NonNullable<LearnerOverviewWire['goal']>;
export type GoalSeenWire = {
  admin: { target_band: number | null; target_date: string | null };
  learner: { target_band: number | null; exam_date: string | null };
};

const refPath = (ref: string) => `/admin/learners/${encodeURIComponent(ref)}`;

export function getLearnerDetail(ref: string, signal?: AbortSignal) {
  return getBrowserJsonAt('/admin/learners/{ref}', refPath(ref), signal);
}

export function getLearnerOverview(ref: string, signal?: AbortSignal) {
  return getBrowserJsonAt('/admin/learners/{ref}/overview', `${refPath(ref)}/overview`, signal);
}

export function resolveLearnerGoal(ref: string, use: 'admin' | 'learner', seen: GoalSeenWire) {
  return postBrowserJsonAt('/admin/learners/{ref}/goal/resolve', `${refPath(ref)}/goal/resolve`, { use, seen });
}

// Khoá và quyền tab (G09-T11b): existing write routes only.
export function changeUserRole(userId: string, role: string) {
  return patchBrowserJsonAt('/admin/users/{user_id}/role', `/admin/users/${encodeURIComponent(userId)}/role`, { role });
}

export function removeFromCohort(cohortId: string, studentId: string) {
  return deleteBrowserJsonAt(
    '/admin/cohorts/{cohort_id}/students/{student_id}',
    `/admin/cohorts/${encodeURIComponent(cohortId)}/students/${encodeURIComponent(studentId)}`,
    undefined,
    { rejectUnauthorized: true },
  );
}

// Learner directory API (G09-T03) for the directory page (G09-T10).
import { getBrowserJson, getBrowserJsonAt } from '@/lib/browser-api';
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

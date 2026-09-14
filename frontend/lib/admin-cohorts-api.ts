import 'client-only';

import { getBrowserJson } from '@/lib/browser-api';
import type { ApiGetJson } from '@/lib/openapi-contract';

export type AdminCohortListWire = ApiGetJson<'/admin/cohorts'>;

export function getAdminCohorts(options: {
  isActive?: boolean;
  courseId?: string;
  withRollup?: boolean;
} = {}) {
  const query = new URLSearchParams();
  if (options.isActive !== undefined) query.set('is_active', String(options.isActive));
  if (options.courseId) query.set('course_id', options.courseId);
  if (options.withRollup !== undefined) query.set('with_rollup', String(options.withRollup));
  return getBrowserJson('/admin/cohorts', query);
}

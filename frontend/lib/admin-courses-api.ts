import 'client-only';

import { getBrowserJson } from '@/lib/browser-api';
import type { ApiGetJson } from '@/lib/openapi-contract';

export type AdminCoursesWire = ApiGetJson<'/admin/courses'>;

export function getAdminCourses(options: { isActive?: boolean } = {}) {
  const query = new URLSearchParams();
  if (options.isActive !== undefined) query.set('is_active', String(options.isActive));
  return getBrowserJson('/admin/courses', query);
}

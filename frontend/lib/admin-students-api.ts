import 'client-only';

import { getBrowserJson } from '@/lib/browser-api';
import type { ApiGetJson } from '@/lib/openapi-contract';

export type AdminStudentsWire = ApiGetJson<'/admin/students'>;

export function getAdminStudents(options: {
  search?: string;
  limit?: number;
  offset?: number;
  includeArchived?: boolean;
} = {}) {
  const query = new URLSearchParams();
  if (options.search) query.set('search', options.search);
  if (options.limit !== undefined) query.set('limit', String(options.limit));
  if (options.offset !== undefined) query.set('offset', String(options.offset));
  if (options.includeArchived) query.set('include_archived', 'true');
  return getBrowserJson('/admin/students', query);
}

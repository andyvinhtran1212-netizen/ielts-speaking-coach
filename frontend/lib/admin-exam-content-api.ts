import 'client-only';

import { getBrowserJson } from '@/lib/browser-api';
import type { ApiGetJson } from '@/lib/openapi-contract';

export type AdminExamContentWire = ApiGetJson<'/admin/exam-content'>;

export function getAdminExamContent(query: URLSearchParams) {
  return getBrowserJson('/admin/exam-content', query);
}

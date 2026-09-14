import 'client-only';

import { getBrowserJson } from '@/lib/browser-api';
import type { ApiGetJson } from '@/lib/openapi-contract';

export type AdminWritingQueueWire = ApiGetJson<'/admin/writing/essays'>;

export function getAdminWritingQueue(query: URLSearchParams) {
  return getBrowserJson('/admin/writing/essays', query);
}

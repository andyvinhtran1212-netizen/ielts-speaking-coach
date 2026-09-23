import 'client-only';

import { getBrowserJson } from '@/lib/browser-api';
import { legacyWritingQueuePage } from '@/lib/admin-writing-queue-model.mjs';
import type { ApiGetJson } from '@/lib/openapi-contract';

export type AdminWritingQueueWire = ApiGetJson<'/admin/writing/essays'>;
export type AdminWritingQueuePageWire = ApiGetJson<'/admin/writing/essay-queue'>;

export function getAdminWritingQueue(query: URLSearchParams) {
  return getBrowserJson('/admin/writing/essays', query);
}

export async function getAdminWritingQueuePage(query: URLSearchParams) {
  try {
    return await getBrowserJson('/admin/writing/essay-queue', query);
  } catch (caught) {
    if (!caught || typeof caught !== 'object' || !('status' in caught) || caught.status !== 404) throw caught;
    const legacyQuery = new URLSearchParams({ limit: '200', offset: '0' });
    for (const key of ['status', 'cohort_id', 'mock']) {
      const value = query.get(key);
      if (value !== null) legacyQuery.set(key, value);
    }
    const page = legacyWritingQueuePage(await getAdminWritingQueue(legacyQuery), query);
    if (!page) throw new Error('Danh sách bài viết không đúng định dạng.');
    return page;
  }
}

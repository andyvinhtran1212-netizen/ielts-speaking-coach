import 'client-only';

import { getBrowserJson } from '@/lib/browser-api';
import { legacyExamContentPage } from '@/lib/admin-mock-exams-model.mjs';
import type { ApiGetJson } from '@/lib/openapi-contract';

export type AdminExamContentWire = ApiGetJson<'/admin/exam-content'>;
export type AdminExamContentPageWire = ApiGetJson<'/admin/exam-content/page'>;

export function getAdminExamContent(query: URLSearchParams) {
  return getBrowserJson('/admin/exam-content', query);
}

export async function getAdminExamContentPage(query: URLSearchParams) {
  try {
    return await getBrowserJson('/admin/exam-content/page', query);
  } catch (caught) {
    if (!caught || typeof caught !== 'object' || !('status' in caught) || caught.status !== 404) throw caught;
    const legacyQuery = new URLSearchParams();
    for (const key of ['kind', 'course_level', 'cohort_id', 'exam_only', 'is_public']) {
      const value = query.get(key);
      if (value !== null) legacyQuery.set(key, value);
    }
    const page = legacyExamContentPage(await getAdminExamContent(legacyQuery), query);
    if (!page) throw new Error('Kho đề kỳ thi sai contract.');
    return page;
  }
}

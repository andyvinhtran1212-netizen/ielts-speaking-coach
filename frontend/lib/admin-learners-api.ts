// Learner directory and roster actions for G09-T10.
import { getBrowserJson, getBrowserJsonAt, postBrowserJsonAt, postBrowserJsonAtWith } from '@/lib/browser-api';
import type { ApiGetJson, ApiPostJson } from '@/lib/openapi-contract';
import type { components } from '@/types/api';

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

export async function assignLearnersToCohort(cohortId: string, studentIds: string[]): Promise<number> {
  const body: components['schemas']['BulkAssignStudentsRequest'] = { student_ids: studentIds };
  const out = await postBrowserJsonAt('/admin/cohorts/{cohort_id}/students/bulk',
    `/admin/cohorts/${encodeURIComponent(cohortId)}/students/bulk`, body);
  if (typeof out === 'object' && out !== null && 'ok' in out && out.ok === true
      && 'cohort_id' in out && out.cohort_id === cohortId
      && 'assigned' in out && typeof out.assigned === 'number'
      && Number.isInteger(out.assigned) && out.assigned >= 0 && out.assigned <= studentIds.length) {
    return out.assigned;
  }
  throw new Error('Máy chủ chưa xác nhận việc gán lớp. Kiểm tra danh bạ trước khi thử lại.');
}

export async function createDirectoryLearner(body: components['schemas']['CreateStudentRequest']): Promise<void> {
  const out = await postBrowserJsonAtWith('/admin/students', '/admin/students', body);
  if (typeof out === 'object' && out !== null && 'id' in out && typeof out.id === 'string' && out.id.trim()
      && 'student_code' in out && out.student_code === body.student_code) {
    return;
  }
  throw new Error('Máy chủ chưa xác nhận việc tạo học viên. Kiểm tra danh bạ trước khi thử lại.');
}

export async function importDirectoryLearners(file: File): Promise<{ imported: number; errors: unknown[] }> {
  const form = new FormData();
  form.append('file', file);
  const out = await window.api.upload<ApiPostJson<'/admin/students/import'>>('/admin/students/import', form);
  if (typeof out === 'object' && out !== null && 'imported' in out && typeof out.imported === 'number'
      && Number.isInteger(out.imported) && out.imported >= 0
      && 'errors' in out && Array.isArray(out.errors)) {
    return { imported: out.imported, errors: out.errors };
  }
  throw new Error('Máy chủ chưa xác nhận việc nhập CSV. Kiểm tra danh bạ trước khi thử lại.');
}

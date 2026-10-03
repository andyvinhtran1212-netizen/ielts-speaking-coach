import type { paths } from '@/types/api';

type Bank = paths['/api/quiz/banks/{bank_id}']['get']['responses'][200]['content']['application/json'];
type Start = paths['/api/quiz/sessions']['post'];
type StartBody = Start['requestBody']['content']['application/json'];
type StartAck = Start['responses'][201]['content']['application/json'];
type Progress = paths['/api/quiz/sessions/{session_id}/progress']['post'];
type ProgressBody = Progress['requestBody']['content']['application/json'];
type ProgressAck = Progress['responses'][200]['content']['application/json'];
type End = paths['/api/quiz/sessions/{session_id}']['patch'];
type EndBody = End['requestBody']['content']['application/json'];
type EndAck = End['responses'][200]['content']['application/json'];

/** Existing auth transport; abort also guards its delayed token→fetch dispatch. */
export function quizPlayerApi(signal: AbortSignal, isCurrent = () => !signal.aborted) {
  const options = { signal, noRedirect: true };
  const owned = async <T,>(request: Promise<T>): Promise<T> => {
    try { return await request; }
    catch (error) {
      // A fulfilled 401 cannot be undone by abort. Only its still-current owner
      // may navigate; the native caller supplies the epoch/account/query guard.
      if ((error as { status?: number })?.status === 401 && !signal.aborted && isCurrent()) window.location.href = '/login';
      throw error;
    }
  };
  return {
    banks: (query: string) => owned(window.api.getWith<unknown>(`/api/quiz/banks${query}`, undefined, options)),
    bank: (id: string) => owned(window.api.getWith<Bank>(`/api/quiz/banks/${encodeURIComponent(id)}`, undefined, options)),
    resume: (id: string) => owned(window.api.getWith<unknown>(`/api/quiz/banks/${encodeURIComponent(id)}/resume`, undefined, options)),
    start: (body: StartBody) => owned(window.api.postWith<StartAck>('/api/quiz/sessions', body, undefined, options)),
    progress: (id: string, body: ProgressBody) => owned(window.api.postWith<ProgressAck>(`/api/quiz/sessions/${encodeURIComponent(id)}/progress`, body, undefined, options)),
    end: (id: string, body: EndBody) => owned(window.api.patchWith<EndAck>(`/api/quiz/sessions/${encodeURIComponent(id)}`, body, undefined, options)),
    reset: (id: string) => owned(window.api.postWith<unknown>(`/api/quiz/banks/${encodeURIComponent(id)}/reset`, {}, undefined, options)),
  };
}

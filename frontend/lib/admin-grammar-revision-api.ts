import type { components } from '../types/api';
import type { RevisionAck, RevisionCode, RevisionPreview, RevisionRead, CommitBody } from './admin-grammar-revision-model';

/** Existing authenticated transport; only the current workspace may redirect401.
 * The owner aborts on scope changes, including delayed token→fetch dispatch.
 */
export function adminGrammarRevisionApi(signal: AbortSignal, isCurrent: () => boolean) {
  const options = { signal, noRedirect: true };
  const endpoint = (code: RevisionCode) => `/admin/quiz/grammar-revisions/${encodeURIComponent(code)}`;
  const owned = async <T,>(request: () => Promise<T>): Promise<T> => {
    if (signal.aborted || !isCurrent()) throw new DOMException('Workspace no longer owns this request', 'AbortError');
    try { return await request(); }
    catch (error) {
      if ((error as { status?: number })?.status === 401 && !signal.aborted && isCurrent()) window.location.href = '/login';
      throw error;
    }
  };
  return {
    read: (code: RevisionCode) => owned(() => window.api.getWith<RevisionRead>(endpoint(code), undefined, options)),
    preview: (code: RevisionCode, body: components['schemas']['GrammarRevisionPreviewRequest']) => owned(() => window.api.postWith<RevisionPreview>(`${endpoint(code)}/preview`, body, undefined, options)),
    commit: (code: RevisionCode, body: Readonly<CommitBody>) => owned(() => window.api.postWith<RevisionAck>(`${endpoint(code)}/commit`, body, undefined, options)),
  };
}

// Opens one class assignment row at its exact destination.
//
// The one place that turns a normalized class-assignment row (from
// `lib/my-class-model.mjs`) into a navigation. `/my-class` and the new Today
// page (LEARNERCORE-0063 FR-022) both call it, so there is no second URL
// builder. Moved verbatim from `MyClassWorkspace.startAssignment`; the caller
// keeps its own "opening…" state and error toast.
import {
  admitCorePlayer,
  resolveCorePlayerAdmissionForNavigation,
} from '@/lib/core-player-affinity.mjs';
import {
  assignmentAction,
  isKnownPlayerSurface,
  normalizeClassStartResponse,
} from '@/lib/my-class-model.mjs';
import type { ApiPostJson } from '@/lib/openapi-contract';

type ClassStartWire = ApiPostJson<'/api/class/assignments/{item_id}/start'>;

type StartTarget =
  | {
      kind: 'course'; bankId: string; itemId: string;
      reviewOnly: boolean; expiryPending: boolean;
      advancedVocabulary?: boolean;
    }
  | { kind: 'player'; surface: string; query: Record<string, string> }
  | { kind: 'stable-player'; url: string }
  | { kind: 'admission'; url: string }
  | { kind: 'result'; url: string }
  | { kind: 'review'; url: string }
  | { kind: 'grammar'; url: string }
  | { kind: 'grammar-lesson'; url: string }
  | { kind: 'grammar-report'; url: string }
  | { kind: 'create-speaking'; body: {
      mode: string; part: number; topic: string; class_assignment_item_id: string;
    } };

/** The fields of a normalized row this module reads. */
export type OpenableAssignment = {
  itemId: string;
  resultPath: string | null;
  assignment: { skill: string };
};

export type OpenAssignmentDeps = {
  router: { push(href: string): void };
  /** False once the signed-in account changed while a request was in flight. */
  isCurrent: () => boolean;
};

/** Writing has no class ledger item: it opens on the Writing dashboard, no request. */
export function opensWithoutRequest(row: OpenableAssignment): boolean {
  return row.assignment.skill === 'writing';
}

/**
 * Navigate to the row's exact destination. Throws with a learner-facing message
 * when the server returns no valid target; returns silently when the account
 * changed mid-flight.
 */
export async function openClassAssignment(row: OpenableAssignment, { router, isCurrent }: OpenAssignmentDeps): Promise<void> {
  // A writing give has no class ledger item, so the class-start endpoint cannot
  // resolve it. Its lifecycle (draft, timer, submit, grading) lives on the
  // Writing dashboard — send the learner there to do the task.
  if (opensWithoutRequest(row)) {
    // A returned essay opens its result directly; the path is the server's,
    // already pinned to /writing/result by the strict boundary.
    const action = assignmentAction(row);
    window.location.assign(action?.kind === 'result' && row.resultPath
      ? row.resultPath : '/writing/dashboard');
    return;
  }
  const raw = await window.api.post<ClassStartWire>(
    `/api/class/assignments/${encodeURIComponent(row.itemId)}/start`,
  );
  if (!isCurrent()) return;
  const target = normalizeClassStartResponse(raw, row.itemId) as StartTarget | null;
  if (!target) throw new Error('Máy chủ không trả điểm đến hợp lệ cho bài này.');
  if (target.kind === 'course') {
    if (target.advancedVocabulary) {
      window.location.assign(`/course/vocabulary?bank=${encodeURIComponent(target.bankId)}&item=${encodeURIComponent(target.itemId)}`);
      return;
    }
    const view = target.reviewOnly ? '&view=writing' : '';
    const item = `&class_item=${encodeURIComponent(target.itemId)}`;
    window.location.assign(`/course/exercises?bank=${encodeURIComponent(target.bankId)}${view}${item}`);
    return;
  }
  if (target.kind === 'player') {
    if (!isKnownPlayerSurface(target.surface)) throw new Error('Player không được hỗ trợ.');
    if (target.surface === 'speaking') {
      const destination = await resolveCorePlayerAdmissionForNavigation(
        target.surface,
        target.query,
      );
      if (!isCurrent()) return;
      if (destination.startsWith('/practice/session?')) router.push(destination);
      else window.location.assign(destination);
    } else {
      window.location.assign(admitCorePlayer(target.surface, target.query));
    }
    return;
  }
  if (target.kind === 'stable-player') {
    // Stable Legacy attempts must stay on their historical renderer. A
    // Next-owned Speaking session can use App Router navigation: this keeps
    // the authenticated shell alive and lets the player cleanup run on
    // unmount instead of reloading the whole document.
    if (target.url.startsWith('/practice/session?')) router.push(target.url);
    else window.location.assign(target.url);
    return;
  }
  if (target.kind === 'admission') {
    window.location.assign(target.url);
    return;
  }
  if (target.kind === 'result' || target.kind === 'review'
      || target.kind === 'grammar' || target.kind === 'grammar-report' || target.kind === 'grammar-lesson') {
    router.push(target.url);
    return;
  }
  const created = await window.api.post<unknown>('/sessions', target.body);
  if (!isCurrent()) return;
  const session = created && typeof created === 'object' ? created as Record<string, unknown> : null;
  const sessionId = typeof session?.id === 'string' && session.id.trim() ? session.id.trim()
    : typeof session?.session_id === 'string' && session.session_id.trim() ? session.session_id.trim() : '';
  if (!sessionId) throw new Error('Máy chủ không trả về buổi học hợp lệ.');
  const destination = await resolveCorePlayerAdmissionForNavigation(
    'speaking',
    { session_id: sessionId },
  );
  if (!isCurrent()) return;
  if (destination.startsWith('/practice/session?')) router.push(destination);
  else window.location.assign(destination);
}

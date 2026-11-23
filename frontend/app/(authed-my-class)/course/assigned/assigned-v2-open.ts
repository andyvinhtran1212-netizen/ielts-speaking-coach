// "Tự luyện bài này" (LEARNERCORE-0063 FR-100): ask the server for the public
// self-practice launch of a closed assignment, then go there. The server checks
// everything (the paper is open to everyone now, the class item is not
// carried); this only refuses a launch that would carry the class item.
import { resolveCorePlayerAdmissionForNavigation } from '@/lib/core-player-affinity.mjs';
import type { ApiPostJson } from '@/lib/openapi-contract';

type SelfPracticeWire = ApiPostJson<'/api/class/assignments/{item_id}/self-practice'>;

export type OpenDeps = {
  router: { push(href: string): void };
  /** False once the signed-in account changed while a request was in flight. */
  isCurrent: () => boolean;
};

const BAD_TARGET = 'Máy chủ không trả điểm đến tự luyện hợp lệ cho bài này.';

/** A Listening/Reading launch: the public core-player route, never with `class_item`. */
export function selfPracticeHref(href: unknown): string | null {
  if (typeof href !== 'string' || !href.startsWith('/core-player/launch?')) return null;
  const params = new URLSearchParams(href.slice(href.indexOf('?') + 1));
  if (params.has('class_item') || params.has('class_assignment_item_id')) return null;
  return href;
}

export async function openSelfPractice(itemId: string, { router, isCurrent }: OpenDeps): Promise<void> {
  const raw = await window.api.post<SelfPracticeWire>(
    `/api/class/assignments/${encodeURIComponent(itemId)}/self-practice`,
  );
  if (!isCurrent()) return;
  const launch = raw && typeof raw === 'object' ? (raw as { launch?: Record<string, unknown> }).launch : null;
  const href = selfPracticeHref(launch?.href);
  if (href) {
    window.location.assign(href);
    return;
  }
  const params = launch?.session_params as Record<string, unknown> | undefined;
  const part = Number(params?.part);
  if (!params || typeof params.mode !== 'string' || typeof params.topic !== 'string'
      || !Number.isInteger(part) || part < 1 || part > 3 || 'class_assignment_item_id' in params) {
    throw new Error(BAD_TARGET);
  }
  const created = await window.api.post<unknown>('/sessions', { mode: params.mode, part, topic: params.topic });
  if (!isCurrent()) return;
  const session = created && typeof created === 'object' ? created as Record<string, unknown> : null;
  const sessionId = typeof session?.id === 'string' && session.id.trim() ? session.id.trim()
    : typeof session?.session_id === 'string' && session.session_id.trim() ? session.session_id.trim() : '';
  if (!sessionId) throw new Error('Máy chủ không trả về buổi học hợp lệ.');
  const destination = await resolveCorePlayerAdmissionForNavigation('speaking', { session_id: sessionId });
  if (!isCurrent()) return;
  if (destination.startsWith('/practice/session?')) router.push(destination);
  else window.location.assign(destination);
}

/** The learner-facing message of a refused self-practice launch. */
export function selfPracticeError(caught: unknown): string {
  // The route answers `{detail: {error, message}}`; api.js keeps that object on `.detail`.
  const err = caught as { code?: string | null; detail?: { error?: unknown } | null; message?: string } | null;
  const code = err?.code || (typeof err?.detail?.error === 'string' ? err.detail.error : null);
  switch (code) {
    case 'assignment_still_open': return 'Bài vẫn còn nhận bài, hãy làm bài được giao.';
    case 'homework_attempt_in_progress': return 'Bạn còn một lượt làm bài được giao đang dở trên đề này.';
    case 'self_practice_paper_unavailable': return 'Đề của bài này hiện không mở cho tự luyện.';
    case 'self_practice_unsupported': return 'Bài này không có chế độ tự luyện.';
    default: return err?.message || 'Không mở được bài tự luyện.';
  }
}
